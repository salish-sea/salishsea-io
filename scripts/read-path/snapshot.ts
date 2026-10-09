/**
 * Snapshot what users write, from the write API's SQLite store into a local DuckDB
 * file (salish-t3g.1, decision 065; the Stelis side is st-ml9 in the stelis repo).
 *
 *   READ_PATH_STORE=/data/store/salishsea.db node scripts/read-path/snapshot.ts <snapshot.duckdb>
 *
 * This is the ingestion boundary of the read-path build: everything downstream
 * reads the snapshot, never the store, so a build's inputs hold still while it
 * runs and the same snapshot always builds the same files. Stelis runs this on
 * every build and content-addresses what it wrote; when nothing in the store
 * changed, the tables digest the same and nothing downstream reruns.
 *
 * The store holds the native sightings, their photos, the contributors and the
 * identifications, read as the same four tables, typed, that Postgres's read gave
 * before the cutover (salish-9uu.3.5), so nothing downstream changed with it.
 * Since 2026-10-09 (salish-9uu.3.9) that is the only way the build reads them:
 * Postgres is no longer the way back. The rest of what the build reads comes from
 * elsewhere: Maplify, iNaturalist and Orcasound from its own mirrors (salish-xv35.9), the
 * reference tables and the catalogue from checked-in files (reference.ts, catalogue.ts,
 * decision 064), the register from its own release (ingest-register.ts), and
 * Happywhale's frozen tables from a file (happywhale.ts).
 *
 * Until salish-9uu.11 this could also read a local Postgres, with Postgres's own derived
 * answers, for the twin tests; those read a checked-in fixture instead (twin-fixture.ts).
 */

import { rmSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';
import { DAY_ZONE } from './pacific-day.ts';

/** A geography column as two doubles, computed as Postgres's views computed them (happywhale-export.ts reads with it). */
const lonLat = (column: string) => [
    `gis.st_x(${column}::gis.geometry) as ${column}_lon`,
    `gis.st_y(${column}::gis.geometry) as ${column}_lat`,
];

/**
 * Happywhale's tables, frozen: nothing has written them since their in-database loader
 * stopped being called (decision 061). The build reads them from one file on the volume
 * (happywhale.ts, decision 064, salish-9uu.2.4), exported once from Postgres with these
 * columns (happywhale-export.ts).
 */
export const HAPPYWHALE_TABLES: readonly {table: string, columns: readonly string[]}[] = [
    {table: 'happywhale.encounters', columns: [
        'id', 'individual_id', 'user_id', 'species_id', 'verbatim_location', 'comments', 'min_count',
        ...lonLat('location'), 'accuracy::text as accuracy', 'start_date', 'start_time', 'end_time',
        'timezone', 'public', 'source_url', 'provider_id', 'collection_id']},
    {table: 'happywhale.users', columns: ['id', 'display_name']},
    {table: 'happywhale.individuals', columns: ['id', 'primary_id', 'sex::text as sex']},
    {table: 'happywhale.species', columns: ['id', 'scientific', 'name']},
    {table: 'happywhale.media', columns: [
        'id', 'encounter_id', 'user_id', 'mimetype', 'url', 'thumb_url', 'public', 'license_level']},
];

/**
 * What users write, read from the store (decision 065): the tables the occurrences and the
 * profile links derive from, under their Postgres names, with the columns and DuckDB types
 * Postgres's read gave them before the cutover, so the derivation can't tell. The
 * store keeps a location as two doubles and a time as ISO 8601 text in UTC; a uuid, an
 * enum and a smallint are text and integers there. Its contributors are only those who
 * sign in or own a native sighting, where Postgres also held every iNaturalist login it
 * minted; the build reads a contributor only through a sighting, so nothing it derives
 * differs (salish-9uu.3.5 compared the two on production's rows).
 */
export const FROM_STORE: readonly {table: string, query: string}[] = [
    {table: 'public.observations', query: `
        SELECT CAST(id AS UUID) AS id, url, body, CAST(count AS SMALLINT) AS count, direction,
               subject_lon AS subject_location_lon, subject_lat AS subject_location_lat,
               observer_lon AS observer_location_lon, observer_lat AS observer_location_lat,
               CAST(observed_at AS TIMESTAMPTZ) AS observed_at, entity_id,
               CAST(contributor_id AS INTEGER) AS contributor_id, CAST(provider_id AS INTEGER) AS provider_id,
               CAST(collection_id AS INTEGER) AS collection_id, source_url, CAST(accuracy AS INTEGER) AS accuracy
        FROM copy.observations`},
    {table: 'public.observation_photos', query: `
        SELECT CAST(id AS INTEGER) AS id, CAST(observation_id AS UUID) AS observation_id,
               CAST(seq AS SMALLINT) AS seq, href, license_code
        FROM copy.observation_photos`},
    {table: 'public.contributors', query: `
        SELECT CAST(id AS INTEGER) AS id, name, orcid FROM copy.contributors`},
    {table: 'public.identifications', query: `
        SELECT occurrence_id, CAST(individual_id AS INTEGER) AS individual_id,
               CAST(social_group_id AS INTEGER) AS social_group_id, is_present = 1 AS is_present,
               evidence, status, code, certainty
        FROM copy.identifications`},
];

export async function main(): Promise<void> {
    const [out] = process.argv.slice(2);
    if (!out) {
        console.error('usage: snapshot.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const store = process.env['READ_PATH_STORE'];
    if (!store) {
        console.error('READ_PATH_STORE is not set');
        process.exit(1);
    }
    await snapshotStore(out, store);
}

/**
 * The snapshot from the store (decision 065): FROM_STORE's tables, and when it was taken. The store is copied first, with SQLite's backup, so the four tables
 * agree with each other however the API writes meanwhile; the copy sits beside the
 * snapshot and is removed when done. The moment is the clock's as the copy begins, so
 * everything saved by then is in it, as Postgres's transaction start was.
 */
export async function snapshotStore(out: string, store: string): Promise<void> {
    const copy = `${out}.store-copy`;
    rmSync(copy, {force: true});
    const source = new DatabaseSync(store, {readOnly: true});
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`CREATE TEMP TABLE taken AS SELECT now() AS taken_at`);
        await backup(source, copy);
        await budget(conn, out, '64MB');
        await conn.run(`ATTACH '${out.replaceAll("'", "''")}' AS store`);
        await conn.run('INSTALL sqlite; LOAD sqlite;');
        await conn.run(`ATTACH '${copy.replaceAll("'", "''")}' AS copy (TYPE sqlite, READ_ONLY)`);
        for (const schema of ['snapshot', 'public']) await conn.run(`CREATE SCHEMA IF NOT EXISTS store.${schema}`);
        await conn.run('BEGIN');
        await conn.run('CREATE OR REPLACE TABLE store.snapshot.meta AS SELECT taken_at FROM temp.main.taken');
        await whenTaken(conn);
        for (const {table, query} of FROM_STORE) {
            await conn.run(`CREATE OR REPLACE TABLE store.${table} AS ${query}`);
            const rows = (await conn.runAndReadAll(`SELECT count(*) FROM store.${table}`)).getRows()[0]![0];
            console.log(`${table}: ${rows} rows (from the store)`);
        }
        await conn.run('COMMIT');
        await conn.run('DETACH copy');
    } finally {
        conn.closeSync();
        db.closeSync();
        source.close();
        rmSync(copy, {force: true});
    }
}

/**
 * snapshot.year and snapshot.day, from snapshot.meta, each its own relation so that the
 * snapshot's moving every build doesn't move them. The Pacific year is all a profile page
 * reads of when (salish-xv35.12); the UTC day dates the Darwin Core archive, so it reruns
 * once a day rather than every build.
 */
async function whenTaken(conn: DuckDBConnection): Promise<void> {
    await conn.run(
        `CREATE OR REPLACE TABLE store.snapshot.year AS
         SELECT year(timezone('${DAY_ZONE}', taken_at))::INTEGER AS year FROM store.snapshot.meta`,
    );
    await conn.run(
        `CREATE OR REPLACE TABLE store.snapshot.day AS
         SELECT strftime(timezone('UTC', taken_at), '%Y-%m-%d') AS day FROM store.snapshot.meta`,
    );
}

if (import.meta.main) {
    await main();
}
