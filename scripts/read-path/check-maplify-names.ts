/**
 * Does the build still name every Maplify sighting Postgres named? (salish-xv35.9)
 *
 *   node scripts/read-path/check-maplify-names.ts <snapshot.duckdb>
 *
 * The build resolves a Maplify sighting's animal from the register it was given
 * (derive/maplify-entities.ts), so a register edition that loses a name would quietly
 * drop every sighting that used it from the map: renaming one register name dropped 30.
 * Postgres's ingest refuses that (resolve-maplify.ts exits non-zero rather than take an
 * identification away), and while it ingests Maplify its stored entity_id is the last
 * answer it accepted. This asks the build's own rule, resolveEntity over the snapshot's
 * register, about each (name, scientific name) pair Postgres has named, and fails the
 * build, naming them, if any now resolves to nothing. A gate before the derivation, so
 * a failure leaves the last good files published.
 *
 * Only an identification taken away fails it; one moved to another entity is a register
 * edit doing its job. It reads Postgres's answer, so it lasts as long as Postgres
 * ingests Maplify; once that stops it needs the build's own previous answer instead.
 */

import { DuckDBInstance } from '@duckdb/node-api';

import { resolveEntity, type NormalizedSighting } from '../ingest/maplify.ts';
import { buildNameIndex, NAME_INDEX_SQL, type RegisterName } from '../register/name-index.ts';
import { budget } from './duckdb-budget.ts';

export type Unnamed = {name: string | null, scientific_name: string, was: string, sightings: number};

export async function unnamedPairs(snapshot: string): Promise<Unnamed[]> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run('USE store');
        const index = buildNameIndex((await conn.runAndReadAll(NAME_INDEX_SQL)).getRowObjectsJS() as unknown as RegisterName[]);
        const named = (await conn.runAndReadAll(`
            SELECT name, scientific_name, any_value(entity_id) AS was, CAST(count(*) AS INTEGER) AS sightings
            FROM maplify.sightings
            WHERE entity_id IS NOT NULL
            GROUP BY name, scientific_name
            ORDER BY sightings DESC`)).getRowObjectsJS() as unknown as Unnamed[];
        // resolveEntity reads only these two of a sighting's fields.
        return named.filter(({name, scientific_name: scientificName}) =>
            resolveEntity({name, scientificName} as NormalizedSighting, index) === null);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: check-maplify-names.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const unnamed = await unnamedPairs(snapshot);
    if (unnamed.length === 0) {
        console.log('every Maplify name Postgres resolved still resolves');
        return;
    }
    const total = unnamed.reduce((n, u) => n + u.sightings, 0);
    console.error(`the register no longer names ${total} Maplify sightings Postgres named:`);
    for (const u of unnamed)
        console.error(`  ${JSON.stringify(u.name)} / ${JSON.stringify(u.scientific_name)} (was ${u.was}): ${u.sightings}`);
    process.exit(1);
}

if (import.meta.main) {
    await main();
}
