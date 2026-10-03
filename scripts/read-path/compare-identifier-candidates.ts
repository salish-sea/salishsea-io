/**
 * Do the build's identifier candidates agree with Postgres's? (decision 061, salish-xv35.3)
 *
 *   node scripts/read-path/compare-identifier-candidates.ts <snapshot.duckdb>
 *
 * Compares `build.occurrence_identifier_candidates` (derive-identifier-candidates.ts)
 * with `derived.occurrence_identifier_candidates`, Postgres's, read in the same
 * transaction as everything they were derived from. Rows are keyed by occurrence and
 * code, and every column must be equal, location's doubles and observed_at included:
 * nothing here is rendered, so nothing is allowed to differ in rendering either.
 *
 * Exits 1 on any disagreement, after naming it.
 */

import { DuckDBInstance } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';

const SHOWN = 10;

const COLUMNS = ['individual_id', 'social_group_id', 'observed_at', 'location_lon', 'location_lat'] as const;

export async function compare(snapshot: string): Promise<boolean> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const differing = COLUMNS.map(c => `p.${c} IS DISTINCT FROM b.${c}`).join(' OR ');
        await conn.run(`
            CREATE TEMP TABLE disagreement AS
            SELECT coalesce(p.occurrence_id, b.occurrence_id) AS occurrence_id, coalesce(p.code, b.code) AS code,
                   p.occurrence_id IS NULL AS only_build, b.occurrence_id IS NULL AS only_postgres,
                   ${COLUMNS.map(c => `p.${c} AS postgres_${c}, b.${c} AS build_${c}`).join(', ')}
            FROM store.derived.occurrence_identifier_candidates p
            FULL JOIN store.build.occurrence_identifier_candidates b
              ON b.occurrence_id = p.occurrence_id AND b.code = p.code
            WHERE p.occurrence_id IS NULL OR b.occurrence_id IS NULL OR ${differing}`);
        const total = await conn.runAndReadAll('SELECT count(*) FROM store.derived.occurrence_identifier_candidates');
        console.log(`${total.getRows()[0]![0]} identifier candidates in Postgres's store`);
        const summary = await conn.runAndReadAll(`
            SELECT count(*) FILTER (WHERE only_postgres), count(*) FILTER (WHERE only_build),
                   ${COLUMNS.map(c => `count(*) FILTER (WHERE NOT only_postgres AND NOT only_build AND postgres_${c} IS DISTINCT FROM build_${c})`).join(', ')}
            FROM disagreement`);
        const [onlyPostgres, onlyBuild, ...byColumn] = summary.getRows()[0]!.map(Number);
        if (onlyPostgres) console.log(`only in Postgres: ${onlyPostgres}`);
        if (onlyBuild) console.log(`only in the build: ${onlyBuild}`);
        COLUMNS.forEach((c, i) => { if (byColumn[i]) console.log(`${byColumn[i]} differ in ${c}`); });
        const examples = await conn.runAndReadAll(`SELECT * FROM disagreement ORDER BY occurrence_id, code LIMIT ${SHOWN}`);
        for (const row of examples.getRowObjectsJson()) console.log(`  ${JSON.stringify(row)}`);
        const agree = examples.getRows().length === 0;
        console.log(agree ? 'the build agrees with Postgres on every identifier candidate' : 'disagreement');
        return agree;
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: compare-identifier-candidates.ts <snapshot.duckdb>');
        process.exit(2);
    }
    if (!await compare(snapshot)) process.exit(1);
}

if (import.meta.main) {
    await main();
}
