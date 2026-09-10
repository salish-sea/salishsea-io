/**
 * How far back the notifier looks before filing (bd salish-5of, decision 039).
 *
 * `alreadyFiled` is what stops a crash between the GitHub POST and the
 * `notified_at` stamp turning into a duplicate issue on the next run. It reads
 * existing issues to recognise its own work, and the question these tests pin
 * down is how much of that history it has to read — the answer being "back to
 * the oldest report in hand, and no further".
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { alreadyFiled } from './notify.ts';

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
