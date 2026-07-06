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
 *   - taxon_id      — LEFT JOIN inaturalist.taxa on the TS-resolved scientific
 *                     name (resolveScientificName is the single source of truth
 *                     for the common-name fallback; the join is a pure lookup).
 *   - collection_id — maplify.resolve_collection(comments, source), a
 *                     curator-editable DB rule table (decision: keep as data).
 *   - provider_id   — column DEFAULT (2 = Maplify).
 *
 * The reconcile DELETE is bounded to [window_start, window_end] in SQL as
 * defence-in-depth: even a caller that passes an out-of-window id cannot delete
 * outside the window. This invariant is the integration test's central assertion.
 */

import type { Sql, TransactionSql } from 'postgres';
import { resolveScientificName, type NormalizedSighting, type ReconcilePlan } from './maplify.ts';
import type {
    NormalizedObservation,
    NormalizedTaxon,
    ObservationReconcilePlan,
} from './inaturalist.ts';

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
 * and the write agree on window membership.
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
 * resolved_name feeds only the taxon join, not a stored column.
 */
type UpsertPayloadRow = {
    id: number; project_id: number; trip_id: number;
    scientific_name: string | null; name: string | null;
    lon: number; lat: number; number_sighted: number; created_at: string;
    photo_url: string | null; comments: string | null; in_ocean: boolean;
    moderated: number; trusted: boolean; is_test: boolean;
    source: string; usernm: string | null; resolved_name: string | null;
};

function toPayload(sightings: readonly NormalizedSighting[]): UpsertPayloadRow[] {
    return sightings.map((s) => ({
        id: s.id, project_id: s.projectId, trip_id: s.tripId,
        scientific_name: s.scientificName, name: s.name, lon: s.lon, lat: s.lat,
        number_sighted: s.numberSighted, created_at: s.createdAt, photo_url: s.photoUrl,
        comments: s.comments, in_ocean: s.inOcean, moderated: s.moderated,
        trusted: s.trusted, is_test: s.isTest, source: s.source, usernm: s.usernm,
        resolved_name: resolveScientificName(s),
    }));
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
    opts: { readonly dryRun?: boolean } = {},
): Promise<PersistResult> {
    const payload = toPayload(plan.upsert);
    const deleteIds = plan.delete;

    const run = async (tx: TransactionSql): Promise<PersistResult> => {
        let upserted = 0;
        if (payload.length > 0) {
            const rows = await tx`
                INSERT INTO maplify.sightings (
                    id, project_id, trip_id, scientific_name, name, location, number_sighted,
                    created_at, photo_url, comments, in_ocean, moderated, trusted, is_test,
                    source, usernm, taxon_id, collection_id
                )
                SELECT
                    v.id, v.project_id, v.trip_id, v.scientific_name, v.name,
                    gis.ST_Point(v.lon, v.lat)::gis.geography, v.number_sighted,
                    v.created_at::timestamp, v.photo_url, v.comments, v.in_ocean, v.moderated,
                    v.trusted, v.is_test, v.source, v.usernm,
                    t.id,
                    maplify.resolve_collection(v.comments, v.source)
                FROM jsonb_to_recordset(${tx.json(payload as never)}) AS v(
                    id int, project_id int, trip_id int, scientific_name text, name text,
                    lon float8, lat float8, number_sighted int, created_at text, photo_url text,
                    comments text, in_ocean bool, moderated int2, trusted bool, is_test bool,
                    source text, usernm text, resolved_name text
                )
                LEFT JOIN inaturalist.taxa AS t ON t.scientific_name = v.resolved_name
                -- On conflict we refresh upstream-mirror fields (incl. in_ocean, a
                -- Maplify-derived flag that tracks the updated location) and taxon_id
                -- (a pure function of the refreshed scientific_name). We deliberately
                -- do NOT refresh collection_id: it is our resolved/curatable domain
                -- value, not a mirror field — re-running resolve_collection here would
                -- clobber a one-time backfill and any curator correction on existing
                -- rows (decision D-07). New rows still get it via the INSERT above.
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
                    taxon_id = EXCLUDED.taxon_id
                RETURNING id`;
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
 * The observation ids currently stored in a window (by observed_at) — fed to
 * reconcile() to compute the delete set. Uses the SAME bound as the reconcile
 * DELETE ([start, end+1)) so the read and the write agree on window membership.
 * observations.id is bigint (returned as string by postgres.js) → coerced to
 * number (iNat ids are well within 2^53).
 */
export async function fetchObservationWindowIds(sql: Sql, window: IngestWindow): Promise<number[]> {
    const rows = await sql<{ id: string }[]>`
        SELECT id FROM inaturalist.observations
        WHERE observed_at >= ${window.start}::date
          AND observed_at < (${window.end}::date + 1)`;
    return rows.map((r) => Number(r.id));
}

type TaxonPayloadRow = {
    id: number; parent_id: number | null; scientific_name: string;
    vernacular_name: string | null; rank: string;
};

type ObservationPayloadRow = {
    id: number; description: string | null; lon: number; lat: number;
    observed_at: string; license_code: string | null; uri: string;
    login: string; orcid: string | null; taxon_id: number;
    public_positional_accuracy: number | null; updated_at: string;
};

type PhotoPayloadRow = {
    id: number; observation_id: number; seq: number; attribution: string;
    hidden: boolean; license: string | null; height: number; width: number; url: string;
};

function toTaxonPayload(taxa: readonly NormalizedTaxon[]): TaxonPayloadRow[] {
    return taxa.map((t) => ({
        id: t.id, parent_id: t.parentId, scientific_name: t.scientificName,
        vernacular_name: t.vernacularName, rank: t.rank,
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

function toPhotoPayload(observations: readonly NormalizedObservation[]): PhotoPayloadRow[] {
    const rows: PhotoPayloadRow[] = [];
    for (const o of observations) {
        for (const p of o.photos) {
            rows.push({
                id: p.id, observation_id: o.id, seq: p.seq, attribution: p.attribution,
                hidden: p.hidden, license: p.license, height: p.height, width: p.width, url: p.url,
            });
        }
    }
    return rows;
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
        //    intra-batch parents resolves at commit. DO NOTHING: taxa are stable
        //    reference data (matches the live upsert_taxon).
        let taxaUpserted = 0;
        if (taxonPayload.length > 0) {
            const rows = await tx`
                INSERT INTO inaturalist.taxa (id, parent_id, scientific_name, vernacular_name, rank)
                SELECT v.id, v.parent_id, v.scientific_name, v.vernacular_name, v.rank::inaturalist.rank
                FROM jsonb_to_recordset(${tx.json(taxonPayload as never)}) AS v(
                    id int, parent_id int, scientific_name text, vernacular_name text, rank text
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
                    ON CONFLICT (id) DO UPDATE SET
                        observation_id = EXCLUDED.observation_id,
                        seq = EXCLUDED.seq,
                        attribution = EXCLUDED.attribution,
                        hidden = EXCLUDED.hidden,
                        license = EXCLUDED.license,
                        original_dimensions = EXCLUDED.original_dimensions,
                        url = EXCLUDED.url
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
                  AND o.observed_at >= ${window.start}::date
                  AND o.observed_at < (${window.end}::date + 1)
                RETURNING p.id`;
            photosDeleted += delPhotos.count;

            const delObs = await tx`
                DELETE FROM inaturalist.observations
                WHERE id = ANY(${deleteIds as unknown as number[]}::bigint[])
                  AND observed_at >= ${window.start}::date
                  AND observed_at < (${window.end}::date + 1)
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
