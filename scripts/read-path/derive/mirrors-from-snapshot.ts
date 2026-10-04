/**
 * For tests: mirrors holding exactly what the snapshot's copies of Postgres's source tables
 * hold, in the mirrors' own shape (the ingest scripts' schemas, only the columns
 * derive/sources.sql reads; the snapshot must be taken with --answers, for Maplify's
 * trusted flag). Deriving from them must give what Postgres stores, which is
 * how the twins of Postgres's views stay checkable now that the build derives from its
 * own mirrors (salish-xv35.9).
 */

import { DuckDBInstance } from '@duckdb/node-api';
import * as path from 'node:path';

import type { Mirrors } from './sources.ts';

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
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        for (const [name, file] of Object.entries(mirrors))
            await conn.run(`ATTACH '${file.replaceAll("'", "''")}' AS ${name} (TYPE sqlite)`);
        await conn.run(`
            CREATE TABLE maplify.sightings AS
              SELECT id, name, scientific_name, location_lon AS lon, location_lat AS lat, number_sighted,
                     CAST(created_at AS VARCHAR) AS created_at, photo_url, comments,
                     CAST(is_test AS INTEGER) AS is_test, CAST(trusted AS INTEGER) AS trusted, source, usernm
              FROM store.maplify.sightings;
            CREATE TABLE inaturalist.observations AS
              SELECT id, description, location_lon AS lon, location_lat AS lat,
                     CAST(observed_at AS VARCHAR) AS observed_at, uri, username AS login, taxon_id,
                     public_positional_accuracy
              FROM store.inaturalist.observations;
            CREATE TABLE inaturalist.observation_photos AS
              SELECT id, observation_id, seq, attribution, CAST(hidden AS INTEGER) AS hidden, license, url
              FROM store.inaturalist.observation_photos;
            CREATE TABLE inaturalist.taxa AS
              SELECT id, parent_id, scientific_name, vernacular_name, rank, current_taxon_id
              FROM store.inaturalist.taxa;
            CREATE TABLE orcasound.bouts AS
              SELECT id, feed_name, title, location_lon AS lon, location_lat AS lat,
                     CAST(started_at AS VARCHAR) AS started_at, CAST(ended_at AS VARCHAR) AS ended_at
              FROM store.public.acoustic_bouts;
            CREATE TABLE orcasound.bout_entities AS
              SELECT bout_id, entity_id, certainty FROM store.public.acoustic_bout_entities`);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    return mirrors;
}
