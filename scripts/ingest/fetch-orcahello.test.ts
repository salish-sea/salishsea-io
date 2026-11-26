/**
 * Shell test for fetchOrcaHelloDay: one UTC day, a page of 50 at a time, never retried
 * inside a run, never a range longer than a day; a failure stops it with the pages
 * before it already handed over. Against a stubbed page fetcher: this never calls OrcaHello.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchOrcaHelloDay, fetchPage, pageUrl, RECORDS_PER_PAGE } from './fetch-orcahello.ts';
import { isTransientUpstream } from './retry.ts';

const noopLog = () => {};
const detection = (id: string) => ({
    id, modelId: 'FastAI', aiModel: 'OrcaHello', timestamp: '2026-11-20T00:00:54Z',
    location: { id: 'rpi_andrews_bay', name: 'Andrews Bay', longitude: -123.1, latitude: 48.5 },
    annotations: [], reviewed: false, found: 'No', confidence: 70, moderated: '0001-01-01T00:00:00', tagList: [], globalPredictionLabel: '',
});
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => detection(`d${from + i}`));

afterEach(() => vi.unstubAllGlobals());

describe('pageUrl', () => {
    it('asks for one UTC day, oldest first, a page at a time', () => {
        const url = new URL(pageUrl('2026-11-20', 3));
        expect(url.origin).toBe('https://aifororcasdetections.azurewebsites.net');
        expect(Object.fromEntries(url.searchParams)).toEqual({
            Page: '3', RecordsPerPage: '50', Timeframe: 'range', DateFrom: '2026-11-20', DateTo: '2026-11-21',
            SortBy: 'timestamp', SortOrder: 'asc', Location: 'all',
        });
    });
});

describe('fetchOrcaHelloDay', () => {
    it('reads pages until the total is reached, handing each over, and says how many came back', async () => {
        const pages = [ids(0, RECORDS_PER_PAGE), ids(50, RECORDS_PER_PAGE), ids(100, 20)];
        const asked: string[] = [];
        const handed: number[] = [];
        const result = await fetchOrcaHelloDay('2026-11-20', noopLog, rows => handed.push(rows.length), {
            pauseMs: 0,
            getPage: (url) => { asked.push(url); return Promise.resolve({ body: pages[asked.length - 1], total: 120 }); },
        });
        expect(result).toEqual({ total: 120, fetched: 120 });
        expect(handed).toEqual([50, 50, 20]);
        expect(asked.map(u => new URL(u).searchParams.get('Page'))).toEqual(['1', '2', '3']);
    });

    it('stops at a page of exactly the total without asking for an empty one', async () => {
        let asked = 0;
        await fetchOrcaHelloDay('2026-11-20', noopLog, () => {}, {
            pauseMs: 0, getPage: () => { asked++; return Promise.resolve({ body: ids(0, RECORDS_PER_PAGE), total: 50 }); },
        });
        expect(asked).toBe(1);
    });

    it('takes a day with nothing in it', async () => {
        expect(await fetchOrcaHelloDay('2026-11-20', noopLog, () => {}, { pauseMs: 0, getPage: () => Promise.resolve({ body: [], total: 0 }) }))
            .toEqual({ total: 0, fetched: 0 });
    });

    it('reports a day that came back short, so the caller does not call it whole', async () => {
        const result = await fetchOrcaHelloDay('2026-11-20', noopLog, () => {}, {
            pauseMs: 0, getPage: () => Promise.resolve({ body: ids(0, 20), total: 120 }),
        });
        expect(result).toEqual({ total: 120, fetched: 20 });
    });

    it('stops at the first failure, keeping the pages before it, and does not try again', async () => {
        const handed: number[] = [];
        let asked = 0;
        await expect(fetchOrcaHelloDay('2026-11-20', noopLog, rows => handed.push(rows.length), {
            pauseMs: 0,
            getPage: () => {
                asked++;
                return asked === 1 ? Promise.resolve({ body: ids(0, RECORDS_PER_PAGE), total: 200 }) : Promise.reject(new Error('OrcaHello HTTP 503'));
            },
        })).rejects.toThrow(/503/);
        expect(handed).toEqual([50]);
        expect(asked).toBe(2);
    });

    it('fails on a page it cannot read', async () => {
        await expect(fetchOrcaHelloDay('2026-11-20', noopLog, () => {}, { pauseMs: 0, getPage: () => Promise.resolve({ body: { error: 1 }, total: 1 }) }))
            .rejects.toThrow(/parse failed on page 1 of 2026-11-20/);
    });
});

describe('fetchPage', () => {
    const answer = (status: number, body = '', headers: Record<string, string> = {}) =>
        vi.stubGlobal('fetch', () => Promise.resolve(new Response(status === 204 ? null : body, { status, headers })));

    it('reads the body and the total from the header', async () => {
        answer(200, JSON.stringify([detection('d1')]), { totalNumberRecords: '286' });
        expect(await fetchPage('https://aifororcasdetections.azurewebsites.net/api/detections')).toEqual({ body: [detection('d1')], total: 286 });
    });

    it('takes 204 and an empty body as no detections', async () => {
        answer(204);
        expect(await fetchPage('https://example.org/')).toEqual({ body: [], total: 0 });
        answer(200, '  ');
        expect(await fetchPage('https://example.org/')).toEqual({ body: [], total: 0 });
    });

    it('marks a 5xx, a 403 and a 429 transient, and another refusal not', async () => {
        for (const status of [500, 503, 403, 429]) {
            answer(status);
            await expect(fetchPage('https://example.org/').catch(e => isTransientUpstream(e))).resolves.toBe(true);
        }
        answer(404);
        await expect(fetchPage('https://example.org/')).rejects.toThrow(/404/);
        await expect(fetchPage('https://example.org/').catch(e => isTransientUpstream(e))).resolves.toBe(false);
    });

    it('marks a refused connection and a body that is not JSON transient', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));
        await expect(fetchPage('https://example.org/').catch(e => isTransientUpstream(e))).resolves.toBe(true);
        answer(200, '<html>Site Disabled</html>');
        await expect(fetchPage('https://example.org/').catch(e => isTransientUpstream(e))).resolves.toBe(true);
    });
});
