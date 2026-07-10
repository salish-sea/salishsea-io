/**
 * Shell test for fetchMaplify's non-JSON-200 diagnostics. Maplify serves a 200
 * with a non-JSON body on its own server-side failures (a transient DB error, or
 * an HTML PHP fatal-error page). index.ts hands the thrown message to the operator
 * and Sentry, so the error must name what Maplify actually returned — not an
 * opaque JSON-parse position.
 *
 * We stub global fetch (no network) to script the body Maplify returns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMaplify } from './fetch-maplify.ts';
import type { IngestWindow } from '../../../scripts/ingest/persist.ts';

const WINDOW: IngestWindow = { start: '2026-06-29', end: '2026-07-09' };
const noopLog = () => {};

/** Stub global fetch to return each queued body (a string) once, in order. */
function stubFetch(bodies: string[]) {
    let i = 0;
    vi.stubGlobal('fetch', () => {
        const body = bodies[i++];
        if (body === undefined) throw new Error(`unexpected fetch #${i}`);
        return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
    });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchMaplify parses JSON and diagnoses non-JSON 200s', () => {
    it('returns the parsed body on a normal JSON 200', async () => {
        stubFetch(['{"count":"2","results":[{"id":1},{"id":2}]}']);
        const data = await fetchMaplify(WINDOW, noopLog);
        expect(data).toEqual({ count: '2', results: [{ id: 1 }, { id: 2 }] });
    });

    it('surfaces the DB-error snippet after exhausting retries', async () => {
        const dbError = 'Unable to connect to the database';
        stubFetch([dbError, dbError, dbError]);
        await expect(fetchMaplify(WINDOW, noopLog)).rejects.toThrow(
            /Maplify returned a non-JSON 200 body \(\d+ bytes\): Unable to connect to the database/,
        );
    });

    it('collapses a multi-line HTML fatal-error page to a one-line snippet', async () => {
        const oom =
            '<br />\n<b>Fatal error</b>:  Allowed memory size of 268435456 bytes exhausted\n' +
            '(tried to allocate 20480 bytes) in /var/www/search-all-sightings.php on line 42';
        stubFetch([oom, oom, oom]);
        await expect(fetchMaplify(WINDOW, noopLog)).rejects.toThrow(
            /non-JSON 200 body .*<br \/> <b>Fatal error<\/b>: Allowed memory size .* exhausted/,
        );
    });

    it('reports an empty 200 body distinctly', async () => {
        stubFetch(['', '', '']);
        await expect(fetchMaplify(WINDOW, noopLog)).rejects.toThrow(
            /non-JSON 200 body \(0 bytes\): \(empty body\)/,
        );
    });
});
