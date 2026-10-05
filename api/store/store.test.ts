import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { copyFromPostgres, directQuery, exactDouble, validOrcid } from './copy-from-postgres.ts';
import { migrations, openStore } from './store.ts';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'store-')); });
afterEach(async () => { await rm(dir, {recursive: true, force: true}); });

const fixtures = (db: ReturnType<typeof openStore>) => {
    db.exec(`INSERT INTO contributors (id, entity_id, name) VALUES (1, 'e1', 'Scott')`);
    db.exec(`INSERT INTO users (id, google_sub, contributor_id, created_at) VALUES ('u1', 'g1', 1, '2026-01-01T00:00:00Z')`);
};
const sighting = (id: string, extra = '') => `INSERT INTO observations
    (id, observed_at, subject_lon, subject_lat, contributor_id, user_id, entity_id, created_at, updated_at${extra ? ', count' : ''})
    VALUES ('${id}', '2026-10-05T00:00:00Z', -123.1, 48.5, 1, 'u1', 'SSA:0000900', 'now', 'now'${extra ? `, ${extra}` : ''})`;

describe('the store (decision 065)', () => {
    test('opening it applies every migration once, and opening it again applies none', () => {
        const file = path.join(dir, 'store.db');
        const first = openStore(file);
        expect(Number((first.prepare('PRAGMA user_version').get() as {user_version: number}).user_version)).toBe(migrations().length);
        first.close();
        const again = openStore(file);
        expect(again.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'`).get()).toMatchObject({n: 7});
        again.close();
    });

    test("it holds Postgres's constraints", () => {
        const db = openStore(path.join(dir, 'store.db'));
        fixtures(db);
        expect(() => db.exec(sighting('a').replace('SSA:0000900', 'SSA:900'))).toThrow(/CHECK/);
        expect(() => db.exec(sighting('b', '0'))).toThrow(/CHECK/);
        expect(() => db.exec(`INSERT INTO feedback (created_at, name, message) VALUES ('now', '', 'hi')`)).toThrow(/CHECK/);
        expect(() => db.exec(`INSERT INTO identifications (occurrence_id, individual_id, social_group_id, method, created_at)
                              VALUES ('o', 1, 2, 'manual', 'now')`)).toThrow(/CHECK/);
        expect(() => db.exec(sighting('c').replace("'u1'", "'nobody'"))).toThrow(/FOREIGN KEY/);
        db.close();
    });

    test('removing a contributor is refused while anything names them', () => {
        const db = openStore(path.join(dir, 'store.db'));
        fixtures(db);
        db.exec(sighting('s'));
        expect(() => db.exec('DELETE FROM contributors WHERE id = 1')).toThrow(/FOREIGN KEY/);
        expect(db.prepare('SELECT count(*) AS n FROM observations').get()).toMatchObject({n: 1});
        db.close();
    });

    test("deleting a sighting deletes its photos, as Postgres's cascade did", () => {
        const db = openStore(path.join(dir, 'store.db'));
        fixtures(db);
        db.exec(sighting('s'));
        db.exec(`INSERT INTO observation_photos (observation_id, seq, href, license_code) VALUES ('s', 0, 'x', 'cc-by')`);
        db.exec(`DELETE FROM observations WHERE id = 's'`);
        expect(db.prepare('SELECT count(*) AS n FROM observation_photos').get()).toMatchObject({n: 0});
        db.close();
    });

    test('a coordinate crosses as its exact eight bytes, not as fifteen printed digits', () => {
        const lon = -123.12345678901234;
        const hex = Buffer.alloc(8);
        hex.writeDoubleBE(lon, 0);
        expect(exactDouble(hex.toString('hex'))).toBe(lon);
        expect(exactDouble(null)).toBeNull();
        expect(() => exactDouble('-123.1')).toThrow(/not a float8/);
    });

    test("an ORCID is checked as is_valid_orcid checked it: shape, then ISO 7064 MOD 11-2", () => {
        expect(validOrcid('https://orcid.org/0000-0002-1825-0097')).toBe(true);
        expect(validOrcid('https://orcid.org/0000-0002-1694-233X')).toBe(true);
        expect(validOrcid('https://orcid.org/0000-0002-1825-0098')).toBe(false);
        expect(validOrcid('0000-0002-1825-0097')).toBe(false);
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

describe.skipIf(!DSN)('the copy from Postgres (local Supabase)', () => {
    test('a sighting whose owner has no Google sign-in is named, and the copy refused', async () => {
        const sql = postgres(DSN!, {max: 1});
        try {
            await sql.begin(async tx => {
                // as the local database ships: its seeded user has a sighting and no identity
                await tx`DELETE FROM auth.identities`;
                const store = openStore(path.join(dir, 'store.db'));
                await expect(copyFromPostgres(store, directQuery(tx))).rejects.toThrow(/no Google sign-in/);
                expect(store.prepare('SELECT count(*) AS n FROM observations').get()).toMatchObject({n: 0});
                store.close();
                throw new RolledBack();
            }).catch(e => { if (!(e instanceof RolledBack)) throw e; });
        } finally {
            await sql.end();
        }
    });

    test('every table arrives, and a second copy into the same store is refused', async () => {
        const sql = postgres(DSN!, {max: 1});
        try {
            await sql.begin(async tx => {
                // the local database's seeded user signs in with Google, and writes more
                const [{id: user}] = await tx`SELECT user_uuid::text AS id FROM public.user_contributor LIMIT 1` as [{id: string}];
                await tx`INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
                         VALUES ('google-sub-1', ${user}::uuid, '{}'::jsonb, 'google', now(), now())`;
                await tx`INSERT INTO public.feedback (name, message, user_uuid) VALUES ('A reader', 'hello', ${user}::uuid)`;
                const store = openStore(path.join(dir, 'store.db'));
                const counts = await copyFromPostgres(store, directQuery(tx));
                const [{n: observations}] = await tx`SELECT count(*)::int AS n FROM public.observations` as [{n: number}];
                expect(counts['observations']).toBe(observations);
                expect(counts['users']).toBe(1);
                expect(counts['feedback']).toBe(1);
                expect(store.prepare('SELECT google_sub FROM users').get()).toMatchObject({google_sub: 'google-sub-1'});
                await expect(copyFromPostgres(store, directQuery(tx))).rejects.toThrow(/empty store/);
                store.close();
                throw new RolledBack();
            }).catch(e => { if (!(e instanceof RolledBack)) throw e; });
        } finally {
            await sql.end();
        }
    });
});

class RolledBack extends Error {}
