/**
 * How far back the notifier looks before filing (bd salish-5of, decision 039).
 *
 * `alreadyFiled` is what stops a crash between the GitHub POST and the
 * `notified_at` stamp turning into a duplicate issue on the next run. It reads
 * existing issues to recognise its own work, and the question these tests pin
 * down is how much of that history it has to read — the answer being "back to
 * the oldest report in hand, and no further".
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { alreadyFiled, stamp, unnotified } from './notify.ts';
import { filedRowIds, rowMarker } from './issue.ts';

const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
const bot = 'github-actions[bot]';

type Issue = {body: string | null; created_at: string; user: {login: string} | null};

/**
 * A full page — 100 issues, oldest last.
 *
 * Realistic on purpose: a short page is how GitHub says "that's all", so
 * fixtures made of short pages would stop the walk for the wrong reason and
 * test nothing about how far back it reaches.
 */
const fullPage = (startId: number, newest: number, oldest: number): Issue[] =>
    Array.from({length: 100}, (_, i) => ({
        body: `ours\n<!-- feedback-row:${startId + i} -->`,
        created_at: i === 99 ? day(oldest) : day(newest),
        user: {login: bot},
    }));

/** A fake GitHub that serves fixed pages and records which were asked for. */
function fakeGitHub(pages: Record<number, Issue[]>) {
    const requested: number[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
        const page = Number(new URL(url).searchParams.get('page'));
        requested.push(page);
        return {ok: true, json: async () => pages[page] ?? []};
    });
    return requested;
}

afterEach(() => vi.unstubAllGlobals());

describe('alreadyFiled', () => {
    test('reads one page when that page already reaches past the oldest report', async () => {
        const requested = fakeGitHub({1: fullPage(1, 28, 10)});
        await alreadyFiled('o/r', 't', new Date(day(19)));

        // Page 1 runs back to the 10th, past the 19th, so there is nothing
        // older worth reading.
        expect(requested).toEqual([1]);
    });

    test('stops on a short page — GitHub saying that is all there is', async () => {
        const requested = fakeGitHub({
            1: [{body: `ours\n<!-- feedback-row:41 -->`, created_at: day(28), user: {login: bot}}],
        });
        expect(await alreadyFiled('o/r', 't', new Date(day(1)))).toEqual(new Set([41]));
        expect(requested).toEqual([1]);
    });

    test('walks back only as far as the oldest report in hand', async () => {
        // An issue is always created after the row it reports, so nothing older
        // than that row can be ours — and the years of feedback issues behind it
        // never need reading. Page 3 is entirely older, so it is never asked for.
        const requested = fakeGitHub({
            1: fullPage(900, 28, 25),   // all newer than the cutoff — keep going
            2: fullPage(400, 24, 15),   // reaches past it — stop here
            3: fullPage(1, 5, 2),       // years of history, never read
        });
        const ids = await alreadyFiled('o/r', 't', new Date(day(19)));

        expect(requested).toEqual([1, 2]);
        expect(ids.has(900)).toBe(true);
        expect(ids.has(400)).toBe(true);
        expect(ids.has(1)).toBe(false);
    });

    test('ignores markers in issues the workflow did not write', async () => {
        // The `feedback` label is applied by hand as often as by us — a
        // maintainer triaging someone's issue is the ordinary case — and a body
        // ending in a marker would otherwise let that issue claim a row, so the
        // row would be stamped with nothing filed for it.
        fakeGitHub({
            1: [
                {body: `ours\n<!-- feedback-row:41 -->`, created_at: day(20), user: {login: bot}},
                {body: `theirs\n<!-- feedback-row:77 -->`, created_at: day(20), user: {login: 'a-human'}},
            ],
        });
        expect(await alreadyFiled('o/r', 't', new Date(day(19)))).toEqual(new Set([41]));
    });

    test('stops on an empty page rather than counting to the limit', async () => {
        const requested = fakeGitHub({1: []});
        expect(await alreadyFiled('o/r', 't', new Date(day(1)))).toEqual(new Set());
        expect(requested).toEqual([1]);
    });

    test('refuses to guess when GitHub will not answer', async () => {
        // Proceeding blind would risk duplicates; worse, a wrong "already filed"
        // stamps a row with nothing filed for it. Throwing leaves every row
        // unstamped for the next run, which loses nothing.
        vi.stubGlobal('fetch', async () => ({ok: false, status: 502, json: async () => []}));
        await expect(alreadyFiled('o/r', 't', new Date(day(1)))).rejects.toThrow(/502/);
    });

    test('gives up after the page stop rather than walking forever', async () => {
        // Every page looks recent, so only the hard stop ends it.
        const endless = new Proxy({}, {get: () => fullPage(1, 28, 28)});
        const requested = fakeGitHub(endless as Record<number, Issue[]>);
        await alreadyFiled('o/r', 't', new Date(day(1)));
        expect(requested).toHaveLength(20);
    });
});

/**
 * The database half, which mocking `fetch` cannot reach.
 *
 * `stamp` shipped broken: `sql.array()` sends a JS number array as `text[]`, so
 * `id = ANY($1)` against a `bigint` column fails with "operator does not exist:
 * bigint = text". TypeScript cannot see it, and every test in this file stubbed
 * the network and never opened a connection — so it reached production, where
 * it filed a GitHub issue and then failed before stamping the row. These run
 * the real statements against Postgres, always rolled back.
 */
const DSN = process.env['SUPABASE_DB_URL'];

describe.skipIf(!DSN)('stamping rows (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    class Rollback extends Error {}
    const rolledBack = async (fn: (tx: Sql) => Promise<void>) => {
        await sql.begin(async (tx) => { await fn(tx as unknown as Sql); throw new Rollback(); })
            .catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    };

    test('stamps the rows it is given and leaves the rest alone', async () => {
        await rolledBack(async (tx) => {
            await tx`DELETE FROM public.feedback`;
            const rows = await tx<{id: number}[]>`
                INSERT INTO public.feedback (name, message) VALUES ('a','one'), ('b','two')
                RETURNING id`;
            const [first, second] = rows.map((r) => Number(r.id));

            await stamp(tx, [first!], 512);

            const after = await tx<{id: number; notified_at: string | null; github_issue: number | null}[]>`
                SELECT id, notified_at, github_issue FROM public.feedback ORDER BY id`;
            expect(after.find((r) => Number(r.id) === first)!.notified_at).not.toBeNull();
            expect(after.find((r) => Number(r.id) === first)!.github_issue).toBe(512);
            expect(after.find((r) => Number(r.id) === second)!.notified_at).toBeNull();
        });
    });

    test('a stamped row stops being unnotified', async () => {
        await rolledBack(async (tx) => {
            await tx`DELETE FROM public.feedback`;
            const [row] = await tx<{id: number}[]>`
                INSERT INTO public.feedback (name, message) VALUES ('a','one') RETURNING id`;
            expect(await unnotified(tx, 10)).toHaveLength(1);

            await stamp(tx, [Number(row!.id)], null);

            // github_issue stays null when an earlier run filed it; the row must
            // still leave the queue, or it is looked at forever.
            expect(await unnotified(tx, 10)).toHaveLength(0);
        });
    });

    test('returns id as a NUMBER, so a Set<number> can recognise it', async () => {
        // postgres.js hands back bigint as a string, and TypeScript believes the
        // declared type either way. The one place it matters is
        // `filed.has(row.id)`, which silently answers no for a string and files
        // every already-filed report a second time — which is what happened to
        // the first real report this channel ever received.
        await rolledBack(async (tx) => {
            await tx`DELETE FROM public.feedback`;
            await tx`INSERT INTO public.feedback (name, message) VALUES ('a','one')`;
            const [row] = await unnotified(tx, 10);

            expect(typeof row!.id).toBe('number');
            // The actual failure, stated as the behaviour rather than the type.
            expect(new Set([row!.id]).has(row!.id)).toBe(true);
            expect(new Set<number>([Number(row!.id)]).has(row!.id)).toBe(true);
        });
    });

    test('a row whose issue already exists is recognised as filed', async () => {
        // The whole point of alreadyFiled, exercised across the seam that broke
        // it: ids come from Postgres, markers come from a GitHub issue body, and
        // the two have to meet in a Set. They did not, so the first real report
        // this channel received was filed twice (#440 and #442).
        await rolledBack(async (tx) => {
            await tx`DELETE FROM public.feedback`;
            await tx`INSERT INTO public.feedback (name, message) VALUES ('a','one')`;
            const [row] = await unnotified(tx, 10);

            const issueBody = `Someone sent this.\n\n${rowMarker(row!.id)}`;
            const filed = filedRowIds([issueBody]);

            expect(filed.has(row!.id)).toBe(true);
            // And therefore it is dropped from the list to file, rather than
            // filed a second time.
            expect([row!].filter((r) => !filed.has(r.id))).toEqual([]);
        });
    });

    test('stamps many rows in one statement', async () => {
        await rolledBack(async (tx) => {
            await tx`DELETE FROM public.feedback`;
            const rows = await tx<{id: number}[]>`
                INSERT INTO public.feedback (name, message)
                VALUES ('a','1'), ('b','2'), ('c','3') RETURNING id`;
            await stamp(tx, rows.map((r) => Number(r.id)), 900);
            expect(await unnotified(tx, 10)).toHaveLength(0);
        });
    });
});
