/**
 * Maplify ingest — persist layer (epic salishsea-io-89d.1 / decision 011).
 *
 * The imperative shell's write step. Takes a postgres.js connection (injected, so
 * the same code runs under the Deno Edge Function and under vitest against local
 * Supabase) and a reconcile plan, and applies it in ONE atomic transaction:
 * bulk upsert + a window-bounded reconcile delete. Postgres is a dumb store —
 * the SQL is authored here, in version-controlled TypeScript.
 *
 * Persist-time resolutions kept in SQL, unchanged from the prior path:
 *   - entity_id     — the register entity resolveEntity chose, computed in TS
 *                     against the name index fetchNameIndex reads (decision 049).
 *                     Not a join: the register's name rule (the ADR-0019 fold) is
 *                     implemented once, in scripts/register/fold.ts.
 *   - collection_id — maplify.resolve_collection(comments, source), a
 *                     curator-editable DB rule table (decision: keep as data).
 *   - provider_id   — column DEFAULT (2 = Maplify).
 *
 * The reconcile DELETE is bounded to [window_start, window_end] in SQL as
 * defence-in-depth: even a caller that passes an out-of-window id cannot delete
 * outside the window. This invariant is the integration test's central assertion.
 */

import type { Sql, TransactionSql } from 'postgres';
import { resolveEntity, type NormalizedSighting, type ReconcilePlan } from './maplify.ts';
import { buildNameIndex, type NameIndex, type RegisterName } from '../register/name-index.ts';
import type {
    NormalizedObservation,
    NormalizedTaxon,
    ObservationReconcilePlan,
} from './inaturalist.ts';
import type { ReconcilePlan as BoutReconcilePlan } from './orcasound.ts';

export type IngestWindow = {
    /** inclusive start date, 'YYYY-MM-DD' */
    readonly start: string;
    /** inclusive end date, 'YYYY-MM-DD' — the reconcile delete covers start .. end+1 day */
    readonly end: string;
};

export type PersistResult = {
    readonly upserted: number;
    readonly deleted: number;
};

/**
 * The ids currently stored in a window — fed to reconcile() to compute the delete
 * set. Uses the SAME bound as the reconcile DELETE ([start, end+1)) so the read
 * and the write agree on window membership. Maplify's fetch filters on the same
 * UTC created_at this compares, so the bound needs no margin; the iNaturalist
 * one does — see fetchObservationWindowIds.
 */
export async function fetchWindowIds(sql: Sql, window: IngestWindow): Promise<number[]> {
    const rows = await sql<{ id: number }[]>`
        SELECT id FROM maplify.sightings
        WHERE created_at >= ${window.start}::timestamp
          AND created_at < (${window.end}::date + 1)::timestamp`;
    return rows.map((r) => r.id);
}

/**
 * Row shape handed to jsonb_to_recordset — snake_case keys that match the
 * recordset column names exactly (jsonb_to_recordset maps by key name).
 */
type UpsertPayloadRow = {
    id: number; project_id: number; trip_id: number;
    scientific_name: string | null; name: string | null;
    lon: number; lat: number; number_sighted: number; created_at: string;
    photo_url: string | null; comments: string | null; in_ocean: boolean;
    moderated: number; trusted: boolean; is_test: boolean;
    source: string; usernm: string | null; entity_id: string | null;
};

function toPayload(sightings: readonly NormalizedSighting[], index: NameIndex): UpsertPayloadRow[] {
    return sightings.map((s) => ({
        id: s.id, project_id: s.projectId, trip_id: s.tripId,
        scientific_name: s.scientificName, name: s.name, lon: s.lon, lat: s.lat,
        number_sighted: s.numberSighted, created_at: s.createdAt, photo_url: s.photoUrl,
        comments: s.comments, in_ocean: s.inOcean, moderated: s.moderated,
        trusted: s.trusted, is_test: s.isTest, source: s.source, usernm: s.usernm,
        entity_id: resolveEntity(s, index),
    }));
}

/**
 * Every name the loaded register edition publishes, as the Maplify core matches against:
 * each entity's label (its preferred name) and its common, hidden and historical names,
 * with whether the entity is retired and the label of the taxon it belongs to.
 *
 * Read once per ingest tick — about 1,600 rows — rather than cached, so a register load
 * reaches the next tick without a redeploy. With no edition loaded (CI, a fresh local
 * stack) the index is empty and every sighting resolves to null, which the map shows
 * unnamed rather than dropping.
 */
export async function fetchNameIndex(sql: Sql): Promise<NameIndex> {
    // Per entity first, then fanned out to its names, so the taxon lookup runs once per
    // entity rather than once per name. Individuals are dropped here as well as in
    // buildNameIndex (which owns the rule): they are most of the register, and a tick
    // should not read 600 animals to discard them. The taxon comes from register.ancestor
    // directly rather than register.taxon_entity_for, whose only extra is following a
    // merge — and retired entities are never candidates. Measured on production: the
    // per-name form cost 182 ms and 30,581 buffers every five minutes.
    const rows = await sql<RegisterName[]>`
        WITH ent AS (
            SELECT e.entity_id, e.kind,
                   d.entity_id IS NOT NULL AS retired,
                   CASE WHEN e.kind = 'taxon' THEN e.label
                        ELSE (SELECT t.label FROM register.ancestor a
                               JOIN register.entities t ON t.entity_id = a.ancestor_id
                               WHERE a.entity_id = e.entity_id AND a.ancestor_kind = 'taxon'
                               ORDER BY a.depth LIMIT 1)
                   END AS taxon_label
            FROM register.entities e
            LEFT JOIN register.deprecations d ON d.entity_id = e.entity_id
            WHERE e.kind <> 'individual'
        ),
        named AS (
            SELECT entity_id, label AS name FROM register.entities
            UNION ALL
            SELECT entity_id, name FROM register.names
        )
        SELECT n.entity_id, n.name, ent.kind, ent.retired, ent.taxon_label
        FROM named n
        JOIN ent ON ent.entity_id = n.entity_id`;
    return buildNameIndex(rows);
}

/**
 * Apply a reconcile plan for one Maplify window atomically.
 *
 * On dryRun the whole transaction is rolled back after executing (so it still
 * exercises constraints and reports would-be counts) and nothing is persisted.
 *
 * Precondition (decision 011): the caller has already verified the fetch was
 * complete. This function must NEVER be reached on a failed fetch — an empty
 * plan.upsert with a populated window would delete the window.
 */
export async function persistMaplify(
    sql: Sql,
    plan: ReconcilePlan,
    window: IngestWindow,
    index: NameIndex,
    opts: { readonly dryRun?: boolean } = {},
): Promise<PersistResult> {
    const payload = toPayload(plan.upsert, index);
    const deleteIds = plan.delete;

    const run = async (tx: TransactionSql): Promise<PersistResult> => {
        let upserted = 0;
        if (payload.length > 0) {
            const rows = await tx`
                INSERT INTO maplify.sightings (
                    id, project_id, trip_id, scientific_name, name, location, number_sighted,
                    created_at, photo_url, comments, in_ocean, moderated, trusted, is_test,
                    source, usernm, entity_id, collection_id
                )
                SELECT
                    v.id, v.project_id, v.trip_id, v.scientific_name, v.name,
                    gis.ST_Point(v.lon, v.lat)::gis.geography, v.number_sighted,
                    v.created_at::timestamp, v.photo_url, v.comments, v.in_ocean, v.moderated,
                    v.trusted, v.is_test, v.source, v.usernm,
                    v.entity_id,
                    maplify.resolve_collection(v.comments, v.source)
                FROM jsonb_to_recordset(${tx.json(payload as never)}) AS v(
                    id int, project_id int, trip_id int, scientific_name text, name text,
                    lon float8, lat float8, number_sighted int, created_at text, photo_url text,
                    comments text, in_ocean bool, moderated int2, trusted bool, is_test bool,
                    source text, usernm text, entity_id text
                )
                -- On conflict we refresh upstream-mirror fields (incl. in_ocean, a
                -- Maplify-derived flag that tracks the updated location) and entity_id
                -- (a pure function of the refreshed names and the register edition). We deliberately
                -- do NOT refresh collection_id: it is our resolved/curatable domain
                -- value, not a mirror field — re-running resolve_collection here would
                -- clobber a one-time backfill and any curator correction on existing
                -- rows (decision D-07). New rows still get it via the INSERT above.
                --
                -- Only when something differs: Maplify returns the whole window
                -- every five minutes, and rewriting ~200 identical rows a tick
                -- fired the occurrences_changed trigger on every tick and made
                -- every open map refetch (bd salish-xfo). Row-wise IS DISTINCT
                -- FROM treats NULLs as equal; location is compared as WKB
                -- because that needs no operator from the gis schema.
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    scientific_name = EXCLUDED.scientific_name,
                    location = EXCLUDED.location,
                    number_sighted = EXCLUDED.number_sighted,
                    photo_url = EXCLUDED.photo_url,
                    comments = EXCLUDED.comments,
                    in_ocean = EXCLUDED.in_ocean,
                    moderated = EXCLUDED.moderated,
                    trusted = EXCLUDED.trusted,
                    is_test = EXCLUDED.is_test,
                    source = EXCLUDED.source,
                    usernm = EXCLUDED.usernm,
                    -- Never un-name a record whose names have not changed: a tick run
                    -- against an empty or damaged register index would otherwise blank
                    -- ten days of identities, which resolve-maplify.ts refuses to do for
                    -- the rest of the table. Changed names still take the new answer,
                    -- NULL included.
                    entity_id = CASE WHEN EXCLUDED.entity_id IS NULL
                          AND maplify.sightings.name IS NOT DISTINCT FROM EXCLUDED.name
                          AND maplify.sightings.scientific_name = EXCLUDED.scientific_name
                         THEN maplify.sightings.entity_id
                         ELSE EXCLUDED.entity_id END
                WHERE (
                    maplify.sightings.name, maplify.sightings.scientific_name,
                    gis.ST_AsBinary(maplify.sightings.location), maplify.sightings.number_sighted,
                    maplify.sightings.photo_url, maplify.sightings.comments, maplify.sightings.in_ocean,
                    maplify.sightings.moderated, maplify.sightings.trusted, maplify.sightings.is_test,
                    maplify.sightings.source, maplify.sightings.usernm, maplify.sightings.entity_id
                ) IS DISTINCT FROM (
                    EXCLUDED.name, EXCLUDED.scientific_name,
                    gis.ST_AsBinary(EXCLUDED.location), EXCLUDED.number_sighted,
                    EXCLUDED.photo_url, EXCLUDED.comments, EXCLUDED.in_ocean,
                    EXCLUDED.moderated, EXCLUDED.trusted, EXCLUDED.is_test,
                    EXCLUDED.source, EXCLUDED.usernm,
                    CASE WHEN EXCLUDED.entity_id IS NULL
                          AND maplify.sightings.name IS NOT DISTINCT FROM EXCLUDED.name
                          AND maplify.sightings.scientific_name = EXCLUDED.scientific_name
                         THEN maplify.sightings.entity_id
                         ELSE EXCLUDED.entity_id END
                )
                RETURNING id`;
            // Inserted rows plus rows the guard let through: what the tick
            // actually wrote, which is what ingest.runs.rows_upserted records.
            upserted = rows.count;
        }

        let deleted = 0;
        if (deleteIds.length > 0) {
            const rows = await tx`
                DELETE FROM maplify.sightings
                WHERE id = ANY(${deleteIds as unknown as number[]})
                  AND created_at >= ${window.start}::timestamp
                  AND created_at < (${window.end}::date + 1)::timestamp
                RETURNING id`;
            deleted = rows.count;
        }

        return { upserted, deleted };
    };

    if (opts.dryRun) {
        // Execute inside a transaction we deliberately abort, so constraints are
        // exercised but nothing is written. Report the would-be counts.
        const sentinel = Symbol('dry-run-rollback');
        let result: PersistResult = { upserted: 0, deleted: 0 };
        try {
            await sql.begin(async (tx) => {
                result = await run(tx);
                throw sentinel;
            });
        } catch (e) {
            if (e !== sentinel) throw e;
        }
        return result;
    }

    return sql.begin(run) as Promise<PersistResult>;
}

// =========================================================================
// iNaturalist persist (epic salishsea-io-89d.2 / decision 011).
//
// The iNat write step. Same discipline as Maplify: injected postgres.js
// connection, SQL authored here, ONE atomic transaction. Two structural
// differences from Maplify:
//   - Parent/child rows: taxa (referenced by observations.taxon_id, NOT NULL)
//     and observation_photos (referencing observations.id). The transaction
//     orders writes to respect the FKs: taxa → observations → photos → deletes.
//   - Photos reconcile PER-OBSERVATION (a bounded SQL anti-join), exactly like
//     the live upsert_observation_page: for the observations present in this
//     fetch, any stored photo the fetch no longer returns is deleted; photos of
//     other observations are never touched.
//
// The taxa passed in are the closure the shell resolved BEFORE opening this
// transaction (no HTTP inside a DB write, decision 011). Persist-time DB
// resolutions kept in SQL, unchanged from the prior path:
//   - provider_id / collection_id — column DEFAULTs (3 / 8 = iNaturalist).
//   - contributor_id              — inaturalist.mint_contributor(login, orcid),
//                                   a relational upsert into public.contributors.
//
// Like Maplify, both destructive DELETEs are window-bounded (observed_at in
// [start, end+1)) in SQL as defence-in-depth — a caller that passes an
// out-of-window id cannot delete outside the window.
// =========================================================================

export type InatPersistResult = {
    readonly taxaUpserted: number;
    readonly observationsUpserted: number;
    readonly observationsDeleted: number;
    readonly photosUpserted: number;
    readonly photosDeleted: number;
};

/**
 * Of the given candidate ids, those already present in inaturalist.taxa. The
 * shell diffs referenced against this (missingTaxonIds) to drive the taxon
 * closure loop before opening the persist transaction.
 */
export async function fetchExistingTaxonIds(
    sql: Sql,
    candidateIds: readonly number[],
): Promise<number[]> {
    if (candidateIds.length === 0) return [];
    const rows = await sql<{ id: number }[]>`
        SELECT id FROM inaturalist.taxa WHERE id = ANY(${candidateIds as unknown as number[]}::int[])`;
    return rows.map((r) => r.id);
}

/**
 * The iNaturalist observation ids the reconcile may delete: those stored in the
 * INTERIOR of the window, [start + 1 day, end) in UTC — not the window itself.
 *
 * The fetch and the store do not measure a day the same way. iNat's d1/d2 filter
 * on the observer's LOCAL date (observed_on); observed_at here is the UTC
 * instant. An observation made at 6 pm Pacific on the day before `start` is
 * dated the day before by iNat, so the fetch omits it, but its UTC instant is
 * 01:00 on `start`, so a bound of [start, end + 1) held it — and the reconcile,
 * seeing a stored row the fetch did not return, deleted it. The cron's rolling
 * window did this to every evening's observations eleven days later, from the
 * edge-function cutover (2026-06-26) until 2026-09-11, and abutting backfill
 * windows did it to each boundary day (bd salish-34s). Excluding the window's
 * first and last UTC day from the delete set leaves no straddle for any time
 * zone (±14 h), at the cost of never reconciling a window's edge days — which
 * the rolling window covers on its next tick, and a backfill never had rows to
 * reconcile anyway. Uses the SAME bound as the DELETE so read and write agree.
 *
 * ids are read as text and converted: postgres.js returns bigint as a string;
 * number (iNat ids are well within 2^53).
 */
export async function fetchObservationWindowIds(sql: Sql, window: IngestWindow): Promise<number[]> {
    const rows = await sql<{ id: string }[]>`
        SELECT id FROM inaturalist.observations
        WHERE observed_at >= (${window.start}::date + 1)
          AND observed_at < ${window.end}::date`;
    return rows.map((r) => Number(r.id));
}

type TaxonPayloadRow = {
    id: number; parent_id: number | null; scientific_name: string;
    vernacular_name: string | null; rank: string;
    is_active: boolean; current_taxon_id: number | null;
};

type ObservationPayloadRow = {
    id: number; description: string | null; lon: number; lat: number;
    observed_at: string; license_code: string | null; uri: string;
    login: string; orcid: string | null; taxon_id: number;
    public_positional_accuracy: number | null; updated_at: string;
};

type PhotoPayloadRow = {
    id: number; observation_id: number; seq: number; attribution: string;
    hidden: boolean; license: string | null; height: number | null; width: number | null; url: string;
};

function toTaxonPayload(taxa: readonly NormalizedTaxon[]): TaxonPayloadRow[] {
    return taxa.map((t) => ({
        id: t.id, parent_id: t.parentId, scientific_name: t.scientificName,
        vernacular_name: t.vernacularName, rank: t.rank,
        is_active: t.isActive, current_taxon_id: t.currentTaxonId,
    }));
}

function toObservationPayload(observations: readonly NormalizedObservation[]): ObservationPayloadRow[] {
    return observations.map((o) => ({
        id: o.id, description: o.description, lon: o.lon, lat: o.lat,
        observed_at: o.observedAt, license_code: o.licenseCode, uri: o.uri,
        login: o.login, orcid: o.orcid, taxon_id: o.taxonId,
        public_positional_accuracy: o.publicPositionalAccuracy, updated_at: o.updatedAt,
    }));
}

/**
 * Flatten observations → photo rows, deduped by photo id (last occurrence wins).
 *
 * observation_photos.id is the PK, but iNaturalist attaches the SAME underlying
 * photo id to more than one observation (verified against live data 2026-07-05:
 * ~5 collisions in an 8 200-observation window). Feeding both to a single bulk
 * `INSERT ... ON CONFLICT (id) DO UPDATE` fails with "command cannot affect row a
 * second time". The legacy path never hit this because it upserted page-by-page;
 * the consolidated bulk upsert must collapse the duplicate itself. A photo can be
 * stored under exactly one observation, so last-wins is the only representable
 * outcome — and it also keeps fetchedPhotoIds (derived from this payload) free of
 * duplicates for the per-observation reconcile anti-join.
 */
function toPhotoPayload(observations: readonly NormalizedObservation[]): PhotoPayloadRow[] {
    const byId = new Map<number, PhotoPayloadRow>();
    for (const o of observations) {
        for (const p of o.photos) {
            byId.set(p.id, {
                id: p.id, observation_id: o.id, seq: p.seq, attribution: p.attribution,
                hidden: p.hidden, license: p.license, height: p.height, width: p.width, url: p.url,
            });
        }
    }
    return [...byId.values()];
}

/**
 * Apply an iNaturalist reconcile plan for one window atomically, with the taxon
 * closure the shell already resolved.
 *
 * On dryRun the whole transaction is rolled back after executing (so constraints
 * and FKs are still exercised) and nothing is persisted.
 *
 * Precondition (decision 011): the caller has verified the fetch was complete
 * (isPaginationComplete) AND the taxon closure resolved (missingTaxonIds empty).
 * This function must NEVER be reached on a failed/incomplete fetch.
 */
export async function persistInaturalist(
    sql: Sql,
    input: {
        readonly taxa: readonly NormalizedTaxon[];
        readonly plan: ObservationReconcilePlan;
        readonly window: IngestWindow;
    },
    opts: { readonly dryRun?: boolean } = {},
): Promise<InatPersistResult> {
    const { taxa, plan, window } = input;
    const taxonPayload = toTaxonPayload(taxa);
    const obsPayload = toObservationPayload(plan.upsert);
    const photoPayload = toPhotoPayload(plan.upsert);
    const upsertObsIds = plan.upsert.map((o) => o.id);
    const fetchedPhotoIds = photoPayload.map((p) => p.id);
    const deleteIds = plan.delete;

    const run = async (tx: TransactionSql): Promise<InatPersistResult> => {
        // 1. Taxa first — observations.taxon_id (NOT NULL) references them. The
        //    self-referential parent_id FK is DEFERRABLE, so a single batch with
        //    intra-batch parents resolves at commit.
        //
        //    DO NOTHING, and NOT because taxa are stable reference data — they are not.
        //    iNaturalist retires and renames them (salish-ayb.4). It is because
        //    resolveTaxonClosure only fetches taxa we do NOT already hold, so an
        //    existing row is never offered here a second time and the conflict action
        //    is unreachable for it. Turning this into DO UPDATE would change nothing
        //    while looking like a fix.
        //
        //    So is_active/current_taxon_id are recorded for a taxon ENTERING the mirror
        //    (the shell now asks by the /taxa/{ids} path form, which returns retired
        //    taxa flagged — salish-5ds), and a taxon already held is still never
        //    re-asked. Refreshing those rows remains a separate job that goes back
        //    upstream: scripts/backfill/inat-taxa-status.ts (salish-4hq).
        //
        //    current_taxon_id's FK is NOT DEFERRABLE, unlike parent_id's. It resolves
        //    anyway when a retirement and its replacement arrive in the same batch:
        //    an immediate FK is checked by an AFTER ROW trigger at END OF STATEMENT,
        //    and this is one statement. resolveTaxonClosure guarantees the replacement
        //    is in that statement or already stored.
        let taxaUpserted = 0;
        if (taxonPayload.length > 0) {
            const rows = await tx`
                INSERT INTO inaturalist.taxa (
                    id, parent_id, scientific_name, vernacular_name, rank, is_active, current_taxon_id
                )
                SELECT v.id, v.parent_id, v.scientific_name, v.vernacular_name, v.rank::inaturalist.rank,
                       v.is_active, v.current_taxon_id
                FROM jsonb_to_recordset(${tx.json(taxonPayload as never)}) AS v(
                    id int, parent_id int, scientific_name text, vernacular_name text, rank text,
                    is_active boolean, current_taxon_id int
                )
                ON CONFLICT (id) DO NOTHING
                RETURNING id`;
            taxaUpserted = rows.count;
        }

        // 2. Observations. contributor_id is minted only on INSERT (mint_contributor
        //    upserts public.contributors); on conflict we refresh mirror fields but
        //    only when the incoming updated_at is newer (mirrors the live MERGE's
        //    `WHEN MATCHED AND v.updated_at > o.updated_at`).
        let observationsUpserted = 0;
        if (obsPayload.length > 0) {
            const rows = await tx`
                INSERT INTO inaturalist.observations (
                    id, description, location, observed_at, license_code, uri, username,
                    taxon_id, fetched_at, public_positional_accuracy, updated_at, contributor_id
                )
                SELECT
                    v.id, v.description,
                    gis.ST_Point(v.lon, v.lat)::gis.geography,
                    v.observed_at::timestamptz, v.license_code::license, v.uri, v.login,
                    v.taxon_id, current_timestamp, v.public_positional_accuracy,
                    v.updated_at::timestamp,
                    inaturalist.mint_contributor(v.login, v.orcid)
                FROM jsonb_to_recordset(${tx.json(obsPayload as never)}) AS v(
                    id bigint, description text, lon float8, lat float8, observed_at text,
                    license_code text, uri text, login text, orcid text, taxon_id int,
                    public_positional_accuracy int, updated_at text
                )
                ON CONFLICT (id) DO UPDATE SET
                    description = EXCLUDED.description,
                    location = EXCLUDED.location,
                    observed_at = EXCLUDED.observed_at,
                    license_code = EXCLUDED.license_code,
                    username = EXCLUDED.username,
                    taxon_id = EXCLUDED.taxon_id,
                    fetched_at = EXCLUDED.fetched_at,
                    public_positional_accuracy = EXCLUDED.public_positional_accuracy,
                    updated_at = EXCLUDED.updated_at
                WHERE EXCLUDED.updated_at > inaturalist.observations.updated_at
                RETURNING id`;
            observationsUpserted = rows.count;
        }

        // 3. Photos for the fetched observations, then reconcile: delete any stored
        //    photo of THOSE observations that the fetch no longer returns. Bounded
        //    to upsertObsIds — photos of observations outside this fetch are never
        //    touched (same guarantee as the live per-observation reconcile).
        let photosUpserted = 0;
        let photosDeleted = 0;
        if (upsertObsIds.length > 0) {
            if (photoPayload.length > 0) {
                const rows = await tx`
                    INSERT INTO inaturalist.observation_photos (
                        id, observation_id, seq, attribution, hidden, license, original_dimensions, url
                    )
                    SELECT
                        v.id, v.observation_id, v.seq, v.attribution, v.hidden,
                        v.license::license, ROW(v.height, v.width)::public.dimensions, v.url
                    FROM jsonb_to_recordset(${tx.json(photoPayload as never)}) AS v(
                        id bigint, observation_id bigint, seq int2, attribution text, hidden bool,
                        license text, height int, width int, url text
                    )
                    -- Only when something differs, for the same reason as the
                    -- maplify upsert: every photo of every fetched observation
                    -- was rewritten each tick — 4.2M updates on a 45k-row table.
                    ON CONFLICT (id) DO UPDATE SET
                        observation_id = EXCLUDED.observation_id,
                        seq = EXCLUDED.seq,
                        attribution = EXCLUDED.attribution,
                        hidden = EXCLUDED.hidden,
                        license = EXCLUDED.license,
                        original_dimensions = EXCLUDED.original_dimensions,
                        url = EXCLUDED.url
                    WHERE (
                        inaturalist.observation_photos.observation_id, inaturalist.observation_photos.seq,
                        inaturalist.observation_photos.attribution, inaturalist.observation_photos.hidden,
                        inaturalist.observation_photos.license, inaturalist.observation_photos.original_dimensions,
                        inaturalist.observation_photos.url
                    ) IS DISTINCT FROM (
                        EXCLUDED.observation_id, EXCLUDED.seq,
                        EXCLUDED.attribution, EXCLUDED.hidden,
                        EXCLUDED.license, EXCLUDED.original_dimensions,
                        EXCLUDED.url
                    )
                    RETURNING id`;
                photosUpserted = rows.count;
            }
            const stale = await tx`
                DELETE FROM inaturalist.observation_photos
                WHERE observation_id = ANY(${upsertObsIds as unknown as number[]}::bigint[])
                  AND id <> ALL(${fetchedPhotoIds as unknown as number[]}::bigint[])
                RETURNING id`;
            photosDeleted += stale.count;
        }

        // 4. Reconcile deletes, window-bounded. Photos first (FK: no cascade), then
        //    the observations themselves.
        let observationsDeleted = 0;
        if (deleteIds.length > 0) {
            const delPhotos = await tx`
                DELETE FROM inaturalist.observation_photos p
                USING inaturalist.observations o
                WHERE p.observation_id = o.id
                  AND o.id = ANY(${deleteIds as unknown as number[]}::bigint[])
                  AND o.observed_at >= (${window.start}::date + 1)
                  AND o.observed_at < ${window.end}::date
                RETURNING p.id`;
            photosDeleted += delPhotos.count;

            const delObs = await tx`
                DELETE FROM inaturalist.observations
                WHERE id = ANY(${deleteIds as unknown as number[]}::bigint[])
                  AND observed_at >= (${window.start}::date + 1)
                  AND observed_at < ${window.end}::date
                RETURNING id`;
            observationsDeleted = delObs.count;
        }

        return { taxaUpserted, observationsUpserted, observationsDeleted, photosUpserted, photosDeleted };
    };

    if (opts.dryRun) {
        const sentinel = Symbol('dry-run-rollback');
        let result: InatPersistResult = {
            taxaUpserted: 0, observationsUpserted: 0, observationsDeleted: 0,
            photosUpserted: 0, photosDeleted: 0,
        };
        try {
            await sql.begin(async (tx) => {
                result = await run(tx);
                throw sentinel;
            });
        } catch (e) {
            if (e !== sentinel) throw e;
        }
        return result;
    }

    return sql.begin(run) as Promise<InatPersistResult>;
}

// =========================================================================
// Orcasound persist (salish-8vr.26 / decision 013, amended 2026-09-20).
//
// Same discipline: injected connection, SQL authored here, ONE atomic transaction.
// Two differences from the sources above:
//   - No window. The corpus is a few hundred bouts read whole each tick, so the reconcile
//     is against every stored bout. The guard that makes that safe is in the shell
//     (fetch-orcasound.ts): a complete fetch, never an empty one.
//   - Not a mirror. public.acoustic_bouts holds our shape (013): a bout's identity is the
//     register entities its tags cite, kept as child rows, replaced wholesale per bout.
// =========================================================================

export type OrcasoundPersistResult = PersistResult & {
    readonly entitiesAdded: number;
    /** Same claim, the moderator's certainty revised in place (054). */
    readonly entitiesRevised: number;
    readonly entitiesRemoved: number;
};

/** Every bout we hold — the whole corpus is the reconcile's unit. */
export async function fetchAcousticBoutIds(sql: Sql): Promise<string[]> {
    const rows = await sql<{ id: string }[]>`SELECT id FROM public.acoustic_bouts`;
    return rows.map((r) => r.id);
}

type BoutPayloadRow = {
    id: string; feed_id: string; feed_name: string; lon: number; lat: number;
    started_at: string; ended_at: string | null; title: string | null;
};

/**
 * Apply a reconcile plan for the whole Orcasound corpus atomically.
 *
 * `upserted` counts bouts written (inserted, or updated because something differed);
 * `entitiesAdded`/`entitiesRemoved` count the identity rows that changed underneath them,
 * which is how a tag gaining an identifier upstream (orcasite#1016) reaches us with no
 * bout touched. On dryRun the transaction is rolled back after executing.
 *
 * Precondition (decision 011): the caller has verified the fetch was complete and
 * non-empty. An empty plan.upsert would delete every bout.
 */
export async function persistOrcasound(
    sql: Sql,
    plan: BoutReconcilePlan,
    opts: { readonly dryRun?: boolean } = {},
): Promise<OrcasoundPersistResult> {
    const payload: BoutPayloadRow[] = plan.upsert.map((b) => ({
        id: b.id, feed_id: b.feedId, feed_name: b.feedName, lon: b.lon, lat: b.lat,
        started_at: b.startedAt, ended_at: b.endedAt, title: b.title,
    }));
    const pairs = plan.upsert.flatMap((b) => b.entities.map((e) => ({ bout_id: b.id, entity_id: e.entityId, certainty: e.certainty })));
    const upsertIds = plan.upsert.map((b) => b.id);
    const deleteIds = plan.delete;

    const run = async (tx: TransactionSql): Promise<OrcasoundPersistResult> => {
        let upserted = 0;
        let entitiesAdded = 0;
        let entitiesRevised = 0;
        let entitiesRemoved = 0;

        if (payload.length > 0) {
            const rows = await tx`
                INSERT INTO public.acoustic_bouts (
                    id, feed_id, feed_name, location, started_at, ended_at, title,
                    provider_id, collection_id
                )
                SELECT
                    v.id, v.feed_id, v.feed_name,
                    gis.ST_Point(v.lon, v.lat)::gis.geography,
                    v.started_at::timestamptz, v.ended_at::timestamptz, v.title,
                    (SELECT id FROM public.providers WHERE slug = 'orcasound'),
                    (SELECT id FROM public.collections WHERE slug = 'orcasound')
                FROM jsonb_to_recordset(${tx.json(payload as never)}) AS v(
                    id text, feed_id text, feed_name text, lon float8, lat float8,
                    started_at text, ended_at text, title text
                )
                -- Only when something differs, for the same reason as Maplify: the whole
                -- corpus arrives every five minutes, and rewriting identical rows would
                -- fire occurrences_changed on every tick. fetched_at then means "last
                -- seen to change", which is the only reading that makes it worth a column.
                ON CONFLICT (id) DO UPDATE SET
                    feed_id = EXCLUDED.feed_id,
                    feed_name = EXCLUDED.feed_name,
                    location = EXCLUDED.location,
                    started_at = EXCLUDED.started_at,
                    ended_at = EXCLUDED.ended_at,
                    title = EXCLUDED.title,
                    fetched_at = now()
                WHERE (
                    acoustic_bouts.feed_id, acoustic_bouts.feed_name,
                    gis.ST_AsBinary(acoustic_bouts.location),
                    acoustic_bouts.started_at, acoustic_bouts.ended_at, acoustic_bouts.title
                ) IS DISTINCT FROM (
                    EXCLUDED.feed_id, EXCLUDED.feed_name,
                    gis.ST_AsBinary(EXCLUDED.location),
                    EXCLUDED.started_at, EXCLUDED.ended_at, EXCLUDED.title
                )
                RETURNING id`;
            upserted = rows.count;

            // Identity rows: make each upserted bout's set exactly what its tags cite now.
            const removed = await tx`
                DELETE FROM public.acoustic_bout_entities e
                WHERE e.bout_id = ANY(${upsertIds as unknown as string[]}::text[])
                  AND NOT EXISTS (
                    SELECT 1 FROM jsonb_to_recordset(${tx.json(pairs as never)}) AS d(bout_id text, entity_id text)
                    WHERE d.bout_id = e.bout_id AND d.entity_id = e.entity_id)
                RETURNING e.bout_id`;
            entitiesRemoved = removed.count;
            if (pairs.length > 0) {
                // A row is the claim and its certainty (054). A revised certainty is the
                // moderator's own revision of the same claim, so it updates in place; an
                // unchanged row is left alone so occurrences_changed does not fire.
                const added = await tx<{ inserted: boolean }[]>`
                    INSERT INTO public.acoustic_bout_entities (bout_id, entity_id, certainty)
                    SELECT d.bout_id, d.entity_id, d.certainty::public.identification_certainty
                    FROM jsonb_to_recordset(${tx.json(pairs as never)}) AS d(bout_id text, entity_id text, certainty text)
                    ON CONFLICT (bout_id, entity_id) DO UPDATE SET certainty = EXCLUDED.certainty
                    WHERE acoustic_bout_entities.certainty IS DISTINCT FROM EXCLUDED.certainty
                    RETURNING (xmax = 0) AS inserted`;
                entitiesAdded = added.filter((r) => r.inserted).length;
                entitiesRevised = added.length - entitiesAdded;
            }
        }

        let deleted = 0;
        if (deleteIds.length > 0) {
            // Entities go with the bout (ON DELETE CASCADE).
            const rows = await tx`
                DELETE FROM public.acoustic_bouts
                WHERE id = ANY(${deleteIds as unknown as string[]}::text[])
                RETURNING id`;
            deleted = rows.count;
        }

        return { upserted, deleted, entitiesAdded, entitiesRevised, entitiesRemoved };
    };

    if (opts.dryRun) {
        const sentinel = Symbol('dry-run-rollback');
        let result: OrcasoundPersistResult = { upserted: 0, deleted: 0, entitiesAdded: 0, entitiesRevised: 0, entitiesRemoved: 0 };
        try {
            await sql.begin(async (tx) => {
                result = await run(tx);
                throw sentinel;
            });
        } catch (e) {
            if (e !== sentinel) throw e;
        }
        return result;
    }

    return sql.begin(run) as Promise<OrcasoundPersistResult>;
}
