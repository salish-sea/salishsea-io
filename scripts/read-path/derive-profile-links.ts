/**
 * Derive the profile pages' links to sightings in the build (decision 061,
 * salish-xv35.13): which occurrences each individual, matriline, ecotype and haul-out
 * site was seen in.
 *
 *   node scripts/read-path/derive-profile-links.ts <snapshot.duckdb>
 *
 * Writes `build.individual_occurrences`, `build.group_occurrences`,
 * `build.ecotype_occurrences` and `build.haulout_occurrences` into the snapshot, each in
 * the shape of the snapshot's copy of the Postgres view it twins: one document per row.
 * The SQL is derive/profile-links.sql, after derive/shared.sql; a haul-out report's
 * distance is measured first, in JavaScript (derive/haulout-distance.ts).
 * compare-profile-links.ts checks the result against Postgres's.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

import { writeHauloutDistances } from './derive/haulout-distance.ts';
import { budget } from './duckdb-budget.ts';

const RELATIONS = [
    'individual_occurrences', 'group_occurrences', 'ecotype_occurrences', 'haulout_occurrences',
] as const;

export async function deriveProfileLinks(snapshot: string): Promise<Record<string, number>> {
    const sql = async (file: string) => readFile(new URL(`./derive/${file}`, import.meta.url), 'utf8');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        // As derive-occurrences.ts: capped for the 1 GB Fly machine, spilling beside the
        // snapshot; timestamps rendered in UTC, as Postgres's session renders them.
        await budget(conn, snapshot, '128MB');
        await conn.run(`INSTALL icu; LOAD icu; SET TimeZone = 'UTC'`);
        await conn.run('SET preserve_insertion_order = false');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await conn.run(await sql('shared.sql'));
        await conn.run(await sql('haulout-nearby.sql'));
        await writeHauloutDistances(conn);
        await conn.run(await sql('profile-links.sql'));
        const counts: Record<string, number> = {};
        for (const relation of RELATIONS) {
            const reader = await conn.runAndReadAll(`SELECT count(*) FROM build.${relation}`);
            counts[relation] = Number(reader.getRows()[0]![0]);
        }
        return counts;
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: derive-profile-links.ts <snapshot.duckdb>');
        process.exit(2);
    }
    for (const [relation, n] of Object.entries(await deriveProfileLinks(snapshot)))
        console.log(`build.${relation}: ${n} rows`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
