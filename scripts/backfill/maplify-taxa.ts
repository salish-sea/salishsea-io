/**
 * Re-resolve taxon_id on existing Maplify sightings (salish-7jl).
 *
 * The ingest fetches a start/end window, so a fix to taxon resolution only reaches
 * records ingested after it ships. Everything already stored keeps whatever the old
 * resolver decided — including the species corrections it discarded.
 *
 * WHY IT LOOKS LIKE THIS
 *
 * Resolution lives in one pure function, `resolveScientificName` (decision 011). This
 * script must not restate it in SQL, or the two drift and the second copy is the one
 * nobody tests. But it also should not stream 39,000 rows through Node to apply a
 * function of two columns.
 *
 * So it runs the real function over the *domain* — the distinct (name, scientific_name)
 * pairs, of which there are a few dozen — and hands the result to SQL as a lookup table
 * to apply set-wise. The function stays the single source of truth and the database does
 * the row work.
 *
 * `taxon_id` is ours, not upstream: it is derived by the ingest, not mirrored from
 * Maplify, so rewriting it does not violate decision 008. The upstream columns, and
 * `comments` in particular, are never touched.
 *
 * Usage:
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/backfill/maplify-taxa.ts            # dry run, prints the plan
 *   ... npx tsx scripts/backfill/maplify-taxa.ts --apply  # writes
 */

import postgres from 'postgres';
import { resolveScientificName, type NormalizedSighting } from '../ingest/maplify.ts';

type Pair = { name: string | null; scientific_name: string; n: number };
type Row = { name: string | null; scientific_name: string; taxon_id: number | null; n: number };

async function main(): Promise<void> {
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }
    const apply = process.argv.includes('--apply');
    const sql = postgres(dsn);

    try {
        // The domain: every distinct combination the resolver could see, with the
        // taxon each currently carries.
        const current = await sql<Row[]>`
            SELECT name, scientific_name, taxon_id, count(*)::int AS n
            FROM maplify.sightings
            GROUP BY 1, 2, 3`;

        const taxa = await sql<{ id: number; scientific_name: string }[]>`
            SELECT id, scientific_name FROM inaturalist.taxa`;
        const taxonByName = new Map(taxa.map((t) => [t.scientific_name, t.id]));

        // Rows whose resolution has changed. A pair may appear more than once here when
        // its rows currently disagree — which is itself a symptom of the old resolver.
        const changes: { pair: Pair; from: number | null; to: number | null; n: number }[] = [];
        for (const row of current) {
            const resolved = resolveScientificName({
                scientificName: row.scientific_name,
                name: row.name,
            } as NormalizedSighting);
            const to = resolved ? taxonByName.get(resolved) ?? null : null;
            if (to !== row.taxon_id)
                changes.push({ pair: row, from: row.taxon_id, to, n: row.n });
        }

        const nameById = new Map(taxa.map((t) => [t.id, t.scientific_name]));
        const label = (id: number | null) => (id === null ? '(none)' : nameById.get(id) ?? `#${id}`);

        // A backfill that can blank a taxon is a different and more dangerous operation
        // than one that only fills them in. Refuse rather than ask forgiveness.
        const clearing = changes.filter((c) => c.to === null && c.from !== null);
        if (clearing.length) {
            console.error('REFUSING: these would lose a taxon they currently have.');
            for (const c of clearing)
                console.error(`  ${c.n}  ${label(c.from)} -> (none)  [${c.pair.name} / ${c.pair.scientific_name}]`);
            process.exit(1);
        }

        const gained = changes.filter((c) => c.from === null).reduce((a, c) => a + c.n, 0);
        const moved = changes.filter((c) => c.from !== null).reduce((a, c) => a + c.n, 0);

        console.log(`${changes.length} (name, scientific_name) combinations change resolution`);
        console.log(`${gained} rows gain a taxon, ${moved} rows are reassigned, 0 lose one\n`);
        for (const c of [...changes].sort((a, b) => b.n - a.n))
            console.log(`  ${String(c.n).padStart(5)}  ${label(c.from)} -> ${label(c.to)}`
                + `   [${c.pair.name ?? 'NULL'} / ${c.pair.scientific_name || "''"}]`);

        if (!apply) {
            console.log('\nDry run. Pass --apply to write.');
            return;
        }

        // One statement, atomic on its own. The plan arrives as three parallel arrays
        // rather than a row-literal helper: those are typed at the cast, which a VALUES
        // list of JS objects is not — and `taxon_id` carries nulls that would otherwise
        // be ambiguous.
        //
        // `IS NOT DISTINCT FROM` on name, because it is nullable and NULL = NULL is not
        // true; plain `=` would silently skip every row whose name is null.
        const names = changes.map((c) => c.pair.name);
        const scientificNames = changes.map((c) => c.pair.scientific_name);
        const taxonIds = changes.map((c) => c.to);
        const updated = await sql`
            UPDATE maplify.sightings s
            SET taxon_id = plan.taxon_id
            FROM (
                SELECT * FROM unnest(
                    ${names}::text[], ${scientificNames}::text[], ${taxonIds}::int[]
                ) AS t(name, scientific_name, taxon_id)
            ) AS plan
            WHERE s.name IS NOT DISTINCT FROM plan.name
              AND s.scientific_name = plan.scientific_name
              AND s.taxon_id IS DISTINCT FROM plan.taxon_id
            RETURNING 1`;
        console.log(`\nupdated ${updated.length} rows`);
        console.log('NOTE: public.occurrence_index is a materialized view over these rows;');
        console.log('refresh it if anything downstream reads stale taxa.');
    } finally {
        await sql.end();
    }
}

await main();
