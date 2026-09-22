/**
 * Re-resolve every stored Maplify sighting against the loaded register edition
 * (salish-53t.3, decision 049).
 *
 * The ingest resolves a sighting's entity when it writes the row, and it only re-reads
 * the last ten days. So when a new edition adds a name — "Gray" for the gray whale, a
 * genus that did not exist — every older record keeps what the previous edition said.
 * This closes that gap. It runs in register-refresh right after the loader, which Deploy
 * also calls after `supabase db push`, so the first run after this change's migration is
 * automatic.
 *
 * WHY IT LOOKS LIKE THIS (the shape of the backfill it replaces, scripts/backfill/
 * maplify-taxa.ts): resolution lives in one pure function, `resolveEntity`, and must not
 * be restated in SQL, where it would drift and the second copy would be the untested one.
 * Nor should 28,000 rows stream through Node to apply a function of two columns. So the
 * real function runs over the DOMAIN — the distinct (name, scientific_name) pairs, about
 * eighty — and SQL applies the result set-wise.
 *
 * REFUSES TO TAKE AN IDENTIFICATION AWAY. A pair that currently has an entity and would
 * resolve to none is reported and nothing is written, and the process exits non-zero. Run
 * unattended after every register load, that is the guard against an edition that lost
 * names: the workflow goes red and files an issue instead of quietly un-naming records.
 * Moving to a DIFFERENT entity is allowed — that is what a better edition does.
 *
 * `entity_id` is ours, derived by the ingest, not mirrored from Maplify, so rewriting it
 * does not violate decision 008. The upstream columns are never touched.
 *
 * Usage:
 *   SUPABASE_DB_URL=... pnpm exec tsx scripts/register/resolve-maplify.ts           # dry run
 *   SUPABASE_DB_URL=... pnpm exec tsx scripts/register/resolve-maplify.ts --apply   # writes
 */

import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { resolveEntity, type NormalizedSighting } from '../ingest/maplify.ts';
import { fetchNameIndex } from '../ingest/persist.ts';

type Row = { name: string | null; scientific_name: string; entity_id: string | null; n: number };
type Change = { row: Row; to: string | null };

/**
 * What would change, and what would be lost. Pure, so the refusal rule is testable
 * without a database.
 */
export function planResolution(current: readonly Row[], resolve: (r: Row) => string | null) {
    const changes: Change[] = [];
    for (const row of current) {
        const to = resolve(row);
        if (to !== row.entity_id) changes.push({ row, to });
    }
    const losing = changes.filter((c) => c.to === null && c.row.entity_id !== null);
    return { changes, losing };
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }
    const sql = postgres(dsn, { max: 1 });
    try {
        const index = await fetchNameIndex(sql);
        const [edition] = await sql<{ tag: string }[]>`SELECT tag FROM register.edition`;
        console.log(`register edition: ${edition?.tag ?? '(none loaded)'}; ${index.byFold.size} distinct folded names`);

        const current = await sql<Row[]>`
            SELECT name, scientific_name, entity_id, count(*)::int AS n
            FROM maplify.sightings
            GROUP BY 1, 2, 3`;
        const { changes, losing } = planResolution(current, (r) =>
            resolveEntity({ name: r.name, scientificName: r.scientific_name } as NormalizedSighting, index));

        const describe = (c: Change) =>
            `  ${String(c.row.n).padStart(6)}  ${c.row.entity_id ?? '(none)'} -> ${c.to ?? '(none)'}`
            + `   [${c.row.name ?? 'NULL'} / ${c.row.scientific_name || "''"}]`;

        if (losing.length) {
            console.error('REFUSING: these would lose the entity they currently have. Nothing written.');
            for (const c of losing) console.error(describe(c));
            process.exit(1);
        }

        const gained = changes.filter((c) => c.row.entity_id === null).reduce((a, c) => a + c.row.n, 0);
        const moved = changes.filter((c) => c.row.entity_id !== null).reduce((a, c) => a + c.row.n, 0);
        console.log(`${changes.length} (name, scientific_name) combinations change: `
            + `${gained} rows gain an entity, ${moved} move to a different one, 0 lose one`);
        for (const c of [...changes].sort((a, b) => b.row.n - a.row.n)) console.log(describe(c));

        if (!apply || !changes.length) {
            if (!apply) console.log('Dry run. Pass --apply to write.');
            return;
        }

        // One statement, atomic. `IS NOT DISTINCT FROM` on name because it is nullable,
        // and on entity_id so an unchanged row is not rewritten (which would broadcast
        // occurrences_changed for nothing — bd salish-xfo).
        const updated = await sql`
            UPDATE maplify.sightings s
            SET entity_id = plan.entity_id
            FROM unnest(
                ${changes.map((c) => c.row.name)}::text[],
                ${changes.map((c) => c.row.scientific_name)}::text[],
                ${changes.map((c) => c.to)}::text[]
            ) AS plan(name, scientific_name, entity_id)
            WHERE s.name IS NOT DISTINCT FROM plan.name
              AND s.scientific_name = plan.scientific_name
              AND s.entity_id IS DISTINCT FROM plan.entity_id
            RETURNING 1`;
        console.log(`updated ${updated.count} rows`);
    } finally {
        await sql.end();
    }
}

// Run only as a script, so the test can import planResolution.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
