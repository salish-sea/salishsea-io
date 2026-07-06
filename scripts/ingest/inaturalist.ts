/**
 * iNaturalist ingest — functional core (epic salishsea-io-89d.2 / decision 011).
 *
 * Pure, runtime-agnostic transforms over iNaturalist's v2 `/observations` and
 * `/taxa` JSON. No I/O, no DB, no Deno/Node APIs — importable unchanged by the
 * Deno Edge Function shell and by vitest. All effects (fetch, paginate, retry,
 * persist, log) live in the imperative shell; everything here is data-in,
 * data-out and exhaustively unit-tested.
 *
 * Boundary discipline (decision 008): this validates and translates *upstream*
 * iNaturalist records into our normalized shape. Upstream field semantics stop
 * here.
 *
 * The two hard parts of iNat ingest (decision 011) both reduce to pure helpers
 * this module owns; the loops/effects around them are the shell's job:
 *
 *   1. Pagination completeness — `isPaginationComplete` decides whether the shell
 *      has accumulated every page through `total_results`. A fetch is COMPLETE
 *      only if page 1..N (N = ceil(total/per_page)) each returned 200 with a
 *      well-formed body and the record counts sum to `total_results`. An empty
 *      first page (`total_results = 0`) is complete and authoritative. Any missing
 *      or failed page → not complete → the shell writes nothing.
 *
 *   2. Taxon-ancestor closure — `referencedTaxonIds` extracts the taxon ids an
 *      observation batch needs (self + ancestors); `missingTaxonIds` diffs that
 *      against what's already stored; `parseInatTaxa` + `referencedTaxonIdsFromTaxa`
 *      let the shell expand newly-fetched taxa and recompute the still-missing set.
 *      The shell loops fetch → recompute until the set is empty (closure), all
 *      BEFORE opening the persist transaction. A taxon-API failure counts against
 *      fetch-completeness (shell aborts, writes nothing).
 *
 * Persist-time resolutions kept in SQL (see persist.ts / decision 011), unchanged
 * from the prior path:
 *   - provider_id     — column DEFAULT (3 = iNaturalist).
 *   - collection_id   — column DEFAULT (8 = iNaturalist).
 *   - contributor_id  — inaturalist.mint_contributor(login, orcid), a DB upsert
 *                       against public.contributors (a relational lookup, not a
 *                       transform, exactly like maplify.resolve_collection).
 */

import { z } from 'zod';

/** Salish Sea bounding box (decision 009); the shell passes it to the query. */
export const SALISH_SEA_BBOX = { swLng: -136, swLat: 36, neLng: -120, neLat: 54 } as const;

/** In-scope root taxa: Cetacea, Phocoidea (pinnipeds), Lutrinae (otters). */
export const INAT_ROOT_TAXON_IDS: readonly number[] = [152871, 372843, 526556];

/** iNat page-based pagination page size; also its per-page cap. */
export const PER_PAGE = 200;

/** public.license enum values (introspected 2026-07-05). */
export const LICENSE_CODES = [
    'cc0', 'cc-by', 'cc-by-nc', 'cc-by-sa', 'cc-by-nd', 'cc-by-nc-sa', 'cc-by-nc-nd', 'none',
] as const;

/** inaturalist.rank enum values (introspected 2026-07-05). */
export const TAXON_RANKS = [
    'infrahybrid', 'form', 'variety', 'subspecies', 'hybrid', 'species', 'complex',
    'subsection', 'section', 'subgenus', 'genushybrid', 'genus', 'subtribe', 'tribe',
    'supertribe', 'subfamily', 'family', 'epifamily', 'superfamily', 'zoosubsection',
    'zoosection', 'parvorder', 'infraorder', 'suborder', 'order', 'superorder',
    'subterclass', 'infraclass', 'subclass', 'class', 'superclass', 'subphylum',
    'phylum', 'kingdom', 'stateofmatter',
] as const;

/** '' or absent → null; otherwise the value validated against the license enum. */
const licenseSchema = z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.enum(LICENSE_CODES).nullable(),
);

const blankToNull = (s: string | null | undefined): string | null => {
    const t = s?.trim();
    return t ? t : null;
};

// --------------------------------------------------------------------------
// Upstream schemas. Strict enough that a malformed record fails the WHOLE
// response (see parseInatResponse) rather than being silently dropped — a
// dropped record would otherwise become a reconcile delete-candidate, risking
// data loss on a transient upstream glitch (same rationale as Maplify).
// --------------------------------------------------------------------------

const InatPhotoSchema = z.object({
    id: z.number().int(),
    attribution: z.string(),
    hidden: z.boolean(),
    license_code: licenseSchema,
    original_dimensions: z.object({ height: z.number().int(), width: z.number().int() }),
    url: z.string(),
});

const InatObservationPhotoSchema = z.object({
    id: z.number().int(),
    position: z.number().int(),
    photo: InatPhotoSchema,
});

const InatGeojsonSchema = z.object({
    // GeoJSON Point: [lon, lat]. Tuple (not array) so the two coords narrow to
    // `number` under noUncheckedIndexedAccess.
    coordinates: z.tuple([z.number(), z.number()]),
});

const InatUserSchema = z.object({
    id: z.number().int(),
    login: z.string(),
    name: z.string().nullish(),
    orcid: z.string().nullish(),
});

const InatTaxonRefSchema = z.object({
    id: z.number().int(),
    // ancestor_ids is the full root→self chain and INCLUDES self as the last
    // element (verified against live data 2026-07-05).
    ancestor_ids: z.array(z.number().int()),
});

export const InatObservationSchema = z.object({
    id: z.number().int(),
    description: z.string().nullish(),
    geojson: InatGeojsonSchema,
    license_code: licenseSchema,
    // NULLABLE, not required: a record with time_observed_at === null is VALID
    // upstream but out of scope for us — parseInatResponse SKIPS it (mirrors the
    // live `WHERE time_observed_at IS NOT NULL`). It is not a malformed record.
    time_observed_at: z.string().nullish(),
    uri: z.string(),
    public_positional_accuracy: z.number().int().nullish(),
    updated_at: z.string(),
    observation_photos: z.array(InatObservationPhotoSchema),
    taxon: InatTaxonRefSchema,
    user: InatUserSchema,
});

export const InatResponseSchema = z.object({
    // Live API returns these as genuine ints (NOT strings, unlike Maplify's
    // `count`). total_results drives pagination completeness.
    total_results: z.number().int(),
    page: z.number().int().nullish(),
    per_page: z.number().int().nullish(),
    results: z.array(InatObservationSchema),
});

export const InatTaxonSchema = z.object({
    id: z.number().int(),
    ancestor_ids: z.array(z.number().int()),
    parent_id: z.number().int().nullish(),
    rank: z.enum(TAXON_RANKS),
    name: z.string(),
    preferred_common_name: z.string().nullish(),
});

export const InatTaxaResponseSchema = z.object({
    results: z.array(InatTaxonSchema),
});

// --------------------------------------------------------------------------
// Normalized shapes — map 1:1 to the columns the shell persists.
// --------------------------------------------------------------------------

/** One normalized photo, child of an observation. */
export type NormalizedPhoto = {
    readonly id: number;
    readonly seq: number;
    readonly attribution: string;
    readonly hidden: boolean;
    readonly license: (typeof LICENSE_CODES)[number] | null;
    readonly height: number;
    readonly width: number;
    readonly url: string;
};

/** One normalized observation; photos travel with their parent. */
export type NormalizedObservation = {
    readonly id: number;
    readonly description: string | null;
    readonly lon: number;
    readonly lat: number;
    /** ISO8601 with offset, verbatim from time_observed_at (cast to timestamptz at persist). */
    readonly observedAt: string;
    readonly licenseCode: (typeof LICENSE_CODES)[number] | null;
    readonly uri: string;
    readonly login: string;
    readonly orcid: string | null;
    readonly taxonId: number;
    /** Full root→self ancestor chain, for taxon-closure resolution. */
    readonly ancestorIds: readonly number[];
    readonly publicPositionalAccuracy: number | null;
    /** ISO8601 with offset, verbatim from updated_at (cast to timestamp at persist). */
    readonly updatedAt: string;
    readonly photos: readonly NormalizedPhoto[];
};

/** One normalized taxon row (the taxa closure the shell resolves before persist). */
export type NormalizedTaxon = {
    readonly id: number;
    readonly parentId: number | null;
    readonly scientificName: string;
    readonly vernacularName: string | null;
    readonly rank: (typeof TAXON_RANKS)[number];
    /** Full root→self ancestor chain; lets the shell expand the closure. */
    readonly ancestorIds: readonly number[];
};

function normalizePhoto(p: z.infer<typeof InatObservationPhotoSchema>): NormalizedPhoto {
    return {
        id: p.photo.id,
        seq: p.position,
        attribution: p.photo.attribution,
        hidden: p.photo.hidden,
        license: p.photo.license_code,
        height: p.photo.original_dimensions.height,
        width: p.photo.original_dimensions.width,
        url: p.photo.url,
    };
}

/** Normalize one validated observation. Precondition: time_observed_at is present. */
export function normalizeObservation(
    r: z.infer<typeof InatObservationSchema>,
    observedAt: string,
): NormalizedObservation {
    return {
        id: r.id,
        description: blankToNull(r.description),
        lon: r.geojson.coordinates[0],
        lat: r.geojson.coordinates[1],
        observedAt,
        licenseCode: r.license_code,
        uri: r.uri,
        login: r.user.login,
        orcid: blankToNull(r.user.orcid),
        taxonId: r.taxon.id,
        ancestorIds: r.taxon.ancestor_ids,
        publicPositionalAccuracy: r.public_positional_accuracy ?? null,
        updatedAt: r.updated_at,
        photos: r.observation_photos.map(normalizePhoto),
    };
}

/** Normalize one validated taxon. Pure. */
export function normalizeTaxon(t: z.infer<typeof InatTaxonSchema>): NormalizedTaxon {
    return {
        id: t.id,
        parentId: t.parent_id ?? null,
        scientificName: t.name,
        vernacularName: blankToNull(t.preferred_common_name),
        rank: t.rank,
        ancestorIds: t.ancestor_ids,
    };
}

export type InatParseResult =
    | {
          readonly ok: true;
          readonly observations: readonly NormalizedObservation[];
          readonly totalResults: number;
          /** Raw page result count BEFORE null-time skipping — feeds the completeness sum. */
          readonly recordCount: number;
          readonly page: number | null;
      }
    | { readonly ok: false; readonly error: string };

/**
 * Validate and normalize ONE page of an iNat `/observations` response.
 *
 * Returns ok:false if the envelope or ANY record is malformed — the shell then
 * treats the fetch as not-complete and aborts (writes nothing), never reconciling
 * against a partially-trusted response (decision 011).
 *
 * Records with `time_observed_at === null` are SKIPPED (not persisted, out of
 * scope) but still count toward `recordCount`, because `total_results` counts
 * them too — the completeness sum must reconcile against the raw page size.
 */
export function parseInatResponse(raw: unknown): InatParseResult {
    const parsed = InatResponseSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
    }
    const observations: NormalizedObservation[] = [];
    for (const r of parsed.data.results) {
        const observedAt = r.time_observed_at;
        if (observedAt == null) continue; // out of scope; skip (mirrors live SQL)
        observations.push(normalizeObservation(r, observedAt));
    }
    return {
        ok: true,
        observations,
        totalResults: parsed.data.total_results,
        recordCount: parsed.data.results.length,
        page: parsed.data.page ?? null,
    };
}

export type InatTaxaParseResult =
    | { readonly ok: true; readonly taxa: readonly NormalizedTaxon[] }
    | { readonly ok: false; readonly error: string };

/** Validate and normalize an iNat `/taxa` response. Malformed → ok:false. */
export function parseInatTaxa(raw: unknown): InatTaxaParseResult {
    const parsed = InatTaxaResponseSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
    }
    return { ok: true, taxa: parsed.data.results.map(normalizeTaxon) };
}

// --------------------------------------------------------------------------
// Taxon-ancestor closure (pure diffs). The shell drives the fetch loop.
// --------------------------------------------------------------------------

/**
 * Every taxon id an observation batch depends on: each observation's taxon plus
 * its full ancestor chain. Sorted & deduped. The observations' `ancestor_ids`
 * already include self, but taxonId is unioned in defensively.
 */
export function referencedTaxonIds(observations: readonly NormalizedObservation[]): number[] {
    const s = new Set<number>();
    for (const o of observations) {
        s.add(o.taxonId);
        for (const a of o.ancestorIds) s.add(a);
    }
    return [...s].sort((a, b) => a - b);
}

/**
 * Every taxon id a batch of *fetched taxa* references — self, ancestors, and
 * parent. Used by the shell to expand the closure after each `/taxa` fetch and
 * recompute what's still missing.
 */
export function referencedTaxonIdsFromTaxa(taxa: readonly NormalizedTaxon[]): number[] {
    const s = new Set<number>();
    for (const t of taxa) {
        s.add(t.id);
        if (t.parentId != null) s.add(t.parentId);
        for (const a of t.ancestorIds) s.add(a);
    }
    return [...s].sort((a, b) => a - b);
}

/**
 * The referenced ids not yet present in the store. Pure diff — the shell loops
 * (fetch missing → parse → union new references → recompute missing) until this
 * returns empty (closure resolved) before opening the persist transaction.
 */
export function missingTaxonIds(
    referenced: Iterable<number>,
    present: Iterable<number>,
): number[] {
    const have = new Set(present);
    const out = new Set<number>();
    for (const id of referenced) if (!have.has(id)) out.add(id);
    return [...out].sort((a, b) => a - b);
}

// --------------------------------------------------------------------------
// Pagination completeness (the core safety predicate).
// --------------------------------------------------------------------------

/** Metadata the shell records for each page it successfully fetched & parsed. */
export type FetchedPage = {
    readonly page: number;
    readonly totalResults: number;
    /** Raw result count for this page (before null-time skipping). */
    readonly recordCount: number;
};

/**
 * Number of pages that must be fetched to cover `totalResults` at `perPage`.
 * `totalResults === 0` still requires the ONE page (page 1) that authoritatively
 * reported the empty result. NB: iNat caps page-based pagination at 10 000
 * records, so a window with total > 10 000 cannot be completed by this route —
 * `isPaginationComplete` will (honestly) never return true for it, and the shell
 * aborts rather than persist a truncated view.
 */
export function expectedPageCount(totalResults: number, perPage: number): number {
    if (perPage <= 0) return 0;
    if (totalResults <= 0) return 1;
    return Math.ceil(totalResults / perPage);
}

/**
 * Whether the accumulated pages constitute a PROVABLY COMPLETE fetch (decision
 * 011's central invariant). Complete iff:
 *   - at least page 1 was fetched;
 *   - every page reports the same total_results (no shifting ground);
 *   - the fetched page numbers are exactly 1..N with no gap or duplicate,
 *     where N = expectedPageCount(total, perPage);
 *   - the per-page record counts sum to total_results.
 * Any hole, an extra/short page, or a mid-pagination failure (which leaves a page
 * un-accumulated) → false → the shell writes nothing.
 */
export function isPaginationComplete(pages: readonly FetchedPage[], perPage: number): boolean {
    if (pages.length === 0) return false;
    const total = pages[0]!.totalResults;
    if (pages.some((p) => p.totalResults !== total)) return false;

    const expected = expectedPageCount(total, perPage);
    if (pages.length !== expected) return false;

    const nums = new Set(pages.map((p) => p.page));
    if (nums.size !== expected) return false;
    for (let i = 1; i <= expected; i++) if (!nums.has(i)) return false;

    const sum = pages.reduce((n, p) => n + p.recordCount, 0);
    return sum === total;
}

// --------------------------------------------------------------------------
// Reconcile (the safety-critical diff — same shape as Maplify).
// --------------------------------------------------------------------------

export type ObservationReconcilePlan = {
    readonly upsert: readonly NormalizedObservation[];
    readonly delete: readonly number[];
};

/**
 * Compute the authoritative reconcile plan for a window, given the complete set
 * of fetched observations and the observation ids currently stored in that
 * window. Upsert everything fetched; delete stored ids the fetch no longer
 * contains. Photos travel inside each upserted observation and are reconciled
 * per-observation at persist time (a bounded SQL anti-join, like the live path).
 *
 * Precondition (enforced by the shell, not here): only call this with a fetch
 * that parsed ok AND is complete (isPaginationComplete) AND whose taxon closure
 * resolved. Given an empty `fetched`, every existing id is a delete — which is
 * why the shell must never reach this on a failed/incomplete fetch.
 */
export function reconcile(
    fetched: readonly NormalizedObservation[],
    existingWindowIds: readonly number[],
): ObservationReconcilePlan {
    const fetchedIds = new Set(fetched.map((o) => o.id));
    return {
        upsert: fetched,
        delete: existingWindowIds.filter((id) => !fetchedIds.has(id)),
    };
}
