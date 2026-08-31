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
import { extentContains, salishSeaExtent } from '../../src/extents.ts';

/** Maplify source codes excluded from ingest (CONTEXT.md: rwsas filtered, wras filtered + purged). */
export const EXCLUDED_SOURCES: ReadonlySet<string> = new Set(['rwsas', 'wras']);

/**
 * Upstream values that occupy `scientific_name` without being a scientific name.
 *
 * `'N/A'` is not blank, so the previous resolver returned it verbatim; it joins nothing,
 * and 128 records lost their taxon while `name` said plainly what they were (salish-7jl).
 */
const SCIENTIFIC_NAME_PLACEHOLDERS: ReadonlySet<string> = new Set([
    '', 'n/a', 'na', 'none', 'null', 'unknown', 'unspecified',
]);

/**
 * The comparison form of an upstream common name: case, spacing and the apostrophe
 * folded away.
 *
 * The apostrophe needs folding because some records arrive with UTF-8 mis-decoded as
 * Latin-1 — "Risso’s" becomes "Risso\u00e2\u0080\u0099s", the three bytes of U+2019 read
 * as three characters. That is almost certainly upstream (we decode as UTF-8 at fetch),
 * but it has not been confirmed against the live API; if it turns out to be ours, fixing
 * the decode is better than folding here.
 */
export function foldUpstreamName(name: string): string {
    return name
        .replace(/\u00e2\u0080\u0099|\u00e2\u0080\u0098|[\u2018\u2019\u02bc`]/g, "'")
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Common name → scientific name, keyed by `foldUpstreamName`.
 *
 * Two jobs, and the second one is new (salish-7jl): supplying a scientific name when the
 * record has none, and *overriding* one when the two disagree. Upstream moderators
 * correct a species by editing `name` and leaving a comment — "reported as humpback but
 * was gray whale" — while `scientific_name` keeps the superseded identification. So a
 * disagreement means the name is the correction, and resolving toward `scientific_name`
 * discarded exactly the records a human had already fixed.
 *
 * That makes a wrong entry here expensive: it silently overrides good upstream data at
 * scale. Every key below was read off the live corpus, and names that assert no
 * identification ('Unspecified', 'Other', 'Unknown', 'Unidentified Whale', 'Autre',
 * 'No especificado') are deliberately ABSENT rather than mapped to null — an absent name
 * leaves a usable `scientific_name` alone, which is what makes 'Unspecified' + 'Orcinus
 * orca' still an orca.
 */
export const NAME_TO_SCIENTIFIC: ReadonlyMap<string, string> = new Map([
    // Killer whales. 'Southern Resident' is the subspecies; the plain forms are not.
    ['killer whale (orca)', 'Orcinus orca'],
    ['killer whale', 'Orcinus orca'],
    ['orca', 'Orcinus orca'],
    ['orca (ballena asesina)', 'Orcinus orca'],
    ['southern resident killer whale', 'Orcinus orca ater'],
    // Baleen whales. 'Gray' was missing while 'Grey' was present, which is the whole
    // reason 174 records went unresolved.
    ['gray', 'Eschrichtius robustus'],
    ['grey', 'Eschrichtius robustus'],
    ['gray whale', 'Eschrichtius robustus'],
    ['grey whale', 'Eschrichtius robustus'],
    ['baleine grise', 'Eschrichtius robustus'],
    ['humpback', 'Megaptera novaeangliae'],
    ['humpback whale', 'Megaptera novaeangliae'],
    ['ballena jorobada', 'Megaptera novaeangliae'],
    ['minke whale', 'Balaenoptera acutorostrata'],
    ['fin whale', 'Balaenoptera physalus'],
    ['finback whale', 'Balaenoptera physalus'],
    ['blue whale', 'Balaenoptera musculus'],
    ['ballena azul', 'Balaenoptera musculus'],
    ['sei whale', 'Balaenoptera borealis'],
    // Toothed whales.
    ['sperm whale', 'Physeter macrocephalus'],
    ["baird's beaked whale", 'Berardius bairdii'],
    ['short finned pilot whale', 'Globicephala macrorhynchus'],
    // Dolphins and porpoises. iNaturalist carries the white-sided dolphin under
    // Aethalodelphis; Lagenorhynchus and Sagmatias join nothing in our taxa mirror.
    ['pacific white-sided dolphin', 'Aethalodelphis obliquidens'],
    ["risso's dolphin", 'Grampus griseus'],
    ['bottlenose dolphin', 'Tursiops truncatus'],
    // NOT 'common dolphin'. Whale Alert's category is genus-level by design and the
    // feed supplies the bare genus `Delphinus`; mapping it to a species would invent a
    // determination the reporter was never offered. The same holds for its 'Right Whale'
    // (Eubalaena) and 'Bottlenose Whale' (Hyperoodon) categories, likewise unmapped.
    // 'Long-beaked' is different: the name itself makes the narrower claim.
    ['long-beaked common dolphin', 'Delphinus delphis bairdii'],
    ['striped dolphin', 'Stenella coeruleoalba'],
    ['northern right whale dolphin', 'Lissodelphis borealis'],
    ['northern right-whale dolphin', 'Lissodelphis borealis'],
    ['harbor porpoise', 'Phocoena phocoena'],
    ['harbour porpoise', 'Phocoena phocoena'],
    ['marsouin commun', 'Phocoena phocoena'],
    ["dall's porpoise", 'Phocoenoides dalli'],
    // Pinnipeds.
    ['california sea lion', 'Zalophus californianus'],
]);

/**
 * Scientific names upstream still uses that our taxa mirror does not carry, mapped to
 * the name iNaturalist currently uses. Without this a valid identification resolves to
 * nothing: 43 Pacific white-sided dolphins arrive as `Lagenorhynchus obliquidens`.
 */
const SCIENTIFIC_SYNONYMS: ReadonlyMap<string, string> = new Map([
    ['lagenorhynchus obliquidens', 'Aethalodelphis obliquidens'],
    // iNaturalist deactivated Sagmatias obliquidens in favour of Aethalodelphis
    // (taxon 1368491 -> 1664971); see salish-ayb.4.
    ['sagmatias obliquidens', 'Aethalodelphis obliquidens'],
    ['delphinus capensis', 'Delphinus delphis bairdii'],
]);

/** Upstream ints (0/1) or genuine booleans → boolean. Maplify returns 0/1 today. */
const intBool = z
    .union([z.boolean(), z.number()])
    .transform((v) => Boolean(v));

/** `'YYYY-MM-DD HH:MM:SS'` as returned by Maplify (timestamp without time zone). */
const MAPLIFY_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Validate both the shape AND the calendar validity of a Maplify timestamp, so a
 * value like '2026-13-99 25:99:99' or '2026-02-30 …' fails here (fail-fast, per
 * parseMaplifyResponse's contract) rather than surviving to blow up at the
 * `created_at::timestamp` cast inside the persist transaction. Uses a UTC
 * round-trip to reject non-existent dates (e.g. Feb 30 rolling into March).
 */
export function isValidMaplifyTimestamp(s: string): boolean {
    const m = MAPLIFY_TIMESTAMP.exec(s);
    if (!m) return false;
    const [year, month, day, hour, min, sec] = [m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!].map(Number);
    if (month! < 1 || month! > 12 || day! < 1 || day! > 31) return false;
    if (hour! > 23 || min! > 59 || sec! > 59) return false;
    const dt = new Date(Date.UTC(year!, month! - 1, day!, hour!, min!, sec!));
    return (
        dt.getUTCFullYear() === year && dt.getUTCMonth() === month! - 1 && dt.getUTCDate() === day &&
        dt.getUTCHours() === hour && dt.getUTCMinutes() === min && dt.getUTCSeconds() === sec
    );
}

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
    created: z.string().refine(isValidMaplifyTimestamp, 'invalid Maplify timestamp'),
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
    // NB: the live API returns `count` as a STRING ('99'); we don't use it, so it
    // is intentionally omitted here (unknown keys are ignored) rather than typed.
    results: z.array(MaplifyRecordSchema),
});

/** Our normalized sighting — maps 1:1 to the columns the shell persists. */
export type NormalizedSighting = {
    readonly id: number;
    readonly projectId: number;
    readonly tripId: number;
    readonly name: string | null;
    /**
     * Stored verbatim (may be '') — maplify.sightings is an upstream mirror
     * (decision 008) and its scientific_name column is NOT NULL. Taxon resolution
     * uses resolveScientificName, which trims and falls back; it does not depend
     * on this being nulled.
     */
    readonly scientificName: string;
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
        scientificName: r.scientific_name, // verbatim (mirror column, NOT NULL)
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

/**
 * Whether the record is a killer whale of any kind, as far as the record itself can
 * say. Pure.
 *
 * Works from the resolved scientific name so it survives a subspecies (`Orcinus orca
 * ater`, `O. o. rectipinnus`), the genus-only stub (`Orcinus`), a placeholder
 * `scientific_name` with an orca common name, and an upstream correction in `name`
 * that overrides `scientific_name` (all of which `resolveScientificName` already
 * handles). It cannot consult the taxonomy — the core sees names, not taxon ids.
 */
export function isKillerWhale(s: NormalizedSighting): boolean {
    return /^orcinus\b/i.test(resolveScientificName(s) ?? '');
}

/**
 * Whether a sighting is in ingest scope. Pure.
 *
 * Two rules (decision 036):
 *   1. Source not excluded (rwsas, wras).
 *   2. Killer whales are kept from the whole fetch bbox — the Southern Resident range,
 *      which is why the bbox reaches central California — and everything else only
 *      inside the Salish Sea + Strait of Juan de Fuca. Southern Residents cannot be told
 *      apart at ingest (almost no report names an ecotype), so the rule is necessarily
 *      "killer whales", and a Californian orca is kept whether or not it is a Resident.
 *
 * Filtering here means reconcile never sees an out-of-scope record: within the window
 * it is a delete, and the corpus stays consistent with what the rule says.
 */
export function isIngestable(s: NormalizedSighting): boolean {
    if (EXCLUDED_SOURCES.has(s.source)) return false;
    return extentContains(salishSeaExtent, s.lon, s.lat) || isKillerWhale(s);
}

/**
 * The scientific name to resolve a taxon from. The taxon_id lookup itself is
 * persist-time.
 *
 * Three rules, in order (salish-7jl):
 *   1. A placeholder in `scientific_name` ('N/A' and friends) counts as absent.
 *   2. If the common name maps and DISAGREES with the scientific name, the common name
 *      wins — upstream corrections land in `name`, not `scientific_name`.
 *   3. Otherwise the scientific name stands, passed through the synonym map so a retired
 *      genus still resolves.
 */
export function resolveScientificName(s: NormalizedSighting): string | null {
    const raw = s.scientificName.trim();
    const sci = SCIENTIFIC_NAME_PLACEHOLDERS.has(raw.toLowerCase())
        ? null
        : SCIENTIFIC_SYNONYMS.get(raw.toLowerCase()) ?? raw;
    const fromName = s.name
        ? NAME_TO_SCIENTIFIC.get(foldUpstreamName(s.name)) ?? null
        : null;

    if (!sci) return fromName;
    if (fromName && fromName !== sci) return fromName;
    return sci;
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
 * Out-of-scope records (excluded sources, non-orcas outside the Salish Sea) are NOT
 * dropped here — filtering is the caller's job via isIngestable, kept separate so
 * validation stays total.
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
