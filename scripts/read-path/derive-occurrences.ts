/**
 * Derive the occurrences in the build (decision 061, salish-xv35.2), from the
 * snapshot's copies of what Postgres derives them from.
 *
 *   node scripts/read-path/derive-occurrences.ts <snapshot.duckdb>
 *
 * Writes `build.occurrences` into the snapshot: id, observed_at and the document,
 * the shape of `snapshot.occurrences`, which holds Postgres's answer. The SQL is
 * derive/occurrences.sql, twins of the five Postgres views, after derive/shared.sql;
 * the two text extractions they call run first, as JavaScript (derive/extract.ts).
 * compare-occurrences.ts checks the result against Postgres's.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

import { writeExtractions } from './derive/extract.ts';
import { writeInaturalistOutOfScope } from './derive/inaturalist-scope.ts';
import { writeMaplifyEntities } from './derive/maplify-entities.ts';
import { budget } from './duckdb-budget.ts';

export async function deriveOccurrences(snapshot: string): Promise<number> {
    const shared = await readFile(new URL('./derive/shared.sql', import.meta.url), 'utf8');
    const sql = await readFile(new URL('./derive/occurrences.sql', import.meta.url), 'utf8');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        // Capped, as snapshot.ts is, for the 1 GB Fly machine: what doesn't fit spills
        // beside the snapshot. Measured on 63,720 occurrences: it runs out at 64 MB and
        // completes at 96; at 128 the process peaks at 324 MB on macOS, of which about
        // 115 is node and DuckDB before any query. Running out fails this task, loudly,
        // which is the failure to want here, rather than the machine thrashing.
        await budget(conn, snapshot, '128MB');
        // Postgres's session: timestamps rendered in UTC, text sorted by ICU's en-US.
        await conn.run(`INSTALL icu; LOAD icu; SET TimeZone = 'UTC'`);
        // The table's row order means nothing (readers order by observed_at and id),
        // and keeping it would make DuckDB buffer the result.
        await conn.run('SET preserve_insertion_order = false');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await conn.run(shared);
        await writeExtractions(conn);
        await writeMaplifyEntities(conn);
        await writeInaturalistOutOfScope(conn);
        await conn.run(sql);
        const reader = await conn.runAndReadAll('SELECT count(*) FROM build.occurrences');
        return Number(reader.getRows()[0]![0]);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: derive-occurrences.ts <snapshot.duckdb>');
        process.exit(2);
    }
    console.log(`build.occurrences: ${await deriveOccurrences(snapshot)} rows`);
}

if (import.meta.main) {
    await main();
}
