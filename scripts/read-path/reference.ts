/**
 * The reference tables, read from checked-in data rather than from Postgres (decision
 * 064, salish-9uu.2.1): the providers, organizations and collections a sighting is
 * attributed to, the rules that file a Maplify sighting under a collection, and the
 * declared order of the enums the derivation compares by.
 *
 *   node scripts/read-path/reference.ts <snapshot.duckdb>
 *
 * Migrations wrote all of them and nothing in the app does, so they are ours and change
 * only by a pull request. Each file loads into the snapshot database under the Postgres
 * name the derivation joins on, typed as the snapshot used to read it, so the SQL under
 * derive/ reads them unchanged. They were compared with production when they moved, and
 * in CI with a fresh migration replay until Postgres retired (salish-9uu.11).
 *
 * The files are tab-separated with a header. A field is quoted only when it must be, and
 * whitespace is kept exactly: Maplify's comment text is matched literally, and one rule
 * matches a bracket that begins with a space. An empty field is a null.
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

export const REFERENCE_DIR = path.join(import.meta.dirname, '..', '..', 'data', 'reference');

/** A reference table: where it lives in the snapshot, its file, and its columns in order. */
export type ReferenceTable = {table: string, file: string, columns: readonly (readonly [string, string])[]};

/** The enum types the build reads: the derivation's, and the catalogue's vocabularies. */
const ENUMS = [
    'inaturalist.rank', 'public.identification_certainty', 'public.travel_direction',
    'public.license', 'public.sex', 'happywhale.accuracy',
    // the catalogue's vocabularies, which catalogue.ts holds its files to (salish-9uu.2.3)
    'public.designation_scheme', 'public.designation_status', 'public.parentage_certainty',
    'public.nickname_status', 'public.party_kind', 'public.social_group_kind',
];

export const REFERENCE: readonly ReferenceTable[] = [
    {
        table: 'public.providers', file: 'providers.tsv',
        columns: [['id', 'INTEGER'], ['slug', 'VARCHAR'], ['name', 'VARCHAR']],
    },
    {
        table: 'public.organizations', file: 'organizations.tsv',
        columns: [['id', 'INTEGER'], ['name', 'VARCHAR'], ['url', 'VARCHAR']],
    },
    {
        table: 'public.collections', file: 'collections.tsv',
        columns: [['id', 'INTEGER'], ['name', 'VARCHAR'], ['organization_id', 'INTEGER'], ['slug', 'VARCHAR']],
    },
    {
        table: 'maplify.collection_rule', file: 'maplify-collection-rules.tsv',
        columns: [['id', 'INTEGER'], ['match_kind', 'VARCHAR'], ['match_value', 'VARCHAR'], ['collection_id', 'INTEGER']],
    },
    {
        // Each label with its position in its type's declared order: inaturalist.species_id
        // compares ranks by it, and an Orcasound occurrence takes the strongest certainty by
        // it. The others are here because a view casts text to them, which fails on a label
        // the type doesn't have.
        table: 'types.enums', file: 'enums.tsv',
        columns: [['type', 'VARCHAR'], ['label', 'VARCHAR'], ['position', 'INTEGER']],
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

/**
 * Refuse a file whose header doesn't name exactly the declared columns, in order. The
 * reader takes columns by position, so a file with two same-typed columns swapped — `lat`
 * and `lon` — would otherwise load without a word.
 */
export function assertHeader(file: string, columns: readonly (readonly [string, string])[]): void {
    const header = readFileSync(file, 'utf8').split('\n', 1)[0]!.replace(/\r$/, '').split('\t');
    const declared = columns.map(([name]) => name);
    if (header.join('\t') !== declared.join('\t'))
        throw new Error(`${path.basename(file)}: its header is ${header.join(', ')}; expected ${declared.join(', ')}`);
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
        assertHeader(path.join(dir, ref.file), ref.columns);
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

export async function main(): Promise<void> {
    const [arg] = process.argv.slice(2);
    if (!arg) {
        console.error('usage: reference.ts <snapshot.duckdb>');
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
