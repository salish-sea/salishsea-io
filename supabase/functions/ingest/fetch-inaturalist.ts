/**
 * iNaturalist fetch — imperative shell (salishsea-io-89d.2 / decision 011).
 *
 * The two effectful orchestration loops iNat ingest needs; everything they call
 * is the pure functional core (scripts/ingest/inaturalist.ts) or the persist
 * layer (scripts/ingest/persist.ts). Both loops enforce decision 011's
 * completeness invariant: they either produce a PROVABLY COMPLETE fetch or they
 * throw — and a throw makes index.ts write nothing.
 *
 *   A. fetchAllObservationPages — sweep the window by ASCENDING observation id
 *      (id-keyset/cursor pagination, decision 018): fetch `id_above=<lastId>`
 *      pages until one returns fewer than `per_page` rows (the terminal page).
 *      Every page must parse; else throw. An empty first page is terminal — an
 *      authoritative empty window. Immutable ids give a consistent forward
 *      snapshot, so a mutation mid-sweep no longer drifts completeness (the class
 *      of failure PR #327's bounded re-page only retried around), and iNat's
 *      page*per_page ≤ 10 000 cap no longer applies.
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
    isTerminalPage,
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

// iNat caps the `/taxa` `id` param at ~30 ids per request.
const TAXA_ID_CHUNK = 30;

// id-keyset pagination has no page*per_page cap and no live-window drift, but a
// pathological window (or a cursor bug) could otherwise loop unbounded and hang
// the edge invocation. Bound the sweep so a runaway fails loudly instead. The
// 10-day rolling window realistically holds hundreds of records; 1000 pages
// (200 000 records) is a generous backstop, not an expected limit.
const MAX_KEYSET_PAGES = 1000;

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

/** Collapse a response body to a single-line snippet for error messages. */
function bodySnippet(text: string, max = 200): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length === 0) return '(empty body)';
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res: Response;
        try {
            res = await fetch(url, {
                headers: { accept: 'application/json' },
                signal: controller.signal,
            });
            if (res.ok) {
                // Read the body under the SAME timeout: a server can send headers
                // and then stall, and reading it would otherwise hang past the
                // deadline. Clear the timer only once the body is fully consumed.
                const text = await res.text();
                clearTimeout(timeout);
                try {
                    return JSON.parse(text) as unknown;
                } catch {
                    // A 200 with a non-JSON body (upstream error page/proxy blip).
                    // Throw a snippet of what was actually returned rather than an
                    // opaque JSON-parse position; still retried like any transient.
                    throw new Error(
                        `iNaturalist ${label} returned a non-JSON ${res.status} body ` +
                            `(${text.length} chars): ${bodySnippet(text)}`,
                    );
                }
            }
        } catch (e) {
            // fetch-level failure, abort (timeout), or a stalled/aborted body read
            clearTimeout(timeout);
            lastError = e;
            if (attempt === MAX_ATTEMPTS) break;
            const delay = retryDelayMs(attempt);
            log('inat fetch error, retrying', { label, attempt, delayMs: delay, error: String(e) });
            await sleep(delay);
            continue;
        }

        // Non-2xx: res is defined and not ok.
        clearTimeout(timeout);
        lastError = new Error(`iNaturalist ${label} HTTP ${res.status}`);
        await res.body?.cancel();
        if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) break;
        const delay = retryDelayMs(attempt, parseRetryAfter(res.headers.get('retry-after')));
        log('inat non-2xx, retrying', { label, attempt, status: res.status, delayMs: delay });
        await sleep(delay);
    }

    throw lastError ?? new Error(`iNaturalist ${label} fetch failed`);
}

// id-keyset page: ascending id, records with id strictly greater than `idAbove`
// (0 → from the smallest id). No `page` param — the cursor, not an offset, walks
// the window, which is what makes the sweep immune to live-window drift.
function observationsUrl(window: IngestWindow, idAbove: number): string {
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
        order_by: 'id',
        order: 'asc',
        id_above: String(idAbove),
        per_page: String(PER_PAGE),
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
    /** Raw records fetched across the window (sum of per-page counts). */
    readonly recordCount: number;
};

/**
 * Loop A. Sweep the window by ASCENDING observation id (id-keyset pagination,
 * decision 018) and return only a PROVABLY COMPLETE snapshot (decision 011) — the
 * precondition reconcile() and persist require.
 *
 * Each request asks for the next `id_above=<lastId>` page; the sweep ends at the
 * TERMINAL page (fewer than `per_page` rows), which under ascending-id ordering
 * cannot be followed by more. Because the cursor is an immutable id, an
 * observation created/edited/deleted between two requests no longer drifts a
 * completeness sum — the class of transient failure PR #327's bounded re-page
 * only retried around. Still throws on parse/HTTP failure, or if the sweep
 * exceeds MAX_KEYSET_PAGES (a runaway) — a genuine failure the next cron retries.
 */
export async function fetchAllObservationPages(
    window: IngestWindow,
    log: Logger,
): Promise<ObservationFetchResult> {
    const pages: FetchedPage[] = [];
    const observations: NormalizedObservation[] = [];
    let cursor = 0; // id_above=0 → start from the smallest id

    for (let pageNum = 1; ; pageNum++) {
        if (pageNum > MAX_KEYSET_PAGES) {
            throw new Error(
                `iNaturalist keyset sweep exceeded ${MAX_KEYSET_PAGES} pages ` +
                    `(cursor id_above=${cursor}); window implausibly large or a cursor bug`,
            );
        }

        const raw = await fetchJsonWithRetry(observationsUrl(window, cursor), 'observations', log);
        const result = parseInatResponse(raw);
        if (!result.ok) {
            throw new Error(
                `iNaturalist observations parse failed (id_above ${cursor}): ${result.error}`,
            );
        }
        pages.push({ recordCount: result.recordCount, maxId: result.maxId });
        observations.push(...result.observations);
        log('inat observations page', {
            page: pageNum, idAbove: cursor, recordCount: result.recordCount, maxId: result.maxId,
        });

        if (isTerminalPage(result.recordCount, PER_PAGE)) break;

        // A full page must carry a max id to advance the cursor past; recordCount
        // === PER_PAGE implies maxId != null, but guard rather than loop forever.
        if (result.maxId == null) {
            throw new Error(
                `iNaturalist keyset cursor stuck: full page with no max id at id_above=${cursor}`,
            );
        }
        cursor = result.maxId;
    }

    // The terminal-page exit structurally proves completeness; assert decision
    // 011's invariant defensively before the caller reconciles/persists.
    if (!isPaginationComplete(pages, PER_PAGE)) {
        throw new Error(
            `iNaturalist keyset pagination did not converge to a complete snapshot ` +
                `(${pages.length} page(s))`,
        );
    }

    const recordCount = pages.reduce((n, p) => n + p.recordCount, 0);
    return { pages, observations, recordCount };
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
