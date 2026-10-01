/**
 * The macros of a derive/*.sql file, loaded alone into an empty DuckDB, so a test can
 * check a twin of one Postgres function against that function without the tables the
 * rest of the file reads.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

/** A query runner over the macros `file` (beside this module) defines, in a UTC session with ICU. */
export async function withMacros(file: string): Promise<(sql: string, values?: Record<string, string>) => Promise<unknown>> {
    const sql = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    const macros = sql.split(/;\s*\n/)
        .map(statement => statement.replace(/^(\s*--.*\n)*/, ''))
        .filter(statement => statement.startsWith('CREATE OR REPLACE TEMP MACRO'));
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    await conn.run(`INSTALL icu; LOAD icu; SET TimeZone = 'UTC'`);
    for (const macro of macros) await conn.run(macro);
    return async (query, values) => (await conn.runAndReadAll(query, values)).getRows()[0]![0];
}
