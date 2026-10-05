/**
 * Derive the occurrences in the build (decision 061, salish-xv35.2): Maplify, iNaturalist
 * and Orcasound from the build's own mirrors (salish-xv35.9, derive/sources.sql), and
 * the rest (native sightings, Happywhale, the register, the reference tables) from the
 * snapshot's copies of Postgres's tables.
 *
 *   node scripts/read-path/derive-occurrences.ts <snapshot.duckdb> <maplify.sqlite> <inaturalist.sqlite> <orcasound.sqlite>
 *
 * Writes `build.occurrences` into the snapshot: id, observed_at and the document,
 * the shape of `snapshot.occurrences`, which holds Postgres's answer. The SQL is
 * derive/occurrences.sql, twins of the five Postgres views, after derive/shared.sql;
 * the two text extractions they call are macros from derive/extract.sql.
 * compare-occurrences.ts checks the result against Postgres's.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

import { writeInaturalistOutOfScope } from './derive/inaturalist-scope.ts';
import { writeMaplifyEntities } from './derive/maplify-entities.ts';
import { attachSources, mirrorArgs, type Mirrors } from './derive/sources.ts';
import { budget } from './duckdb-budget.ts';

export async function deriveOccurrences(snapshot: string, mirrors: Mirrors): Promise<number> {
    const extract = await readFile(new URL('./derive/extract.sql', import.meta.url), 'utf8');
    const shared = await readFile(new URL('./derive/shared.sql', import.meta.url), 'utf8');
    const lookups = await readFile(new URL('./derive/lookups.sql', import.meta.url), 'utf8');
    const maplifyCollection = await readFile(new URL('./derive/maplify-collection.sql', import.meta.url), 'utf8');
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
        await attachSources(conn, mirrors);
        await conn.run(extract);
        await conn.run(shared);
        await conn.run(lookups);
        await conn.run(maplifyCollection);
        await writeMaplifyEntities(conn);
        await writeInaturalistOutOfScope(conn);
        await conn.run(sql);
        // Postgres casts the extracted direction to its enum and fails on anything else;
        // the pattern can only yield these eight, so this is the cast's refusal, kept.
        const odd = await conn.runAndReadAll(`
            SELECT count(*) FROM (SELECT json_extract_string(doc, '$.direction') AS direction FROM build.occurrences)
            WHERE direction IS NOT NULL AND direction NOT IN
              ('north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest')`);
        if (Number(odd.getRows()[0]![0]) > 0) throw new Error('extract_travel_direction answered outside the enum');
        const reader = await conn.runAndReadAll('SELECT count(*) FROM build.occurrences');
        return Number(reader.getRows()[0]![0]);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot, ...rest] = process.argv.slice(2);
    const mirrors = mirrorArgs(rest);
    if (!snapshot || !mirrors) {
        console.error('usage: derive-occurrences.ts <snapshot.duckdb> <maplify.sqlite> <inaturalist.sqlite> <orcasound.sqlite>');
        process.exit(2);
    }
    console.log(`build.occurrences: ${await deriveOccurrences(snapshot, mirrors)} rows`);
}

if (import.meta.main) {
    await main();
}
