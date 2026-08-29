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
 * Usage, against a database you can reach directly (the local stack):
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/backfill/maplify-taxa.ts            # dry run, prints the plan
 *   ... npx tsx scripts/backfill/maplify-taxa.ts --apply  # writes
 *
 * Usage against production, which has no direct route from a laptop — the IPv4 pooler
 * needs DB_PASSWORD, and the Management API (`supabase db query --linked`) runs SQL but
 * cannot run TypeScript. So the plan is computed here and the statement applied there:
 *
 *   npx supabase db query --linked "$(cat <<'SQL'
 *   SELECT json_build_object(
 *     'current', COALESCE((SELECT json_agg(x) FROM (
 *       SELECT name, scientific_name, taxon_id, count(*)::int AS n
 *       FROM maplify.sightings GROUP BY 1, 2, 3) x), '[]'::json),
 *     'taxa', COALESCE((SELECT json_agg(y) FROM (
 *       SELECT id, scientific_name FROM inaturalist.taxa) y), '[]'::json))
 *   SQL
 *   )" | jq '.rows[0].json_build_object' > /tmp/domain.json
 *   npx tsx scripts/backfill/maplify-taxa.ts --plan-from /tmp/domain.json --emit-sql \
 *     > /tmp/backfill.sql
 *   npx supabase db query --linked "$(cat /tmp/backfill.sql)"
 *
 * Those two SELECTs are the plan file's contract, and parsePlan below enforces it: the
 * same columns the direct path reads, so the two routes see the same domain. The COALESCE
 * is not decoration — json_agg over zero rows is NULL, not [], so an empty table would
 * otherwise write "current": null and be rejected as a malformed plan rather than read as
 * the empty domain the direct path sees.
 *
 * The domain is a few dozen rows either way, so nothing large crosses the boundary.
 */

import postgres from 'postgres';
import { resolveScientificName, type NormalizedSighting } from '../ingest/maplify.ts';

type Pair = { name: string | null; scientific_name: string; n: number };
type Row = { name: string | null; scientific_name: string; taxon_id: number | null; n: number };

type Plan = { current: Row[]; taxa: { id: number; scientific_name: string }[] };

/**
 * Read a plan file, refusing anything that is not the shape this script reasons about.
 *
 * The plan arrives from `supabase db query --linked`, so its JSON is not this script's to
 * trust — the same reasoning as the sibling backfill's parsePlan (inat-taxa-status.ts).
 * What goes wrong here is quieter than a bad write. The emitted UPDATE guards itself with
 * IS DISTINCT FROM, so a spurious plan row is a no-op; the damage is to the REPORT the
 * operator reads before applying. A taxon_id arriving as the string "123" makes
 * `to !== row.taxon_id` true for a row that has not changed, and a string `n` makes the
 * row counts concatenate instead of summing. The numbers then describe a plan the
 * statement will not carry out.
 *
 * Duplicates are the exception that can change the outcome. inaturalist.taxa has id as
 * its primary key and scientific_name UNIQUE, so the SQL path cannot produce either; a
 * hand-assembled file can. Two taxa rows sharing a scientific_name leave taxonByName
 * holding whichever came last, silently deciding which taxon every sighting with that
 * name resolves to.
 */
function parsePlan(text: string): Plan {
    // What inaturalist.taxa.id and maplify.sightings.taxon_id actually are. A JSON number
    // that is not an int4 would survive a bare typeof check and fail only at ::int[].
    const isInt4 = (v: unknown): v is number =>
        typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;

    const doc = JSON.parse(text) as Record<string, unknown> | null;
    if (!Array.isArray(doc?.['current']) || !Array.isArray(doc['taxa']))
        throw new Error('--plan-from expects {"current": [...], "taxa": [...]}');

    const row = (where: string, i: number, v: unknown) => {
        const reject = (what: string) =>
            new Error(`--plan-from ${where}[${i}]: ${what} — ${JSON.stringify(v).slice(0, 120)}`);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw reject('must be an object');
        return [v as Record<string, unknown>, reject] as const;
    };

    // The direct path groups by all three columns, so it cannot repeat a tuple; a file
    // can. A repeat is counted twice in the gained/moved totals while the SQL targets the
    // same rows once — the report again describing something the statement will not do.
    // The PAIR may legitimately repeat with a different taxon_id (rows that currently
    // disagree, which is what this backfill exists to settle), so the key is all three.
    const tuples = new Set<string>();
    const current = doc['current'].map((v: unknown, i): Row => {
        const [r, reject] = row('current', i, v);
        // Read the raw value rather than `?? null`: an absent key is not the same claim
        // as an explicit null, and defaulting it would let a file that never mentions
        // `name` target every sighting whose name IS null.
        const name = r['name'];
        if (name !== null && typeof name !== 'string') throw reject('name must be a string or null');
        if (typeof r['scientific_name'] !== 'string') throw reject('scientific_name must be a string');
        const taxonId = r['taxon_id'];
        if (taxonId !== null && !isInt4(taxonId))
            throw reject('taxon_id must be a 32-bit integer or null');
        // n is only ever displayed, but it is displayed as a sum — so a string here does
        // not throw, it prints a concatenation the operator reads as a row count.
        if (!isInt4(r['n']) || r['n'] < 0) throw reject('n must be a non-negative integer');
        const key = JSON.stringify([name, r['scientific_name'], taxonId]);
        if (tuples.has(key))
            throw reject('(name, scientific_name, taxon_id) appears more than once');
        tuples.add(key);
        return { name, scientific_name: r['scientific_name'], taxon_id: taxonId, n: r['n'] };
    });

    const ids = new Set<number>();
    const names = new Set<string>();
    const taxa = doc['taxa'].map((v: unknown, i) => {
        const [r, reject] = row('taxa', i, v);
        if (!isInt4(r['id'])) throw reject('id must be a 32-bit integer');
        if (typeof r['scientific_name'] !== 'string')
            throw reject('scientific_name must be a string');
        if (ids.has(r['id'])) throw reject(`id ${r['id']} appears more than once`);
        if (names.has(r['scientific_name']))
            throw reject(`scientific_name ${r['scientific_name']} appears more than once`);
        ids.add(r['id']);
        names.add(r['scientific_name']);
        return { id: r['id'], scientific_name: r['scientific_name'] };
    });

    return { current, taxa };
}

/** A SQL string literal, or NULL. Names carry apostrophes and mis-decoded bytes. */
function lit(value: string | null): string {
    return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
}

async function main(): Promise<void> {
    const argv = process.argv;
    const apply = argv.includes('--apply');
    const emitSql = argv.includes('--emit-sql');
    const planFrom = argv[argv.indexOf('--plan-from') + 1];
    const usePlanFile = argv.includes('--plan-from');

    // Reject incompatible combinations before doing anything. The dangerous one is
    // --apply --emit-sql: emitting returns early, so the operator asks to write, sees
    // SQL and a zero exit, and believes the backfill ran when nothing was touched. A
    // silent no-op that looks like success is the worst outcome for a script like this.
    if (apply && emitSql) {
        console.error('--apply and --emit-sql are mutually exclusive: one writes, the other prints.');
        process.exit(2);
    }
    // --plan-from means there is no connection to write through.
    if (apply && usePlanFile) {
        console.error('--apply needs a database. Pass SUPABASE_DB_URL without --plan-from,');
        console.error('or use --plan-from with --emit-sql and apply the statement yourself.');
        process.exit(2);
    }
    if (usePlanFile && (!planFrom || planFrom.startsWith('--'))) {
        console.error('--plan-from needs a file path.');
        process.exit(2);
    }

    const dsn = process.env['SUPABASE_DB_URL'];
    if (!usePlanFile && !dsn) {
        console.error('SUPABASE_DB_URL is not set (or pass --plan-from <file>)');
        process.exit(1);
    }
    // Reading the plan from a file means no database connection at all, which is what
    // makes the production route work without a credential.
    const sql = usePlanFile ? null : postgres(dsn!);

    try {
        let current: Row[];
        let taxa: { id: number; scientific_name: string }[];
        if (usePlanFile) {
            const { readFileSync } = await import('node:fs');
            ({ current, taxa } = parsePlan(readFileSync(planFrom!, 'utf8')));
        } else {
            // The domain: every distinct combination the resolver could see, with the
            // taxon each currently carries.
            current = await sql!<Row[]>`
                SELECT name, scientific_name, taxon_id, count(*)::int AS n
                FROM maplify.sightings
                GROUP BY 1, 2, 3`;
            taxa = await sql!<{ id: number; scientific_name: string }[]>`
                SELECT id, scientific_name FROM inaturalist.taxa`;
        }
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

        if (emitSql) {
            if (!changes.length) { console.error('nothing to do'); return; }
            const q = (f: (c: typeof changes[number]) => string) =>
                changes.map(f).join(', ');
            process.stdout.write(
                'UPDATE maplify.sightings s SET taxon_id = plan.taxon_id FROM (SELECT * FROM unnest('
                + `ARRAY[${q((c) => lit(c.pair.name))}]::text[], `
                + `ARRAY[${q((c) => lit(c.pair.scientific_name))}]::text[], `
                + `ARRAY[${q((c) => (c.to === null ? 'NULL' : String(c.to)))}]::int[]`
                + ') AS t(name, scientific_name, taxon_id)) AS plan'
                + ' WHERE s.name IS NOT DISTINCT FROM plan.name'
                + ' AND s.scientific_name = plan.scientific_name'
                + ' AND s.taxon_id IS DISTINCT FROM plan.taxon_id',
            );
            console.error(`-- ${changes.length} combinations, ${gained} gained, ${moved} reassigned`);
            return;
        }

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
        const updated = await sql!`
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
        // No materialized view needs refreshing: public.occurrences is a plain view, so
        // the map and the export see this immediately, and neither occurrence_index nor
        // occurrence_identifier_candidates references taxon (checked in prod 2026-08-28).
    } finally {
        await sql?.end();
    }
}

await main();
