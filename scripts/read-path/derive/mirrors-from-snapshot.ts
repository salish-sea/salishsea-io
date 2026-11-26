/**
 * For tests: mirrors holding exactly what the fixture's source tables hold (twin-fixture.ts,
 * fixtures/twins/), in the mirrors' own shape (the ingest scripts' schemas, only the
 * columns derive/sources.sql reads). The fixture was captured from Postgres, which kept
 * those tables in its own shape; the build derives from its mirrors (salish-xv35.9), so the
 * tests derive from mirrors too.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Mirrors } from './sources.ts';
import { sqlString } from '../duckdb-budget.ts';
import { ensureMirror as ensureDetectionsMirror } from '../ingest-orcasound-detections.ts';
import { ensureMirror as ensureOrcaHelloMirror } from '../ingest-orcahello.ts';

/**
 * The two mirrors of Orcasound's detections (salish-fizm.1), which Postgres never held,
 * written in the ingests' own schemas from fixtures/twins/detections/mirrors.json: the
 * rows of each table, in the mirror's shape. What each should derive is expected.csv there.
 */
const DETECTIONS = path.join(import.meta.dirname, '..', 'fixtures', 'twins', 'detections');

function writeDetectionMirrors(dir: string): NonNullable<Mirrors['detections']> {
    const files = {orcasite: path.join(dir, 'orcasound-detections.sqlite'), orcahello: path.join(dir, 'orcahello.sqlite')};
    const fixture = JSON.parse(readFileSync(path.join(DETECTIONS, 'mirrors.json'), 'utf8')) as Record<string, Record<string, unknown>[]>;
    ensureDetectionsMirror(files.orcasite);
    ensureOrcaHelloMirror(files.orcahello);
    const insert = (file: string, table: string, rows: Record<string, unknown>[]) => {
        const db = new DatabaseSync(file);
        try {
            for (const row of rows) {
                const columns = Object.keys(row);
                db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
                    .run(...columns.map(c => row[c] as null | number | string));
            }
        } finally {
            db.close();
        }
    };
    insert(files.orcasite, 'feeds', fixture['feeds']!);
    insert(files.orcasite, 'detections', fixture['orcasound_detections']!);
    insert(files.orcahello, 'detections', fixture['orcahello']!);
    return files;
}

export async function mirrorsFromSnapshot(snapshot: string, dir: string): Promise<Mirrors> {
    const mirrors = {
        maplify: path.join(dir, 'maplify.sqlite'),
        inaturalist: path.join(dir, 'inaturalist.sqlite'),
        orcasound: path.join(dir, 'orcasound.sqlite'),
    };
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`INSTALL icu; LOAD icu; SET TimeZone = 'UTC'; INSTALL sqlite; LOAD sqlite`);
        await conn.run(`ATTACH ${sqlString(snapshot)} AS store (READ_ONLY)`);
        for (const [name, file] of Object.entries(mirrors))
            await conn.run(`ATTACH ${sqlString(file)} AS ${name} (TYPE sqlite)`);
        await conn.run(`
            CREATE TABLE maplify.sightings AS
              SELECT id, name, scientific_name, location_lon AS lon, location_lat AS lat, number_sighted,
                     CAST(created_at AS VARCHAR) AS created_at, photo_url, comments,
                     CAST(is_test AS INTEGER) AS is_test, CAST(trusted AS INTEGER) AS trusted, source, usernm
              FROM store.maplify.sightings;
            CREATE TABLE inaturalist.observations AS
              SELECT id, description, location_lon AS lon, location_lat AS lat,
                     CAST(observed_at AS VARCHAR) AS observed_at, uri, username AS login, taxon_id,
                     public_positional_accuracy, quality_metrics, annotations
              FROM store.inaturalist.observations;
            CREATE TABLE inaturalist.observation_photos AS
              SELECT id, observation_id, seq, attribution, CAST(hidden AS INTEGER) AS hidden, license, url
              FROM store.inaturalist.observation_photos;
            CREATE TABLE inaturalist.identifications AS
              SELECT id, observation_id, taxon_id, CAST("current" AS INTEGER) AS "current",
                     CAST(own_observation AS INTEGER) AS own_observation, CAST(hidden AS INTEGER) AS hidden, user_id, body,
                     login, nullif("name", '') AS "name", created_at
              FROM store.inaturalist.identifications;
            CREATE TABLE inaturalist.comments AS
              SELECT id, observation_id, user_id, login, body, CAST(hidden AS INTEGER) AS hidden,
                     created_at, nullif("name", '') AS "name"
              FROM store.inaturalist.comments;
            CREATE TABLE inaturalist.taxa AS
              SELECT id, parent_id, scientific_name, vernacular_name, rank, current_taxon_id
              FROM store.inaturalist.taxa;
            CREATE TABLE orcasound.bouts AS
              SELECT id, feed_id, feed_name, title, location_lon AS lon, location_lat AS lat,
                     -- Postgres kept biophony bouts only, so every row it holds is one (salish-xv35.18)
                     'biophony' AS category,
                     CAST(started_at AS VARCHAR) AS started_at, CAST(ended_at AS VARCHAR) AS ended_at
              FROM store.public.acoustic_bouts;
            CREATE TABLE orcasound.bout_entities AS
              SELECT bout_id, entity_id, certainty FROM store.public.acoustic_bout_entities`);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    return {...mirrors, detections: writeDetectionMirrors(dir)};
}
