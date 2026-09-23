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
 *   - entity_id     — resolved HERE, against the register's names, by
 *                     resolveEntity; the caller supplies the name index it reads.
 *   - collection_id — maplify.resolve_collection (a DB rule table, D-02/D-03).
 *   - provider_id   — column DEFAULT (2 = Maplify).
 * Whether collection resolution should move into TS is left to a later decision.
 */

import { z } from 'zod';
import { extentContains, salishSeaExtent } from '../../src/extents.ts';
import { fold } from '../../src/fold.ts';
import { matchName, type NameIndex } from '../register/name-index.ts';

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
 * An upstream name with its apostrophes made ones the register's fold recognises, and
 * nothing else changed.
 *
 * The fold (ADR-0019) deletes `'` and `’`, so "Risso’s" and "Rissos" meet. Upstream also
 * sends `‘`, `ʼ` and a backtick in that position, and some records arrive with UTF-8
 * mis-decoded as Latin-1 — "Risso’s" becomes "Risso\u00e2\u0080\u0099s", the three bytes
 * of U+2019 read as three characters. That is almost certainly upstream (we decode as
 * UTF-8 at fetch), but it has not been confirmed against the live API; if it turns out to
 * be ours, fixing the decode is better than repairing here. Repair is ours to do, at the
 * boundary (decision 008); what the name means is the register's to say.
 */
export function repairUpstreamName(name: string): string {
    return name.replace(/\u00e2\u0080[\u0098\u0099]|[\u2018\u02bc`]/g, '’');
}

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
     * (decision 008) and its scientific_name column is NOT NULL. Entity resolution
     * (resolveEntity) trims it and treats placeholders as absent; it does not depend
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
 * Asks the register which taxon the record's entity belongs to, so it survives an ecotype
 * ("Southern Resident Killer Whale" is SSA:0000010, a community under Orcinus orca), the
 * genus (*Orcinus*), a placeholder `scientific_name` with an orca common name, and an
 * upstream correction in `name` — all of which `resolveEntity` already handles. When
 * nothing resolves, an orca-shaped common name is enough.
 */
export function isKillerWhale(s: NormalizedSighting, index: NameIndex): boolean {
    const entity = resolveEntity(s, index);
    const taxon = entity ? index.taxonLabel.get(entity) : null;
    if (taxon) return /^orcinus\b/i.test(taxon);
    // Nothing resolved: neither name is one the register holds. Upstream coins orca names
    // freely — the live fixture has "Killer whale (Ecotype Unknown)" with a blank
    // scientific_name — and a scientific name can be finer than the register goes
    // ("Orcinus orca ater" is iNaturalist's, not a register name). Outside the box an
    // unrecognised orca is not a lost identification but a lost record — reconcile would
    // delete it — so read the shape of either name rather than demand the register know it.
    const sci = s.scientificName.trim();
    if (!SCIENTIFIC_NAME_PLACEHOLDERS.has(sci.toLowerCase()) && /^orcinus\b/i.test(sci)) return true;
    return s.name !== null && /\b(orca|killer whale)\b/.test(fold(repairUpstreamName(s.name)));
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
export function isIngestable(s: NormalizedSighting, index: NameIndex): boolean {
    if (EXCLUDED_SOURCES.has(s.source)) return false;
    return extentContains(salishSeaExtent, s.lon, s.lat) || isKillerWhale(s, index);
}

/**
 * The register entity a sighting names, or null (salish-53t.3, decision 049).
 *
 * Both of the record's names are looked up in the register (`matchName`); three rules
 * then decide between them, in order, unchanged from when they chose an iNaturalist name
 * (salish-7jl):
 *   1. A placeholder in `scientific_name` ('N/A' and friends) counts as absent.
 *   2. If the common name names an entity and DISAGREES with the scientific name, the
 *      common name wins — upstream corrections land in `name`, not `scientific_name`. It
 *      is also how an ecotype is reported at all: "Southern Resident Killer Whale" with
 *      "Orcinus orca" means the ecotype, not merely the species.
 *   3. Otherwise the scientific name stands.
 *
 * A name that matches more than one entity counts as matching none. Names that assert no
 * identification ('Unspecified', 'Other') are simply not register names, so they leave a
 * usable scientific name alone — 'Unspecified' + 'Orcinus orca' is still an orca.
 */
export function resolveEntity(s: NormalizedSighting, index: NameIndex): string | null {
    const raw = s.scientificName.trim();
    const sci = SCIENTIFIC_NAME_PLACEHOLDERS.has(raw.toLowerCase()) ? null : repairUpstreamName(raw);
    const bySci = matchName(index, sci);
    const byName = matchName(index, s.name === null ? null : repairUpstreamName(s.name));
    const fromSci = bySci.verdict === 'one' ? bySci.entityId : null;
    const fromName = byName.verdict === 'one' ? byName.entityId : null;

    if (!fromSci) return fromName;
    if (fromName && fromName !== fromSci) return fromName;
    return fromSci;
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
