/**
 * The reference tables, read from checked-in data rather than from Postgres (decision
 * 064, salish-9uu.2.1): the providers, organizations and collections a sighting is
 * attributed to, the rules that file a Maplify sighting under a collection, and the
 * declared order of the enums the derivation compares by.
 *
 *   node scripts/read-path/reference.ts <snapshot.duckdb>
 *   SUPABASE_DB_URL=… node scripts/read-path/reference.ts --compare
 *
 * Migrations wrote all of them and nothing in the app does, so they are ours and change
 * only by a pull request. The first form loads each file into the snapshot database under
 * the Postgres name the derivation joins on, typed as the snapshot used to read it, so the
 * SQL under derive/ reads them unchanged. The second compares the files with a database —
 * once against production when they moved, and in CI against a fresh migration replay —
 * and prints any row only one side has.
 *
 * The files are tab-separated with a header. A field is quoted only when it must be, and
 * whitespace is kept exactly: Maplify's comment text is matched literally, and one rule
 * matches a bracket that begins with a space. An empty field is a null.
 */

import * as path from 'node:path';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

export const REFERENCE_DIR = path.join(import.meta.dirname, '..', '..', 'data', 'reference');

/** A reference table: where it lives in the snapshot, its file, and its columns in order. */
export type ReferenceTable = {table: string, file: string, columns: readonly (readonly [string, string])[], postgres: string};

/** The enum types the derivation reads, as snapshot.ts listed them. */
const ENUMS = [
    'inaturalist.rank', 'public.identification_certainty', 'public.travel_direction',
    'public.license', 'public.sex', 'happywhale.accuracy',
];

export const REFERENCE: readonly ReferenceTable[] = [
    {
        table: 'public.providers', file: 'providers.tsv',
        columns: [['id', 'INTEGER'], ['slug', 'VARCHAR'], ['name', 'VARCHAR']],
        postgres: 'select id, slug, name from public.providers',
    },
    {
        table: 'public.organizations', file: 'organizations.tsv',
        columns: [['id', 'INTEGER'], ['name', 'VARCHAR'], ['url', 'VARCHAR']],
        postgres: 'select id, name, url from public.organizations',
    },
    {
        table: 'public.collections', file: 'collections.tsv',
        columns: [['id', 'INTEGER'], ['name', 'VARCHAR'], ['organization_id', 'INTEGER'], ['slug', 'VARCHAR']],
        postgres: 'select id, name, organization_id, slug from public.collections',
    },
    {
        table: 'maplify.collection_rule', file: 'maplify-collection-rules.tsv',
        columns: [['id', 'INTEGER'], ['match_kind', 'VARCHAR'], ['match_value', 'VARCHAR'], ['collection_id', 'INTEGER']],
        postgres: 'select id, match_kind, match_value, collection_id from maplify.collection_rule',
    },
    {
        // Each label with its position in its type's declared order: inaturalist.species_id
        // compares ranks by it, and an Orcasound occurrence takes the strongest certainty by
        // it. The others are here because a view casts text to them, which fails on a label
        // the type doesn't have.
        table: 'types.enums', file: 'enums.tsv',
        columns: [['type', 'VARCHAR'], ['label', 'VARCHAR'], ['position', 'INTEGER']],
        postgres: `
            select n.nspname || '.' || t.typname as type, e.enumlabel as label,
                   row_number() over (partition by t.oid order by e.enumsortorder)::int as position
            from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            join pg_namespace n on n.oid = t.typnamespace
            where n.nspname || '.' || t.typname in (${ENUMS.map(e => `'${e}'`).join(', ')})`,
    },
];

/**
 * The DuckDB expression reading one of our checked-in TSV files (data/reference/,
 * data/catalogue/), typed and with nothing guessed: tab-separated with a header, a field
 * quoted only when it must be, whitespace kept, an empty field a null.
 */
export function readTsv(file: string, columns: readonly (readonly [string, string])[]): string {
    const quoted = file.replaceAll("'", "''");
    const typed = columns.map(([name, type]) => `'${name}': '${type}'`).join(', ');
    return `read_csv('${quoted}', delim = '\t', header = true, quote = '"', escape = '"',
                     auto_detect = false, columns = {${typed}}, nullstr = '', allow_quoted_nulls = false, strict_mode = true)`;
}

/** The DuckDB expression reading one reference file. */
export function readFile(ref: ReferenceTable, dir = REFERENCE_DIR): string {
    return readTsv(path.join(dir, ref.file), ref.columns);
}

/** Load every reference table into `<catalog>`, replacing what was there, in one transaction. */
export async function loadReference(conn: DuckDBConnection, catalog: string, dir = REFERENCE_DIR): Promise<void> {
    for (const schema of new Set(REFERENCE.map(r => r.table.split('.')[0]!)))
        await conn.run(`CREATE SCHEMA IF NOT EXISTS ${catalog}.${schema}`);
    await conn.run('BEGIN');
    for (const ref of REFERENCE) {
        await conn.run(`CREATE OR REPLACE TABLE ${catalog}.${ref.table} AS SELECT * FROM ${readFile(ref, dir)}`);
        const count = await conn.runAndReadAll(`SELECT count(*) FROM ${catalog}.${ref.table}`);
        const rows = Number(count.getRows()[0]![0]);
        if (rows === 0) throw new Error(`${ref.file}: no rows`);
        console.log(`${ref.table}: ${rows} rows`);
    }
    // By name, not by count: a misspelled type would otherwise load as an extra one and
    // leave the real one without labels, which the derivation would read as no order.
    const types = await conn.runAndReadAll(`SELECT DISTINCT type FROM ${catalog}.types.enums ORDER BY type`);
    const found = types.getRows().map(r => String(r[0]));
    const expected = [...ENUMS].sort();
    if (found.join('\n') !== expected.join('\n'))
        throw new Error(`enums.tsv: expected the types ${expected.join(', ')}; found ${found.join(', ')}`);
    await conn.run('COMMIT');
}

/** One reference table's rows that only the file, or only the database, has. */
export type Mismatch = {table: string, side: 'file' | 'database', row: unknown[]};

/** Compare every reference file with the database at `dsn`. Never echoes the DSN. */
export async function compareWithPostgres(dsn: string, dir = REFERENCE_DIR): Promise<Mismatch[]> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run('INSTALL postgres; LOAD postgres;');
        try {
            await conn.run(`ATTACH '${dsn.replaceAll("'", "''")}' AS pg (TYPE postgres, READ_ONLY)`);
        } catch {
            throw new Error('Failed to attach Postgres (message withheld: it may contain the DSN)');
        }
        const mismatches: Mismatch[] = [];
        for (const ref of REFERENCE) {
            const typed = ref.columns.map(([name, type]) => `${name}::${type} AS ${name}`).join(', ');
            const file = `SELECT ${typed} FROM ${readFile(ref, dir)}`;
            const database = `SELECT ${typed} FROM postgres_query('pg', $q$${ref.postgres}$q$)`;
            for (const [side, a, b] of [['file', file, database], ['database', database, file]] as const) {
                const result = await conn.runAndReadAll(`(${a}) EXCEPT ALL (${b})`);
                for (const row of result.getRows()) mismatches.push({table: ref.table, side, row});
            }
        }
        return mismatches;
    } finally {
        conn.closeSync();
    }
}

export async function main(): Promise<void> {
    const [arg] = process.argv.slice(2);
    if (arg === '--compare') {
        const dsn = process.env['SUPABASE_DB_URL'];
        if (!dsn) {
            console.error('SUPABASE_DB_URL is not set');
            process.exit(1);
        }
        const mismatches = await compareWithPostgres(dsn);
        for (const {table, side, row} of mismatches)
            console.log(`${table}: only the ${side} has ${JSON.stringify(row, (_, v) => typeof v === 'bigint' ? Number(v) : v)}`);
        console.log(mismatches.length === 0 ? 'the files and the database agree' : `${mismatches.length} rows differ`);
        process.exit(mismatches.length === 0 ? 0 : 1);
    }
    if (!arg) {
        console.error('usage: reference.ts <snapshot.duckdb> | --compare');
        process.exit(2);
    }
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`ATTACH '${arg.replaceAll("'", "''")}' AS store`);
        await loadReference(conn, 'store');
    } finally {
        conn.closeSync();
    }
}

if (import.meta.main) {
    await main();
}
