/**
 * The ingest's shared fetch: its non-JSON-200 diagnostics, and which failures it marks
 * transient. Maplify serves a 200 with a non-JSON body on its own server-side failures
 * (a transient DB error, or an HTML PHP fatal-error page). The ingest hands the thrown
 * message to the operator and Sentry, so the error must name what came back, not an
 * opaque JSON-parse position.
 *
 * We stub global fetch (no network) to script what upstream returns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJsonWithRetry } from './fetch-json.ts';
import { isTransientUpstream } from './retry.ts';

const noopLog = () => {};
const fetchMaplify = () => fetchJsonWithRetry('https://maplify.test/', { name: 'Maplify' }, noopLog);

/** Stub global fetch to return each queued body (a string) once, in order. */
function stubFetch(bodies: string[]) {
    let i = 0;
    vi.stubGlobal('fetch', () => {
        const body = bodies[i++];
        if (body === undefined) throw new Error(`unexpected fetch #${i}`);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
    });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchJsonWithRetry parses JSON and diagnoses non-JSON 200s', () => {
    it('returns the parsed body on a normal JSON 200', async () => {
        stubFetch(['{"count":"2","results":[{"id":1},{"id":2}]}']);
        const data = await fetchMaplify();
        expect(data).toEqual({ count: '2', results: [{ id: 1 }, { id: 2 }] });
    });

    it('surfaces the DB-error snippet after exhausting retries', async () => {
        const dbError = 'Unable to connect to the database';
        stubFetch([dbError, dbError, dbError]);
        await expect(fetchMaplify()).rejects.toThrow(
            /Maplify returned a non-JSON 200 body \(\d+ chars\): Unable to connect to the database/,
        );
    });

    it('collapses a multi-line HTML fatal-error page to a one-line snippet', async () => {
        const oom =
            '<br />\n<b>Fatal error</b>:  Allowed memory size of 268435456 bytes exhausted\n' +
            '(tried to allocate 20480 bytes) in /var/www/search-all-sightings.php on line 42';
        stubFetch([oom, oom, oom]);
        await expect(fetchMaplify()).rejects.toThrow(
            /non-JSON 200 body .*<br \/> <b>Fatal error<\/b>: Allowed memory size .* exhausted/,
        );
    });

    it('reports an empty 200 body distinctly', async () => {
        stubFetch(['', '', '']);
        await expect(fetchMaplify()).rejects.toThrow(
            /non-JSON 200 body \(0 chars\): \(empty body\)/,
        );
    });
});

/** Stub global fetch to answer every attempt with one non-2xx status. */
function stubStatus(status: number) {
    let calls = 0;
    vi.stubGlobal('fetch', () => {
        calls++;
        return Promise.resolve({
            ok: false,
            status,
            body: { cancel: () => Promise.resolve() },
            headers: { get: () => null },
        });
    });
    return () => calls;
}

/**
 * Which failures reach Sentry (decision 042). The marker is invisible in the
 * message, so nothing else in these tests would catch it being dropped.
 */
describe('fetchJsonWithRetry marks transient upstream failures', () => {
    // Fake timers so the retry backoff costs no wall-clock; without this the
    // three retrying cases add ~9s to the suite.
    const settle = async <T,>(promise: Promise<T>) => {
        vi.useFakeTimers();
        try {
            const caught = promise.catch((e: unknown) => e);
            await vi.runAllTimersAsync();
            return await caught;
        } finally {
            vi.useRealTimers();
        }
    };

    it('marks a 503, which the next tick re-covers', async () => {
        stubStatus(503);
        expect(isTransientUpstream(await settle(fetchMaplify()))).toBe(true);
    });

    it('does NOT mark a 403 — a non-retryable status is a defect that must alert', async () => {
        const calls = stubStatus(403);
        expect(isTransientUpstream(await settle(fetchMaplify()))).toBe(false);
        expect(calls()).toBe(1); // broke out immediately rather than retrying
    });

    it('marks a network-level failure (no response at all)', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('connection refused')));
        expect(isTransientUpstream(await settle(fetchMaplify()))).toBe(true);
    });

    it('marks a non-JSON 200, which is upstream failing server-side', async () => {
        stubFetch(['<html>PHP fatal</html>', '<html>PHP fatal</html>', '<html>PHP fatal</html>']);
        expect(isTransientUpstream(await settle(fetchMaplify()))).toBe(true);
    });
});

describe('fetchJsonWithRetry asks for what the caller accepts', () => {
    it('sends application/json unless told otherwise, and names the upstream in a failure', async () => {
        const accepted: string[] = [];
        vi.stubGlobal('fetch', (_url: string, init: { headers: { accept: string } }) => {
            accepted.push(init.headers.accept);
            return Promise.resolve({
                ok: false, status: 404, body: { cancel: () => Promise.resolve() }, headers: { get: () => null },
            });
        });
        await expect(fetchMaplify()).rejects.toThrow('Maplify HTTP 404');
        await expect(fetchJsonWithRetry('https://orcasite.test/', { name: 'orcasite', accept: 'application/vnd.api+json' }, noopLog))
            .rejects.toThrow('orcasite HTTP 404');
        expect(accepted).toEqual(['application/json', 'application/vnd.api+json']);
    });
});
