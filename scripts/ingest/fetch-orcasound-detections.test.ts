/**
 * Shell test for fetchDetectionsWindow: it follows `links.next`, stays on orcasite's
 * origin, and returns only a window whose distinct detections are the count orcasite gave,
 * which is what makes a delete safe (decision 011). Against a stubbed fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDetectionsWindow, windowUrl } from './fetch-orcasound-detections.ts';

const noopLog = () => {};
const window = { start: '2026-11-24', end: '2026-11-25' };

const feed = { type: 'feed', id: 'feed_1', attributes: { name: 'Lab', location_point: { type: 'Point', coordinates: [-123, 48] } } };
const detection = (id: string) => ({
    type: 'detection', id,
    attributes: { timestamp: '2026-11-24T10:00:00.000000Z', source: 'human', category: 'whale', listener_count: 1, visible: true,
                  idempotency_key: null, feed_id: 'feed_1', candidate_id: 'cand_1' },
});
const page = (ids: string[], next: string | null, total: number | null) => JSON.stringify({
    data: ids.map(detection), included: [feed], links: { next }, meta: { page: total === null ? {} : { total } },
});

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

describe('windowUrl', () => {
    it('asks for whole UTC days, counted, sorted so offsets are stable, with sparse fieldsets', () => {
        const url = windowUrl(window);
        expect(url).toContain('filter[timestamp][greater_than_or_equal]=2026-11-24T00:00:00Z');
        expect(url).toContain('filter[timestamp][less_than]=2026-11-26T00:00:00Z');
        expect(url).toContain('page[count]=true');
        expect(url).toContain('sort=timestamp,id');
        expect(url).toContain('page[limit]=250');
        // never the listener's free text or the address it came from
        expect(url).not.toMatch(/description|source_ip/);
        expect(url).toMatch(/fields\[detection\]=[^&]*idempotency_key/);
    });
});

describe('fetchDetectionsWindow', () => {
    it('follows next links and returns every page in order when the count agrees', async () => {
        const second = 'https://live.orcasound.net/api/json/detections?page[offset]=250';
        const asked = stubFetch({ [windowUrl(window)]: page(['det_1', 'det_2'], second, 3), [second]: page(['det_3'], null, 3) });
        const result = await fetchDetectionsWindow(window, noopLog);
        expect(asked).toEqual([windowUrl(window), second]);
        expect(result.pages).toBe(2);
        expect(result.detections.map(d => d.id)).toEqual(['det_1', 'det_2', 'det_3']);
        expect(result.feeds.map(f => f.id)).toEqual(['feed_1']);
    });

    it('accepts a window with nothing in it, when orcasite counted none', async () => {
        stubFetch({ [windowUrl(window)]: page([], null, 0) });
        expect((await fetchDetectionsWindow(window, noopLog)).detections).toEqual([]);
    });

    it('refuses a window that came back short, so nothing is deleted on its account', async () => {
        stubFetch({ [windowUrl(window)]: page(['det_1', 'det_2'], null, 3) });
        await expect(fetchDetectionsWindow(window, noopLog)).rejects.toThrow(/counted 3 detections .* but 2 came back/);
    });

    it('refuses a window in which paging repeated a row and skipped another', async () => {
        const second = 'https://live.orcasound.net/api/json/detections?page[offset]=250';
        stubFetch({ [windowUrl(window)]: page(['det_1', 'det_2'], second, 3), [second]: page(['det_2'], null, 3) });
        await expect(fetchDetectionsWindow(window, noopLog)).rejects.toThrow(/counted 3 detections .* but 2 came back/);
    });

    it('refuses a window whose count moves while it is paged, though the rows add up to the last count', async () => {
        const second = 'https://live.orcasound.net/api/json/detections?page[offset]=250';
        stubFetch({ [windowUrl(window)]: page(['det_1', 'det_2'], second, 3), [second]: page(['det_3', 'det_4'], null, 4) });
        await expect(fetchDetectionsWindow(window, noopLog)).rejects.toThrow(/changed from 3 to 4 while paging/);
    });

    it('refuses an answer that was not counted', async () => {
        stubFetch({ [windowUrl(window)]: page(['det_1'], null, null) });
        await expect(fetchDetectionsWindow(window, noopLog)).rejects.toThrow(/did not say how many/);
    });

    it('refuses a next link that leaves orcasite', async () => {
        stubFetch({ [windowUrl(window)]: page(['det_1'], 'https://example.org/detections?page[offset]=250', 2) });
        await expect(fetchDetectionsWindow(window, noopLog)).rejects.toThrow(/left its origin/);
    });

    it('fails the run on a page the core cannot account for', async () => {
        stubFetch({ [windowUrl(window)]: JSON.stringify({ data: [detection('det_1')], included: [], links: {}, meta: { page: { total: 1 } } }) });
        await expect(fetchDetectionsWindow(window, noopLog)).rejects.toThrow(/parse failed on page 1: detection det_1: feed feed_1 is not in included/);
    });
});
