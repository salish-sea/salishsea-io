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

/**
 * The columns holding a record's taxon, repointed together.
 *
 * Six columns reference inaturalist.taxa. Four are here. The two absent ones are absent
 * on purpose:
 *
 *   inaturalist.taxa.current_taxon_id — this script writes it; following it is the point.
 *   inaturalist.taxa.parent_id        — ancestry, not an observation. Repointing a parent
 *       rewrites the taxonomy tree, which is the ingest's business, not a backfill's. It
 *       is not hypothetical: four mirrored taxa currently sit under the retired genus
 *       1317295. Left alone deliberately, and reported by the warning below so it is
 *       visible rather than silently skipped.
 */
const TAXON_COLUMNS = [
    ['inaturalist.observations', 'taxon_id'],
    ['maplify.sightings', 'taxon_id'],
    ['public.observations', 'taxon_id'],
    // Catalogue animals. Zero rows affected today, but an individual pinned to a retired
    // taxon was previously invisible to both the dry run and the apply.
    ['public.individuals', 'taxon_id'],
] as const;

/** `count(*)` per taxon-holding column, for the given taxon ids. */
async function countReferencing(
    sql: postgres.Sql,
    ids: readonly number[],
): Promise<{ table: string; n: number }[]> {
    if (!ids.length) return [];
    const union = TAXON_COLUMNS
        .map(([t, c]) => `SELECT '${t}' AS "table", count(*)::int AS n FROM ${t} WHERE ${c} = ANY($1)`)
        .join(' UNION ALL ');
    return sql.unsafe(union, [ids as number[]]) as unknown as Promise<{ table: string; n: number }[]>;
}

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
            // A 200 whose rows omit is_active would coerce to false and mass-retire the
            // whole mirror. Refuse the response instead of writing a guess.
            if (typeof t['is_active'] !== 'boolean' || typeof t['id'] !== 'number')
                throw new Error(
                    `iNaturalist returned a taxon without a usable id/is_active: ${JSON.stringify(t).slice(0, 200)}`,
                );
            const replacements = (t['current_synonymous_taxon_ids'] as number[] | null) ?? [];
            out.set(t['id'] as number, {
                id: t['id'] as number,
                is_active: t['is_active'],
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
        // Reactivations are rarer and more surprising than retirements, so name them.
        // A bare "1 taxa change status" with no id is what made a write bug here opaque.
        for (const t of changed.filter((c) => upstream.get(c.id)!.is_active))
            console.log(`  ${t.id}  ${upstream.get(t.id)!.name}  ->  active again`);
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
        //
        // Six columns reference inaturalist.taxa. This counts and moves the four that
        // hold observations; the two it does not are called out below rather than
        // silently skipped.
        // Reported on EVERY run, not only the one where the retirement first appears —
        // a stranded record stays stranded, and a warning that prints once is a warning
        // nobody sees.
        const allRetired = mirrored
            .filter((t) => !(upstream.get(t.id)?.is_active ?? true))
            .map((t) => t.id);
        const stranded = allRetired.filter((id) => targetFor(id) === null);
        if (stranded.length) {
            const rows = await countReferencing(sql, stranded);
            const total = rows.reduce((a, r) => a + r.n, 0);
            if (total > 0) {
                console.log(`\nWARNING: ${total} records reference a retired taxon with no `
                    + 'mirrored replacement. They keep pointing at a dead concept:');
                for (const r of rows.filter((r) => r.n > 0)) console.log(`    ${r.n}  ${r.table}`);
            }
        }
        // Ancestry is not repointed (see TAXON_COLUMNS). Say so when it is actually dirty.
        const [orphanParents] = await sql<{ n: number }[]>`
            SELECT count(*)::int AS n FROM inaturalist.taxa c
            JOIN inaturalist.taxa p ON p.id = c.parent_id WHERE NOT p.is_active`;
        if (orphanParents!.n > 0)
            console.log(`\nNOTE: ${orphanParents!.n} taxa sit under a retired parent. `
                + 'Ancestry is left to the ingest; inaturalist.species_id() walks parent_id.');
        // The repoint below moves any row pointing at ANY taxon carrying a replacement,
        // not only the ones retired on this run — a pointer set by an earlier run whose
        // repoint did not finish is still live work. Count against that same set, or the
        // dry run understates what --apply does.
        const alreadyPointed = mirrored.filter((t) => t.current_taxon_id !== null).map((t) => t.id);
        const willRepoint = [...new Set([...alreadyPointed, ...repointable])];
        if (willRepoint.length) {
            const rows = await countReferencing(sql, willRepoint);
            const total = rows.reduce((a, r) => a + r.n, 0);
            console.log(`\nrecords to repoint: ${total}`);
            for (const r of rows.filter((r) => r.n > 0)) console.log(`    ${r.n}  ${r.table}`);
            if (total === 0) console.log('  (nothing to repoint)');
        }

        // A mutual pair (A->B, B->A) is possible across two upstream swaps and no CHECK
        // forbids it — only self-pointing. The repoint would then swap rows every hop and
        // never settle, hit MAX_HOPS, and roll back the whole transaction including every
        // unrelated status flag. Detect it here and drop just the offending pair, so one
        // bad pair costs its own rows instead of the entire run.
        const pointerAfter = new Map<number, number | null>(
            mirrored.map((t) => [t.id, changed.includes(t) ? targetFor(t.id) : t.current_taxon_id]),
        );
        const inCycle = new Set<number>();
        for (const start of pointerAfter.keys()) {
            const seen = new Set<number>([start]);
            let at = pointerAfter.get(start) ?? null;
            while (at !== null && !seen.has(at)) {
                seen.add(at);
                at = pointerAfter.get(at) ?? null;
            }
            if (at !== null) seen.forEach((id) => inCycle.add(id));
        }
        if (inCycle.size) {
            console.log(`\nWARNING: ${inCycle.size} taxa form a replacement cycle upstream `
                + `(${[...inCycle].join(', ')}). Their pointers are left unset; nothing else `
                + 'is affected. A human should decide which taxon wins.');
        }

        if (!apply) {
            console.log('\nDry run. Pass --apply to write.');
            return;
        }

        const ids = changed.map((t) => t.id);
        const actives = changed.map((t) => upstream.get(t.id)!.is_active);
        // A taxon in a cycle is still recorded retired; only its pointer is withheld.
        const currents = changed.map((t) => (inCycle.has(t.id) ? null : targetFor(t.id)));

        await sql.begin(async (tx) => {
            if (changed.length) {
                // Status first. The CHECK constraint requires a replacement to imply
                // inactive, so both columns must move in one statement.
                await tx`
                    UPDATE inaturalist.taxa t
                    SET is_active = plan.is_active, current_taxon_id = plan.current_taxon_id
                    FROM (
                        -- sql.array(), not a bare interpolated JS array. postgres.js
                        -- infers an unknown type for a plain array, lets the server
                        -- DESCRIBE the parameter (the cast decides it), then serializes
                        -- each element with that type's serializer. The int and text
                        -- serializers are value-faithful; the boolean one is identity
                        -- based (x === true ? t : f, postgres/src/types.js:25),
                        -- so a JS STRING 'true' is not === true and silently becomes 'f'.
                        -- That wrote every taxon inactive. sql.array() declares the type
                        -- up front and the real booleans serialize correctly.
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
                for (const [table, column] of TAXON_COLUMNS) {
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
