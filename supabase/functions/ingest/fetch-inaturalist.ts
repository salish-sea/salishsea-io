/**
 * iNaturalist fetch — imperative shell (salishsea-io-89d.2 / decision 011).
 *
 * The two effectful orchestration loops iNat ingest needs; everything they call
 * is the pure functional core (scripts/ingest/inaturalist.ts) or the persist
 * layer (scripts/ingest/persist.ts). Both loops enforce decision 011's
 * completeness invariant: they either produce a PROVABLY COMPLETE fetch or they
 * throw — and a throw makes index.ts write nothing.
 *
 *   A. fetchAllObservationPages — page 1..N through `total_results`; every page
 *      must parse; `isPaginationComplete` must hold; else throw. An empty first
 *      page (total_results = 0) is complete and authoritative.
 *
 *   B. resolveTaxonClosure — resolve the FULL taxon-ancestor closure before the
 *      caller opens the persist transaction (no HTTP inside the DB write). Fetch
 *      the missing taxa, expand their references, recompute still-missing, loop
 *      until empty. A taxa-API failure — or a requested taxon the API won't
 *      return — counts against completeness → throw.
 *
 * Every fetch uses an AbortController timeout: Deno's fetch has no built-in
 * timeout, and a hung connection would block the whole edge invocation.
 */

import type { Sql } from 'postgres';
import {
    MAX_ATTEMPTS,
    retryDelayMs,
    parseRetryAfter,
    isRetryableStatus,
} from '../../../scripts/ingest/retry.ts';
import {
    SALISH_SEA_BBOX,
    INAT_ROOT_TAXON_IDS,
    PER_PAGE,
    parseInatResponse,
    parseInatTaxa,
    referencedTaxonIds,
    referencedTaxonIdsFromTaxa,
    missingTaxonIds,
    expectedPageCount,
    isPaginationComplete,
    type FetchedPage,
    type NormalizedObservation,
    type NormalizedTaxon,
} from '../../../scripts/ingest/inaturalist.ts';
import { fetchExistingTaxonIds, type IngestWindow } from '../../../scripts/ingest/persist.ts';

export type Logger = (msg: string, extra?: Record<string, unknown>) => void;

const OBSERVATIONS_URL = 'https://api.inaturalist.org/v2/observations';
const TAXA_URL = 'https://api.inaturalist.org/v2/taxa';

// Deno fetch has no built-in timeout; bound each attempt so a hung connection
// becomes a retryable AbortError instead of blocking the invocation.
const FETCH_TIMEOUT_MS = 20_000;

// iNat page-based pagination caps at page * per_page <= 10 000 records.
const MAX_PAGE = Math.floor(10_000 / PER_PAGE);

// iNat caps the `/taxa` `id` param at ~30 ids per request.
const TAXA_ID_CHUNK = 30;

// v2 `/observations` field selection. Extends the legacy SQL path's set with the
// fields the functional core now requires: `updated_at` (drives the
// newer-wins upsert), the observation_photo `id`, and `user.orcid` (minted into
// the contributor). Kept as the tight projection iNat's v2 API expects.
const OBSERVATION_FIELDS =
    '(id:!t,description:!t,geojson:!t,license_code:!t,time_observed_at:!t,updated_at:!t,' +
    'uri:!t,public_positional_accuracy:!t,' +
    'observation_photos:(id:!t,position:!t,photo:(id:!t,attribution:!t,hidden:!t,' +
    'license_code:!t,original_dimensions:(height:!t,width:!t),url:!t)),' +
    'taxon:(id:!t,ancestor_ids:!t),' +
    'user:(id:!t,login:!t,name:!t,orcid:!t))';

// v2 `/taxa` field selection (copied from inaturalist.fetch_taxa in migration
// 20250904165159_fetch_data.sql; matches parseInatTaxa's schema).
const TAXA_FIELDS = '(id:!t,ancestor_ids:!t,parent_id:!t,rank:!t,name:!t,preferred_common_name:!t)';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function chunk<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

/**
 * GET a URL with the shell's retry policy and a per-attempt timeout, returning
 * the parsed JSON body on a 2xx. Throws after MAX_ATTEMPTS or on a
 * non-retryable status. The caller turns any throw into a `failed` ingest.runs
 * row and writes nothing (decision 011's "abort on a failed fetch").
 */
async function fetchJsonWithRetry(url: string, label: string, log: Logger): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let res: Response;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            res = await fetch(url, {
                headers: { accept: 'application/json' },
                signal: controller.signal,
            });
        } catch (e) {
            lastError = e;
            if (attempt === MAX_ATTEMPTS) break;
            const delay = retryDelayMs(attempt);
            log('inat fetch error, retrying', { label, attempt, delayMs: delay, error: String(e) });
            await sleep(delay);
            continue;
        } finally {
            clearTimeout(timeout);
        }

        if (res.ok) return await res.json();

        lastError = new Error(`iNaturalist ${label} HTTP ${res.status}`);
        if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) {
            await res.body?.cancel();
            break;
        }
        await res.body?.cancel();
        const delay = retryDelayMs(attempt, parseRetryAfter(res.headers.get('retry-after')));
        log('inat non-2xx, retrying', { label, attempt, status: res.status, delayMs: delay });
        await sleep(delay);
    }

    throw lastError ?? new Error(`iNaturalist ${label} fetch failed`);
}

function observationsUrl(window: IngestWindow, page: number): string {
    const params = new URLSearchParams({
        d1: window.start,
        d2: window.end,
        licensed: 'true',
        nelat: String(SALISH_SEA_BBOX.neLat),
        nelng: String(SALISH_SEA_BBOX.neLng),
        swlat: String(SALISH_SEA_BBOX.swLat),
        swlng: String(SALISH_SEA_BBOX.swLng),
        taxon_id: INAT_ROOT_TAXON_IDS.join(','),
        geoprivacy: 'open',
        taxon_geoprivacy: 'open',
        per_page: String(PER_PAGE),
        page: String(page),
        fields: OBSERVATION_FIELDS,
    });
    return `${OBSERVATIONS_URL}?${params.toString()}`;
}

function taxaUrl(ids: readonly number[]): string {
    const params = new URLSearchParams({
        id: ids.join(','),
        fields: TAXA_FIELDS,
        preferred_place_id: '1',
        preferred_locale: 'en',
    });
    return `${TAXA_URL}?${params.toString()}`;
}

export type ObservationFetchResult = {
    readonly pages: readonly FetchedPage[];
    readonly observations: readonly NormalizedObservation[];
    readonly totalResults: number;
};

/**
 * Loop A. Fetch every page of the window through `total_results`, accumulating
 * FetchedPage metadata and normalized observations. Throws on any parse/HTTP
 * failure, on a window that exceeds iNat's 10 000-record pagination cap, or if
 * the accumulated pages are not provably complete. Returns only on a complete
 * fetch — the precondition reconcile() and persist require.
 */
export async function fetchAllObservationPages(
    window: IngestWindow,
    log: Logger,
): Promise<ObservationFetchResult> {
    const pages: FetchedPage[] = [];
    const observations: NormalizedObservation[] = [];
    let totalResults = 0;

    for (let page = 1; ; page++) {
        const raw = await fetchJsonWithRetry(observationsUrl(window, page), 'observations', log);
        const result = parseInatResponse(raw);
        if (!result.ok) {
            throw new Error(`iNaturalist observations parse failed (page ${page}): ${result.error}`);
        }
        pages.push({ page, totalResults: result.totalResults, recordCount: result.recordCount });
        observations.push(...result.observations);
        totalResults = result.totalResults;

        const expected = expectedPageCount(totalResults, PER_PAGE);
        if (expected > MAX_PAGE) {
            throw new Error(
                `window exceeds iNaturalist pagination cap: total_results=${totalResults} ` +
                    `needs ${expected} pages (max ${MAX_PAGE}); narrow the window`,
            );
        }
        log('inat observations page', {
            page, totalResults, recordCount: result.recordCount, expected,
        });
        if (page >= expected) break;
    }

    if (!isPaginationComplete(pages, PER_PAGE)) {
        throw new Error(
            `iNaturalist pagination incomplete: fetched ${pages.length} page(s) for ` +
                `total_results=${totalResults}`,
        );
    }

    return { pages, observations, totalResults };
}

/**
 * Loop B. Resolve the full taxon-ancestor closure for the fetched observations
 * BEFORE the caller opens the persist transaction. Diff referenced taxa against
 * what's stored, fetch the missing ones (chunked), expand their references, and
 * recompute still-missing until the set is empty. Returns the taxa newly fetched
 * (to be upserted). Throws if a requested taxon cannot be resolved (a taxa-API
 * failure or an id the API won't return) — that counts against completeness.
 */
export async function resolveTaxonClosure(
    sql: Sql,
    observations: readonly NormalizedObservation[],
    log: Logger,
): Promise<NormalizedTaxon[]> {
    const referenced = new Set<number>(referencedTaxonIds(observations));
    const present = new Set<number>(await fetchExistingTaxonIds(sql, [...referenced]));

    const fetchedTaxa: NormalizedTaxon[] = [];
    const fetchedIds = new Set<number>();
    const requested = new Set<number>();

    for (;;) {
        const have = new Set<number>([...present, ...fetchedIds]);
        const missing = missingTaxonIds(referenced, have);
        if (missing.length === 0) break;

        const toFetch = missing.filter((id) => !requested.has(id));
        if (toFetch.length === 0) {
            // Every still-missing id was already requested but never returned —
            // the closure is unresolvable, so the fetch is not complete.
            throw new Error(
                `iNaturalist taxon closure unresolved: ${missing.length} taxa not returned ` +
                    `(e.g. ${missing.slice(0, 10).join(', ')})`,
            );
        }

        for (const ids of chunk(toFetch, TAXA_ID_CHUNK)) {
            for (const id of ids) requested.add(id);
            const raw = await fetchJsonWithRetry(taxaUrl(ids), 'taxa', log);
            const parsed = parseInatTaxa(raw);
            if (!parsed.ok) {
                throw new Error(`iNaturalist taxa parse failed: ${parsed.error}`);
            }
            for (const t of parsed.taxa) {
                if (fetchedIds.has(t.id)) continue;
                fetchedTaxa.push(t);
                fetchedIds.add(t.id);
            }
        }

        // Newly fetched taxa may reference new ancestors → widen the referenced set.
        for (const id of referencedTaxonIdsFromTaxa(fetchedTaxa)) referenced.add(id);
        log('inat taxon closure round', {
            referenced: referenced.size, present: present.size, fetched: fetchedTaxa.length,
        });
    }

    return fetchedTaxa;
}
