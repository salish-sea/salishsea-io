/**
 * Shell test for fetchAllObservationPages' bounded re-page loop (salishsea-io-h79
 * / Sentry SALISHSEA-IO-2D). iNat page-based pagination is not atomic over a live
 * window; a mutation between two page requests drifts total_results so the
 * accumulated pages fail isPaginationComplete. The shell must re-page the whole
 * window a bounded number of times before surfacing that as a real failure.
 *
 * We stub global fetch (no network) to script drift-then-consistent responses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllObservationPages } from './fetch-inaturalist.ts';
import type { IngestWindow } from '../../../scripts/ingest/persist.ts';

const WINDOW: IngestWindow = { start: '2026-06-29', end: '2026-07-09' };
const noopLog = () => {};

/** One minimal valid v2 /observations record (passes InatObservationSchema). */
function record(id: number) {
    return {
        id,
        geojson: { coordinates: [-123, 48] },
        license_code: 'cc-by',
        uri: `https://www.inaturalist.org/observations/${id}`,
        updated_at: '2026-07-01T00:00:00+00:00',
        time_observed_at: '2026-07-01T00:00:00+00:00',
        observation_photos: [],
        taxon: { id: 152871, ancestor_ids: [152871] },
        user: { id: 1, login: 'observer' },
    };
}

/** A page body: `total_results` reported plus `count` real records (from startId). */
function pageBody(page: number, totalResults: number, count: number, startId: number) {
    return {
        total_results: totalResults,
        page,
        per_page: 200,
        results: Array.from({ length: count }, (_, i) => record(startId + i)),
    };
}

/** Stub global fetch to return each queued body once, in order. */
function stubFetch(bodies: unknown[]) {
    let i = 0;
    vi.stubGlobal('fetch', () => {
        const body = bodies[i++];
        if (body === undefined) throw new Error(`unexpected fetch #${i}`);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchAllObservationPages re-pages on live-window drift', () => {
    it('returns the snapshot on the first consistent pass (no drift)', async () => {
        // total 250 → 2 pages (200 + 50), totals stable → complete on attempt 1.
        stubFetch([pageBody(1, 250, 200, 1), pageBody(2, 250, 50, 201)]);

        const result = await fetchAllObservationPages(WINDOW, noopLog);

        expect(result.totalResults).toBe(250);
        expect(result.pages.map((p) => p.recordCount)).toEqual([200, 50]);
        expect(result.observations).toHaveLength(250);
    });

    it('retries the whole window and succeeds once the dataset settles', async () => {
        // Attempt 1: page 2 reports a drifted total (251) → incomplete.
        // Attempt 2: totals agree (250) → complete.
        stubFetch([
            pageBody(1, 250, 200, 1),
            pageBody(2, 251, 51, 201),
            pageBody(1, 250, 200, 1),
            pageBody(2, 250, 50, 201),
        ]);

        const result = await fetchAllObservationPages(WINDOW, noopLog);

        expect(result.totalResults).toBe(250);
        expect(result.pages.map((p) => p.recordCount)).toEqual([200, 50]);
    });

    it('throws after exhausting attempts when the window never settles', async () => {
        // Every attempt drifts (page 2 total ≠ page 1 total): 3 attempts × 2 pages.
        stubFetch([
            pageBody(1, 250, 200, 1), pageBody(2, 251, 51, 201),
            pageBody(1, 250, 200, 1), pageBody(2, 251, 51, 201),
            pageBody(1, 250, 200, 1), pageBody(2, 251, 51, 201),
        ]);

        await expect(fetchAllObservationPages(WINDOW, noopLog)).rejects.toThrow(
            /pagination incomplete after 3 attempts/,
        );
    });
});
