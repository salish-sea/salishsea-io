/**
 * Refresh deactivation status on the iNaturalist taxa mirror (salish-ayb.4).
 *
 * iNaturalist retires a taxon by marking it inactive and naming a replacement. Our
 * mirror had nowhere to record either, and the ingest wrote taxa with
 * ON CONFLICT DO NOTHING, so a row was never revisited once written.
 *
 * WHY THE ROUTE MATTERS MORE THAN THE API VERSION
 *
 * On `/taxa`, the `id=` QUERY PARAM filters to active taxa: asking for a retired id
 * returns `total_results: 0`, with nothing to say it ever existed. The `/taxa/{ids}`
 * PATH form returns the same taxon flagged `is_active: false` with
 * `current_synonymous_taxon_ids` naming its replacement. Both v1 and v2 behave this
 * way; the difference is the route, not the version.
 *
 * The ingest builds `?id=` (see taxaUrl in fetch-inaturalist.ts), so a retirement is
 * invisible to the code that maintains the mirror — which is exactly why this drift
 * went unnoticed. Worse, resolveTaxonClosure treats "requested but not returned" as a
 * hard failure, so a referenced taxon retired since the last run aborts the whole
 * ingest. Filed separately.
 *
 * This script uses v1's path form. v2's path form would serve equally well; v1 is
 * chosen only because it returns both fields without a field selection.
 * Verified 2026-08-28 against taxon 1368491 (Sagmatias obliquidens -> 1664971).
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
        // The repoint below moves any row pointing at ANY taxon carrying a replacement,
        // not only the ones retired on this run — a pointer set by an earlier run whose
        // repoint did not finish is still live work. Count against that same set, or the
        // dry run understates what --apply does.
        const alreadyPointed = mirrored.filter((t) => t.current_taxon_id !== null).map((t) => t.id);
        const willRepoint = [...new Set([...alreadyPointed, ...repointable])];
        if (willRepoint.length) {
            const [counts] = await sql<{ inat: number; maplify: number; direct: number }[]>`
                SELECT
                    (SELECT count(*)::int FROM inaturalist.observations WHERE taxon_id = ANY(${willRepoint})) AS inat,
                    (SELECT count(*)::int FROM maplify.sightings      WHERE taxon_id = ANY(${willRepoint})) AS maplify,
                    (SELECT count(*)::int FROM public.observations    WHERE taxon_id = ANY(${willRepoint})) AS direct`;
            const total = counts!.inat + counts!.maplify + counts!.direct;
            console.log(`\nrecords pointing at a retired taxon: `
                + `${counts!.inat} iNaturalist, ${counts!.maplify} Maplify, ${counts!.direct} native`);
            if (total === 0) console.log('  (nothing to repoint)');
        }

        if (!apply) {
            console.log('\nDry run. Pass --apply to write.');
            return;
        }

        const ids = changed.map((t) => t.id);
        const actives = changed.map((t) => upstream.get(t.id)!.is_active);
        const currents = changed.map((t) => targetFor(t.id));

        await sql.begin(async (tx) => {
            if (changed.length) {
                // Status first. The CHECK constraint requires a replacement to imply
                // inactive, so both columns must move in one statement.
                await tx`
                    UPDATE inaturalist.taxa t
                    SET is_active = plan.is_active, current_taxon_id = plan.current_taxon_id
                    FROM (
                        -- sql.array(), not a bare interpolated JS array: postgres.js
                        -- expands a bare array into a comma-separated VALUE LIST rather
                        -- than an array literal. It happens to infer array context for
                        -- the text and int cases here, but not for booleans — an
                        -- interpolated [true, false] cast to bool[] silently yields
                        -- {false, false}, so every taxon was written inactive regardless
                        -- of what upstream said. Casting the flags to text first does not
                        -- help: text[] -> bool[] misreads them the same way. sql.array()
                        -- is unambiguous for all three.
                        SELECT * FROM unnest(
                            ${sql.array(ids)}::int[],
                            ${sql.array(actives)}::bool[],
                            ${sql.array(currents)}::int[]
                        ) AS u(id, is_active, current_taxon_id)
                    ) AS plan
                    WHERE t.id = plan.id`;
            }

            // Then follow the pointers. Repointing at write time keeps the resolution out
            // of public.occurrences, which stays a plain projection of the mirrors.
            //
            // This runs whether or not a status changed: a pointer written by an earlier
            // run whose repoint did not finish still has rows to move, and skipping the
            // repoint because "nothing changed upstream" would leave them stranded.
            //
            // One pass moves one hop. iNaturalist can retire A in favour of B and later
            // retire B, so a chain needs repeating until nothing moves — bounded, because
            // a pointer cycle would otherwise spin forever. Ten is far above any real
            // chain; hitting it means the data is malformed and a human should look.
            const MAX_HOPS = 10;
            let hop = 0;
            for (;;) {
                if (++hop > MAX_HOPS)
                    throw new Error(
                        `taxon replacement chain still moving after ${MAX_HOPS} hops — `
                        + 'suspect a cycle in inaturalist.taxa.current_taxon_id',
                    );
                let movedThisHop = 0;
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
                    if (moved.length) {
                        movedThisHop += moved.length;
                        console.log(`repointed ${moved.length} rows in ${table}`
                            + (hop > 1 ? ` (hop ${hop})` : ''));
                    }
                }
                if (movedThisHop === 0) break;
            }
        });
        console.log(`\nupdated ${changed.length} taxa`);
    } finally {
        await sql.end();
    }
}

await main();
