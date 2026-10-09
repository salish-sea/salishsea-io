/**
 * The snapshot from the store (decision 065, salish-9uu.3.5): the derivation must not be
 * able to tell it from the snapshot from Postgres, which the twin tests still take, so
 * this pins the store's tables to the Postgres read's names and types. That the two
 * agreed row for row on production's data was checked at the cutover and retired with
 * the way back (salish-9uu.3.9).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { openStore } from '../../api/store/store.ts';
import { parseSighting, saveSighting } from '../../api/sightings.ts';
import { me, signIn } from '../../api/users.ts';
import { snapshotStore } from './snapshot.ts';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'snapshot-store-')); });
afterEach(async () => { await rm(dir, {recursive: true, force: true}); });

async function query(file: string, sql: string): Promise<Record<string, unknown>[]> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`ATTACH '${file}' AS s (READ_ONLY)`);
        return (await conn.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[];
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

const columns = (file: string) => query(file, `
    SELECT table_schema || '.' || table_name AS t, column_name AS c, data_type AS type
    FROM information_schema.columns WHERE table_catalog = 's' AND table_schema IN ('public', 'snapshot')
    ORDER BY t, ordinal_position`);

/** The four tables as the Postgres read gives them: production's types (DuckDB's postgres scanner). */
const POSTGRES_TYPES = {
    'public.contributors': ['id INTEGER', 'name VARCHAR', 'orcid VARCHAR'],
    'public.identifications': ['occurrence_id VARCHAR', 'individual_id INTEGER', 'social_group_id INTEGER',
        'is_present BOOLEAN', 'evidence VARCHAR', 'status VARCHAR', 'code VARCHAR', 'certainty VARCHAR'],
    'public.observation_photos': ['id INTEGER', 'observation_id UUID', 'seq SMALLINT', 'href VARCHAR', 'license_code VARCHAR'],
    'public.observations': ['id UUID', 'url VARCHAR', 'body VARCHAR', 'count SMALLINT', 'direction VARCHAR',
        'subject_location_lon DOUBLE', 'subject_location_lat DOUBLE', 'observer_location_lon DOUBLE',
        'observer_location_lat DOUBLE', 'observed_at TIMESTAMP WITH TIME ZONE', 'entity_id VARCHAR',
        'contributor_id INTEGER', 'provider_id INTEGER', 'collection_id INTEGER', 'source_url VARCHAR', 'accuracy INTEGER'],
    'snapshot.day': ['day VARCHAR'],
    'snapshot.meta': ['taken_at TIMESTAMP WITH TIME ZONE'],
    'snapshot.year': ['year INTEGER'],
};

describe('the snapshot from the store', () => {
    test("the store's rows arrive under Postgres's names, with Postgres's types, and when they were taken", async () => {
        const storeFile = path.join(dir, 'store.db');
        const store = openStore(storeFile);
        const owner = me(store, signIn(store, {sub: 'g1', name: 'Owner', email: null, email_verified: false, picture: null}))!;
        const id = '01977c2a-b313-77a9-8433-ffccbd56bf57';
        saveSighting(store, owner, id, parseSighting({
            observed_at: '2026-10-05T17:00:00.123Z', location: {lon: -123.12345678901234, lat: 48.5},
            observed_from: {lon: -123.2, lat: 48.6}, entity_id: 'SSA:0000900', count: 3, direction: 'north',
            body: 'Three heading north', photos: [{src: 'https://salishsea.io/media/1/a.jpg', license: 'cc-by'}],
        }));
        store.close();

        const snapshot = path.join(dir, 'snapshot.duckdb');
        const before = Date.now();
        await snapshotStore(snapshot, storeFile);

        const types: Record<string, string[]> = {};
        for (const {t, c, type} of await columns(snapshot) as {t: string, c: string, type: string}[])
            (types[t] ??= []).push(`${c} ${type}`);
        expect(types).toEqual(POSTGRES_TYPES);

        expect(await query(snapshot, `SELECT CAST(id AS VARCHAR) AS id, count, direction, subject_location_lon,
                observer_location_lat, epoch_ms(observed_at) AS observed_at, contributor_id, provider_id, collection_id
            FROM s.public.observations`)).toEqual([{
            id, count: 3, direction: 'north', subject_location_lon: -123.12345678901234, observer_location_lat: 48.6,
            observed_at: String(Date.parse('2026-10-05T17:00:00.123Z')), contributor_id: owner.contributor.id, provider_id: 1, collection_id: 10,
        }]);
        expect(await query(snapshot, 'SELECT seq, href FROM s.public.observation_photos'))
            .toEqual([{seq: 1, href: 'https://salishsea.io/media/1/a.jpg'}]);
        const [{taken}] = await query(snapshot, 'SELECT epoch_ms(taken_at) AS taken FROM s.snapshot.meta') as [{taken: string}];
        expect(Number(taken)).toBeGreaterThanOrEqual(before - 1000);
        expect(Number(taken)).toBeLessThanOrEqual(Date.now());
    });
});
