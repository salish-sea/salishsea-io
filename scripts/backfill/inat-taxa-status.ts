/**
 * Refresh deactivation status on the iNaturalist taxa mirror (salish-ayb.4).
 *
 * iNaturalist retires a taxon by marking it inactive and naming a replacement. Our
 * mirror had nowhere to record either, and the ingest wrote taxa with
 * ON CONFLICT DO NOTHING, so a row was never revisited once written.
 *
 * WHY THIS USES THE v1 API WHEN THE INGEST USES v2
 *
 * The ingest fetches its taxon closure from `/v2/taxa`, which supports an `is_active`
 * field — and cannot be used for this, because **v2 omits inactive taxa from its
 * results entirely** rather than returning them flagged. Asking v2 for two ids where
 * one is retired returns one result and `total_results: 1`, with nothing to say the
 * other exists. `/v1/taxa/{ids}` returns it, flagged, with
 * `current_synonymous_taxon_ids` naming the replacement. Verified 2026-08-28 against
 * taxon 1368491 (Sagmatias obliquidens, retired in favour of 1664971).
 *
 * So deactivation is invisible to the path that maintains the mirror, which is exactly
 * why the drift went unnoticed for as long as it did.
 *
 * WHAT IT DOES
 *
 *   1. Asks v1 about every taxon in the mirror, in batches.
 *   2. Records is_active and current_taxon_id.
 *   3. Repoints rows referencing a retired taxon onto its replacement — at write time,
 *      so `public.occurrences` carries no resolution logic (decision 008: translate at
 *      the boundary).
 *
 * Idempotent: a second run reports nothing to do.
 *
 * Usage:
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/backfill/inat-taxa-status.ts            # dry run
 *   ... npx tsx scripts/backfill/inat-taxa-status.ts --apply  # writes
 */

import postgres from 'postgres';

const V1_TAXA = 'https://api.inaturalist.org/v1/taxa';
const BATCH = 30;          // iNaturalist caps the id list at ~30
const PAUSE_MS = 1100;     // their stated courtesy limit is 60 requests/minute
const USER_AGENT = 'salishsea.io taxa mirror refresh (+https://salishsea.io)';

type Upstream = { id: number; is_active: boolean; current: number | null; name: string };

async function fetchStatus(ids: number[]): Promise<Map<number, Upstream>> {
    const out = new Map<number, Upstream>();
    for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const res = await fetch(`${V1_TAXA}/${batch.join(',')}`, {
            headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok)
            throw new Error(`iNaturalist ${res.status} for ids ${batch[0]}…: ${await res.text()}`);
        const body = (await res.json()) as { results: readonly Record<string, unknown>[] };
        for (const t of body.results) {
            const replacements = (t['current_synonymous_taxon_ids'] as number[] | null) ?? [];
            out.set(t['id'] as number, {
                id: t['id'] as number,
                is_active: Boolean(t['is_active']),
                // More than one replacement means iNaturalist split the taxon, and
                // picking one would be a guess about which animal was seen. Leave it
                // null and let it surface as an inactive taxon nobody repointed.
                current: replacements.length === 1 ? replacements[0]! : null,
                name: t['name'] as string,
            });
        }
        if (i + BATCH < ids.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    return out;
}

async function main(): Promise<void> {
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }
    const apply = process.argv.includes('--apply');
    const sql = postgres(dsn);

    try {
        const mirrored = await sql<{ id: number; is_active: boolean; current_taxon_id: number | null }[]>`
            SELECT id, is_active, current_taxon_id FROM inaturalist.taxa ORDER BY id`;
        console.log(`asking iNaturalist about ${mirrored.length} mirrored taxa (v1, ${BATCH} per request)…`);
        const upstream = await fetchStatus(mirrored.map((t) => t.id));

        const missing = mirrored.filter((t) => !upstream.has(t.id));
        if (missing.length)
            console.log(`\n${missing.length} taxa the API did not return — left untouched: `
                + missing.map((t) => t.id).join(', '));

        // current_taxon_id is a foreign key, and the mirror holds only taxa we actually
        // reference — so a replacement we have never seen cannot be recorded as one. Of
        // the nine retired taxa found on 2026-08-28, two replacements were mirrored and
        // seven were not. Fetching the missing ones would drag in their whole ancestor
        // chain, which is the ingest's job and not this script's.
        //
        // So a retirement whose replacement we do not hold is still recorded as retired,
        // with a null pointer. That is the honest state: we know the taxon is dead, and
        // we do not hold its successor. Nothing references those taxa anyway — if
        // something did, it would show up in the repoint counts below as unmovable.
        const mirroredIds = new Set(mirrored.map((t) => t.id));
        const targetFor = (id: number): number | null => {
            const c = upstream.get(id)?.current ?? null;
            return c !== null && mirroredIds.has(c) ? c : null;
        };

        const changed = mirrored.filter((t) => {
            const u = upstream.get(t.id);
            return u && (u.is_active !== t.is_active || targetFor(t.id) !== t.current_taxon_id);
        });

        const retired = changed.filter((t) => !upstream.get(t.id)!.is_active);
        console.log(`\n${changed.length} taxa change status; ${retired.length} are retired upstream`);
        for (const t of retired) {
            const u = upstream.get(t.id)!;
            const target = targetFor(t.id);
            const note = target !== null ? String(target)
                : u.current !== null ? `${u.current} — not mirrored, recorded as retired only`
                : '(no replacement offered)';
            console.log(`  ${t.id}  ${u.name}  ->  ${note}`);
        }

        // What the repointing would move. Counted before writing so a dry run says
        // exactly what an --apply would do.
        const repointable = retired.filter((t) => targetFor(t.id) !== null).map((t) => t.id);

        // A retired taxon we cannot repoint, that something still references, is the one
        // case needing a human: the records point at a dead concept and we hold nothing
        // to move them to.
        const stranded = retired.filter((t) => targetFor(t.id) === null).map((t) => t.id);
        if (stranded.length) {
            const [n] = await sql<{ total: number }[]>`
                SELECT (
                    (SELECT count(*) FROM inaturalist.observations WHERE taxon_id = ANY(${stranded}))
                  + (SELECT count(*) FROM maplify.sightings      WHERE taxon_id = ANY(${stranded}))
                  + (SELECT count(*) FROM public.observations    WHERE taxon_id = ANY(${stranded}))
                )::int AS total`;
            if (n!.total > 0)
                console.log(`\nWARNING: ${n!.total} records reference a retired taxon with no `
                    + `mirrored replacement. They keep pointing at a dead concept.`);
        }
        if (repointable.length) {
            const [counts] = await sql<{ inat: number; maplify: number; direct: number }[]>`
                SELECT
                    (SELECT count(*)::int FROM inaturalist.observations WHERE taxon_id = ANY(${repointable})) AS inat,
                    (SELECT count(*)::int FROM maplify.sightings      WHERE taxon_id = ANY(${repointable})) AS maplify,
                    (SELECT count(*)::int FROM public.observations    WHERE taxon_id = ANY(${repointable})) AS direct`;
            console.log(`\nrecords pointing at a retired taxon: `
                + `${counts!.inat} iNaturalist, ${counts!.maplify} Maplify, ${counts!.direct} native`);
        }

        if (!apply) {
            console.log('\nDry run. Pass --apply to write.');
            return;
        }
        if (!changed.length) {
            console.log('nothing to do');
            return;
        }

        const ids = changed.map((t) => t.id);
        const actives = changed.map((t) => String(upstream.get(t.id)!.is_active));
        const currents = changed.map((t) => targetFor(t.id));

        await sql.begin(async (tx) => {
            // Status first. The CHECK constraint requires a replacement to imply
            // inactive, so both columns must move in one statement.
            await tx`
                UPDATE inaturalist.taxa t
                SET is_active = plan.is_active, current_taxon_id = plan.current_taxon_id
                FROM (
                    -- postgres.js infers text[] and int[] from JS arrays but sends a
                    -- boolean[] as a scalar, so the flags go over as text and cast here.
                    SELECT * FROM unnest(${ids}::int[], ${actives}::bool[], ${currents}::int[])
                    AS u(id, is_active, current_taxon_id)
                ) AS plan
                WHERE t.id = plan.id`;

            // Then follow the pointer. Repointing at write time keeps the resolution out
            // of public.occurrences, which stays a plain projection of the mirrors.
            for (const [table, column] of [
                ['inaturalist.observations', 'taxon_id'],
                ['maplify.sightings', 'taxon_id'],
                ['public.observations', 'taxon_id'],
            ] as const) {
                const moved = await tx.unsafe(
                    `UPDATE ${table} r SET ${column} = t.current_taxon_id
                     FROM inaturalist.taxa t
                     WHERE r.${column} = t.id AND t.current_taxon_id IS NOT NULL
                     RETURNING 1`,
                );
                if (moved.length) console.log(`repointed ${moved.length} rows in ${table}`);
            }
        });
        console.log(`\nupdated ${changed.length} taxa`);
    } finally {
        await sql.end();
    }
}

await main();
