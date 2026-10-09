/**
 * The twin fixture (salish-9uu.11): a snapshot of what the read-path build derives from,
 * with Postgres's own answers beside it, captured once from Postgres before it retired.
 *
 * The derivations under derive/ are twins of Postgres's views, and the views were their
 * only oracle: a test took a snapshot of a local database with `snapshot.ts --answers`,
 * derived from it, and compared. With Postgres gone, the snapshot and the answers are
 * checked-in data instead (fixtures/twins/snapshot/, DuckDB's EXPORT DATABASE as CSV, each
 * table sorted), and the same comparisons run against them. What the rows are and how
 * they were made: fixtures/twins/README.md.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

export const TWIN_FIXTURE = path.join(import.meta.dirname, 'fixtures', 'twins', 'snapshot');

/** Write the fixture's snapshot, the inputs and Postgres's answers alike, to `out`. */
export async function fixtureSnapshot(out: string): Promise<void> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`ATTACH '${out.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await conn.run(await readFile(path.join(TWIN_FIXTURE, 'schema.sql'), 'utf8'));
        // load.sql names each table's file under {dir}, which EXPORT DATABASE wrote absolute.
        const load = await readFile(path.join(TWIN_FIXTURE, 'load.sql'), 'utf8');
        await conn.run(load.replaceAll('{dir}', TWIN_FIXTURE.replaceAll("'", "''")));
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}
