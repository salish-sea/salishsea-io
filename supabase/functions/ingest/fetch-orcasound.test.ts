/**
 * Shell test for fetchAllBouts: it follows `links.next` to the end, stays on orcasite's
 * origin, and refuses an empty corpus. Those three are what make a corpus-wide reconcile
 * safe without a window (decision 011), so they are pinned here against a stubbed fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllBouts, FIRST_PAGE_URL } from './fetch-orcasound.ts';

const noopLog = () => {};

const feed = { type: 'feed', id: 'feed_1', attributes: { name: 'Lab', location_point: { type: 'Point', coordinates: [-123, 48] } } };
const bout = (id: string) => ({
    type: 'bout', id,
    attributes: { name: null, category: 'biophony', feed_id: 'feed_1', start_time: '2026-09-01T10:00:00Z', end_time: null },
    relationships: { feed: { data: { id: 'feed_1', type: 'feed' } }, tags: { data: [] } },
});
const page = (ids: string[], next: string | null) => JSON.stringify({ data: ids.map(bout), included: [feed], links: { next } });

/** Stub fetch to answer each URL from a script, recording the URLs asked for. */
function stubFetch(script: Record<string, string>): string[] {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
        asked.push(url);
        const body = script[url];
        if (body === undefined) throw new Error(`unexpected fetch: ${url}`);
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
    });
    return asked;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchAllBouts', () => {
    it('follows next links until null and returns every page in order', async () => {
        const second = 'https://live.orcasound.net/api/json/bouts?page[offset]=250';
        const asked = stubFetch({ [FIRST_PAGE_URL]: page(['bout_1', 'bout_2'], second), [second]: page(['bout_3'], null) });
        const corpus = await fetchAllBouts(noopLog);
        expect(asked).toEqual([FIRST_PAGE_URL, second]);
        expect(corpus.pages).toBe(2);
        expect(corpus.bouts.map((b) => b.id)).toEqual(['bout_1', 'bout_2', 'bout_3']);
    });

    it('refuses an empty corpus rather than hand reconcile a plan that deletes everything', async () => {
        stubFetch({ [FIRST_PAGE_URL]: page([], null) });
        await expect(fetchAllBouts(noopLog)).rejects.toThrow(/refusing to reconcile against an empty corpus/);
    });

    it('refuses a next link that leaves orcasite', async () => {
        stubFetch({ [FIRST_PAGE_URL]: page(['bout_1'], 'https://example.org/bouts?page[offset]=250') });
        await expect(fetchAllBouts(noopLog)).rejects.toThrow(/left its origin/);
    });

    it('fails the run on a page the core cannot account for', async () => {
        stubFetch({ [FIRST_PAGE_URL]: JSON.stringify({ data: [bout('bout_1')], included: [], links: {} }) });
        await expect(fetchAllBouts(noopLog)).rejects.toThrow(/parse failed on page 1: bout bout_1: feed feed_1 is not in included/);
    });

    it('asks for sparse fieldsets and both includes', () => {
        expect(FIRST_PAGE_URL).toContain('include=feed,tags');
        expect(FIRST_PAGE_URL).toContain('fields[tag]=name,kind,iri');
        expect(FIRST_PAGE_URL).toContain('page[limit]=250');
    });
});
