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
