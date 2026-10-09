import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

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
});
