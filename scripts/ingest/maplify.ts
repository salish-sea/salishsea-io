/**
 * Maplify ingest — functional core (epic salishsea-io-89d / decision 011).
 *
 * Pure, runtime-agnostic transforms over Maplify's search-all-sightings JSON.
 * No I/O, no DB, no Deno/Node APIs — importable unchanged by the Deno Edge
 * Function shell and by vitest. All effects (fetch, retry, persist, log) live in
 * the imperative shell; everything here is data-in, data-out and exhaustively
 * unit-tested.
 *
 * Boundary discipline (decision 008): this validates and translates *upstream*
 * Maplify records into our normalized shape. Upstream field semantics stop here.
 *
 * Deliberately NOT resolved in the core (persist-time concerns, unchanged from
 * the current SQL path):
 *   - taxon_id      — a declarative LEFT JOIN onto inaturalist.taxa by scientific
 *                     name; a legitimately relational lookup, not a transform.
 *   - collection_id — maplify.resolve_collection (a DB rule table, D-02/D-03).
 *   - provider_id   — column DEFAULT (2 = Maplify).
 * Whether collection resolution should move into TS is left to a later decision.
 */

import { z } from 'zod';

/** Maplify source codes excluded from ingest (CONTEXT.md: rwsas filtered, wras filtered + purged). */
export const EXCLUDED_SOURCES: ReadonlySet<string> = new Set(['rwsas', 'wras']);

/**
 * Common-name → scientific-name fallback, used only when a record's
 * `scientific_name` is blank. Mirrors the CASE in maplify.update_sightings.
 *
 * NOTE (surfaced from live data 2026-07-05): real records carry names like
 * 'Blue Whale', 'Fin Whale', 'Orca', 'Killer whale (Ecotype Unknown)' that this
 * map does not cover, and several mapped keys ('Killer Whale (Orca)') do not
 * appear in live data — so this fallback rarely fires today. Preserved verbatim
 * to keep ingest behavior identical; revisit as its own issue, not silently here.
 */
export const NAME_TO_SCIENTIFIC: ReadonlyMap<string, string> = new Map([
    ['Killer Whale (Orca)', 'Orcinus orca'],
    ['Southern Resident Killer Whale', 'Orcinus orca ater'],
    ['Grey', 'Eschrichtius robustus'],
    ['California Sea Lion', 'Zalophus californianus'],
    ['Pacific White-sided Dolphin', 'Sagmatias obliquidens'],
]);

/** Upstream ints (0/1) or genuine booleans → boolean. Maplify returns 0/1 today. */
const intBool = z
    .union([z.boolean(), z.number()])
    .transform((v) => Boolean(v));

/** `'YYYY-MM-DD HH:MM:SS'` as returned by Maplify (timestamp without time zone). */
const MAPLIFY_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Schema for one upstream Maplify sighting. Strict enough that a malformed
 * record fails the whole response (see parseMaplifyResponse) rather than being
 * silently dropped — a dropped record would otherwise become a reconcile
 * delete-candidate, risking data loss on a transient upstream glitch.
 */
export const MaplifyRecordSchema = z.object({
    id: z.number().int(),
    project_id: z.number().int(),
    trip_id: z.number().int(),
    name: z.string().nullish(),
    scientific_name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    number_sighted: z.number().int(),
    created: z.string().regex(MAPLIFY_TIMESTAMP),
    photo_url: z.string().nullish(),
    comments: z.string().nullish(),
    in_ocean: intBool,
    moderated: z.number().int(),
    trusted: intBool,
    is_test: intBool,
    source: z.string(),
    usernm: z.string().nullish(),
});

export const MaplifyResponseSchema = z.object({
    count: z.number().int().optional(),
    results: z.array(MaplifyRecordSchema),
});

/** Our normalized sighting — maps 1:1 to the columns the shell persists. */
export type NormalizedSighting = {
    readonly id: number;
    readonly projectId: number;
    readonly tripId: number;
    readonly name: string | null;
    /** Blank upstream scientific_name is normalized to null. */
    readonly scientificName: string | null;
    readonly lon: number;
    readonly lat: number;
    readonly numberSighted: number;
    readonly createdAt: string;
    readonly photoUrl: string | null;
    readonly comments: string | null;
    readonly inOcean: boolean;
    readonly moderated: number;
    readonly trusted: boolean;
    readonly isTest: boolean;
    readonly source: string;
    readonly usernm: string | null;
};

const blankToNull = (s: string | null | undefined): string | null => {
    const t = s?.trim();
    return t ? t : null;
};

/** Normalize one validated upstream record into our shape. Pure. */
export function normalizeRecord(r: z.infer<typeof MaplifyRecordSchema>): NormalizedSighting {
    return {
        id: r.id,
        projectId: r.project_id,
        tripId: r.trip_id,
        name: blankToNull(r.name),
        scientificName: blankToNull(r.scientific_name),
        lon: r.longitude,
        lat: r.latitude,
        numberSighted: r.number_sighted,
        createdAt: r.created,
        photoUrl: blankToNull(r.photo_url),
        comments: blankToNull(r.comments),
        inOcean: r.in_ocean,
        moderated: r.moderated,
        trusted: r.trusted,
        isTest: r.is_test,
        source: r.source,
        usernm: blankToNull(r.usernm),
    };
}

/** Whether a sighting is in ingest scope (source not excluded). Pure. */
export function isIngestable(s: NormalizedSighting): boolean {
    return !EXCLUDED_SOURCES.has(s.source);
}

/**
 * The scientific name to resolve a taxon from: the record's own, or the
 * common-name fallback, or null. The taxon_id lookup itself is persist-time.
 */
export function resolveScientificName(s: NormalizedSighting): string | null {
    if (s.scientificName) return s.scientificName;
    if (s.name) return NAME_TO_SCIENTIFIC.get(s.name) ?? null;
    return null;
}

export type ParseResult =
    | { readonly ok: true; readonly sightings: readonly NormalizedSighting[] }
    | { readonly ok: false; readonly error: string };

/**
 * Validate and normalize a Maplify response body.
 *
 * Returns ok:false if the envelope or ANY record is malformed — the shell then
 * treats the fetch as not-complete and aborts (writes nothing), never
 * reconciling against a partially-trusted response. This upholds decision 011's
 * invariant: reconcile only against a fully-valid, complete fetch.
 *
 * Excluded-source records (rwsas/wras) are NOT dropped here — filtering is the
 * caller's job via isIngestable, kept separate so validation stays total.
 */
export function parseMaplifyResponse(raw: unknown): ParseResult {
    const parsed = MaplifyResponseSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, error: z.prettifyError(parsed.error) };
    }
    return { ok: true, sightings: parsed.data.results.map(normalizeRecord) };
}

export type ReconcilePlan = {
    readonly upsert: readonly NormalizedSighting[];
    readonly delete: readonly number[];
};

/**
 * Compute the authoritative reconcile plan for a window, given the complete set
 * of fetched (already-ingestable-filtered) sightings and the ids currently
 * stored in that window. Upsert everything fetched; delete stored ids that the
 * fetch no longer contains. Pure — the safety-critical diff, tested in isolation.
 *
 * Precondition (enforced by the shell, not here): only call this with a fetch
 * that parsed ok and is complete. Given an empty `fetched`, every existing id is
 * a delete — which is why the shell must never reach this on a failed fetch.
 */
export function reconcile(
    fetched: readonly NormalizedSighting[],
    existingWindowIds: readonly number[],
): ReconcilePlan {
    const fetchedIds = new Set(fetched.map((s) => s.id));
    return {
        upsert: fetched,
        delete: existingWindowIds.filter((id) => !fetchedIds.has(id)),
    };
}
