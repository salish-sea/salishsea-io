/**
 * Shell test for fetchAllObservationPages' id-keyset sweep (salishsea-io-7up /
 * decision 018, durable fix for Sentry SALISHSEA-IO-2D). The shell walks the
 * window by ASCENDING observation id (id_above=<lastId>) until a page returns
 * fewer than per_page rows. Because the cursor is an immutable id, a mutation
 * mid-sweep no longer drifts a completeness sum — the class of failure PR #327's
 * bounded re-page only retried around.
 *
 * We stub global fetch (no network) to script keyset pages and assert both the
 * accumulated snapshot and that the id_above cursor advances by each page's max id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllObservationPages, resolveTaxonClosure } from './fetch-inaturalist.ts';
import type { IngestWindow } from '../../../scripts/ingest/persist.ts';
import type { Sql } from 'postgres';
import type { NormalizedObservation } from '../../../scripts/ingest/inaturalist.ts';

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

/**
 * A keyset page: `count` records with ascending ids from `startId`. `totalResults`
 * is deliberately variable to prove the sweep ignores it (it is no longer
 * load-bearing under id-keyset pagination).
 */
function pageBody(count: number, startId: number, totalResults = 9999) {
    return {
        total_results: totalResults,
        page: 1,
        per_page: 200,
        results: Array.from({ length: count }, (_, i) => record(startId + i)),
    };
}

/** Stub global fetch to return each queued body once, in order; returns the URLs seen. */
function stubFetch(bodies: unknown[]): string[] {
    const urls: string[] = [];
    let i = 0;
    vi.stubGlobal('fetch', (url: string) => {
        urls.push(String(url));
        const body = bodies[i++];
        if (body === undefined) throw new Error(`unexpected fetch #${i}`);
        // The shell reads res.text() then JSON.parse()s it; return the serialized body.
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
    });
    return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchAllObservationPages sweeps the window by ascending id', () => {
    it('completes on a single short first page (one request, id_above=0)', async () => {
        const urls = stubFetch([pageBody(50, 1)]);

        const result = await fetchAllObservationPages(WINDOW, noopLog);

        expect(result.recordCount).toBe(50);
        expect(result.observations).toHaveLength(50);
        expect(result.pages.map((p) => p.recordCount)).toEqual([50]);
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('id_above=0');
    });

    it('advances the id_above cursor by each page\'s max id, ending on a terminal short page', async () => {
        const urls = stubFetch([
            pageBody(200, 1),   // ids 1..200   → cursor 200
            pageBody(200, 201), // ids 201..400 → cursor 400
            pageBody(50, 401),  // ids 401..450 → terminal (< 200)
        ]);

        const result = await fetchAllObservationPages(WINDOW, noopLog);

        expect(result.recordCount).toBe(450);
        expect(result.observations).toHaveLength(450);
        expect(result.pages.map((p) => p.recordCount)).toEqual([200, 200, 50]);
        expect(urls[0]).toContain('id_above=0');
        expect(urls[1]).toContain('id_above=200');
        expect(urls[2]).toContain('id_above=400');
    });

    it('treats a drifting total_results as noise (immune to live-window mutation)', async () => {
        // Wildly inconsistent total_results across pages — the OLD total-sum check
        // would have failed this; the id-keyset sweep completes on the short page.
        const urls = stubFetch([
            pageBody(200, 1, 9999),
            pageBody(200, 201, 5),
            pageBody(10, 401, 123456),
        ]);

        const result = await fetchAllObservationPages(WINDOW, noopLog);

        expect(result.recordCount).toBe(410);
        expect(result.pages.map((p) => p.recordCount)).toEqual([200, 200, 10]);
        expect(urls).toHaveLength(3);
    });

    it('follows an exactly-full window with a terminal empty page', async () => {
        // total is a multiple of per_page: the last full page yields a 0-row page.
        const urls = stubFetch([pageBody(200, 1), pageBody(0, 201)]);

        const result = await fetchAllObservationPages(WINDOW, noopLog);

        expect(result.recordCount).toBe(200);
        expect(result.observations).toHaveLength(200);
        expect(urls[1]).toContain('id_above=200');
    });

    it('completes on an authoritative empty window (first page has no records)', async () => {
        stubFetch([pageBody(0, 1)]);

        const result = await fetchAllObservationPages(WINDOW, noopLog);

        expect(result.recordCount).toBe(0);
        expect(result.observations).toHaveLength(0);
    });

    it('throws when the sweep never terminates (runaway bound)', async () => {
        // Always return a full page with advancing ids: the cursor keeps moving but
        // no terminal page ever arrives, so the sweep must hit MAX_KEYSET_PAGES.
        let startId = 1;
        vi.stubGlobal('fetch', () => {
            const body = pageBody(200, startId);
            startId += 200;
            return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) });
        });

        await expect(fetchAllObservationPages(WINDOW, noopLog)).rejects.toThrow(
            /keyset sweep exceeded 1000 pages/,
        );
    });
});

/**
 * Shell test for the taxon closure over a RETIRED taxon (salish-5ds).
 *
 * The closure used to ask `/taxa?id=<list>`, where the id QUERY PARAM filters to
 * active taxa: a retired id came back as `total_results: 0` — indistinguishable from
 * an id that never existed — and resolveTaxonClosure throws on an id it requested but
 * did not get back. One taxon retired upstream since the last run therefore aborted
 * the whole ingest and wrote nothing. The `/taxa/{ids}` PATH form returns it flagged
 * instead, which is what these tests pin.
 *
 * Fetch is stubbed to answer from a fixed table of taxa, keyed by the ids in the
 * request PATH, so a test that regressed to the query form would find no ids there
 * and fail rather than quietly pass.
 */
describe('resolveTaxonClosure over a retired taxon', () => {
    /** Only what fetchExistingTaxonIds does: SELECT ids already stored. */
    const storedSql = (ids: number[]) =>
        (() => Promise.resolve(ids.map((id) => ({ id })))) as unknown as Sql;

    /** One minimal valid v2 /taxa record (passes InatTaxonSchema). */
    function taxonRecord(
        id: number,
        over: Partial<{ ancestor_ids: number[]; parent_id: number | null;
                        is_active: boolean; current_synonymous_taxon_ids: number[] | null }> = {},
    ) {
        return {
            id, ancestor_ids: [id], parent_id: null, rank: 'species',
            name: `Testus ${id}`, preferred_common_name: null,
            is_active: true, current_synonymous_taxon_ids: null, ...over,
        };
    }

    /**
     * Serve taxa by the ids in the request path — the path form's actual contract.
     * Ids absent from `table` are simply not returned, which is how upstream answers
     * for a genuinely unknown id.
     */
    function stubTaxaFetch(table: Record<number, unknown>): string[] {
        const urls: string[] = [];
        vi.stubGlobal('fetch', (url: string) => {
            urls.push(String(url));
            const path = new URL(String(url)).pathname.split('/').pop() ?? '';
            const ids = path.split(',').map(Number).filter((n) => Number.isFinite(n));
            const results = ids.map((id) => table[id]).filter((t) => t !== undefined);
            return Promise.resolve({
                ok: true, status: 200,
                text: () => Promise.resolve(JSON.stringify({ total_results: results.length, results })),
            });
        });
        return urls;
    }

    const observation = (taxonId: number, ancestorIds: number[]): NormalizedObservation => ({
        id: 1, description: null, lon: -123, lat: 48, observedAt: '2026-07-04T13:08:00-07:00',
        licenseCode: 'cc-by-nc', uri: 'https://inat/1', login: 'u', orcid: null,
        taxonId, ancestorIds, publicPositionalAccuracy: null,
        updatedAt: '2026-07-05T20:08:06-07:00', photos: [],
    });

    it('asks by the path form, not the retired-taxon-hiding id= query param', async () => {
        const urls = stubTaxaFetch({ 5: taxonRecord(5) });

        await resolveTaxonClosure(storedSql([]), [observation(5, [5])], noopLog);

        expect(urls[0]).toContain('/v2/taxa/5?');
        expect(urls[0]).not.toContain('id=5');
    });

    it('resolves a retired taxon instead of aborting the run', async () => {
        const urls = stubTaxaFetch({
            10: taxonRecord(10, { ancestor_ids: [5, 10], parent_id: 5, is_active: false,
                                  current_synonymous_taxon_ids: [20] }),
            20: taxonRecord(20, { ancestor_ids: [5, 20], parent_id: 5 }),
            5: taxonRecord(5),
        });

        const taxa = await resolveTaxonClosure(storedSql([]), [observation(10, [5, 10])], noopLog);

        const retired = taxa.find((t) => t.id === 10);
        expect(retired?.isActive).toBe(false);
        expect(retired?.currentTaxonId).toBe(20);
        // The replacement is fetched too: current_taxon_id is a NOT DEFERRABLE FK, so
        // recording the retirement without it would fail the persist.
        expect(taxa.map((t) => t.id).sort((a, b) => a - b)).toEqual([5, 10, 20]);
        expect(urls).toHaveLength(2); // first the referenced pair, then the replacement
    });

    it('still throws for an id upstream genuinely does not know', async () => {
        stubTaxaFetch({ 5: taxonRecord(5) }); // 10 is absent entirely

        await expect(
            resolveTaxonClosure(storedSql([]), [observation(10, [5, 10])], noopLog),
        ).rejects.toThrow(/taxon closure unresolved/);
    });

    it('does not re-ask for a replacement already in the mirror', async () => {
        const urls = stubTaxaFetch({
            10: taxonRecord(10, { is_active: false, current_synonymous_taxon_ids: [20] }),
        });

        const taxa = await resolveTaxonClosure(storedSql([20]), [observation(10, [10])], noopLog);

        expect(taxa.map((t) => t.id)).toEqual([10]);
        expect(urls).toHaveLength(1);
    });
});
