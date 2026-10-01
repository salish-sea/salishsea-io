/**
 * Derive the identifier candidates in the build (decision 061, salish-xv35.3): which
 * individual or matriline each designation an occurrence names means.
 *
 *   node scripts/read-path/derive-identifier-candidates.ts <snapshot.duckdb>
 *
 * Writes `build.occurrence_identifier_candidates` into the snapshot, from
 * `build.occurrences` (derive-occurrences.ts) and the catalogue. The SQL is
 * derive/identifier-candidates.sql; compare-identifier-candidates.ts checks the
 * result against Postgres's.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

export async function deriveIdentifierCandidates(snapshot: string): Promise<number> {
    const sql = await readFile(new URL('./derive/identifier-candidates.sql', import.meta.url), 'utf8');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        // As derive-occurrences.ts: capped for the 1 GB Fly machine, spilling beside
        // the snapshot, one thread as Fly has.
        await conn.run(`SET memory_limit = '128MB'`);
        await conn.run('SET threads = 1');
        await conn.run(`SET temp_directory = '${`${snapshot}.tmp`.replaceAll("'", "''")}'`);
        await conn.run('SET preserve_insertion_order = false');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await conn.run(sql);
        const reader = await conn.runAndReadAll('SELECT count(*) FROM build.occurrence_identifier_candidates');
        return Number(reader.getRows()[0]![0]);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: derive-identifier-candidates.ts <snapshot.duckdb>');
        process.exit(2);
    }
    console.log(`build.occurrence_identifier_candidates: ${await deriveIdentifierCandidates(snapshot)} rows`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
