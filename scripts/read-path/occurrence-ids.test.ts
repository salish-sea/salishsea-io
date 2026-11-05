/**
 * Every id lands in the shard the browser will look in, with the day the
 * frontend puts it on.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { idShard } from '../../src/read-path-shard.ts';
import { writeIds } from './occurrence-ids.ts';

const ROWS = [
    {id: 'maplify:whale_alert:1', observed_at: '2025-03-09T20:00:00Z', day: '2025-03-09'},
    // 228809 is used by two sources (decision 112), so it has no alias; 228810 by one
    {id: 'maplify:whale_alert:228809', observed_at: '2025-07-14T19:07:00Z', day: '2025-07-14'},
    {id: 'maplify:wras:228809', observed_at: '2026-03-25T17:00:00Z', day: '2026-03-25'},
    {id: 'maplify:wras:228810', observed_at: '2026-03-25T18:00:00Z', day: '2026-03-25'},
    // 23:30 Pacific on March 8: the 8th, though UTC says the 9th.
    {id: 'inaturalist:2', observed_at: '2025-03-09T07:30:00Z', day: '2025-03-08'},
    {id: '0192f0c4-0000-7000-8000-000000000003', observed_at: '2025-11-02T07:00:00Z', day: '2025-11-02'},
];

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'read-path-ids-'));
    const snapshot = path.join(dir, 'snapshot.duckdb');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await conn.run('CREATE SCHEMA store.build');
    await conn.run('CREATE TABLE store.build.occurrences (id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR)');
    for (const {id, observed_at} of ROWS)
        await conn.run(`INSERT INTO store.build.occurrences VALUES ('${id}', '${observed_at}', '{}')`);
    await conn.run(`INSERT INTO store.build.occurrences VALUES ('happywhale:undated', NULL, '{}')`);
    await conn.run('DETACH store');
    conn.closeSync();
    await writeIds(snapshot, dir);
});

describe('writeIds', () => {
    test.each(ROWS)('$id is in its shard with its Pacific day', async ({id, day}) => {
        const shard = JSON.parse(await readFile(path.join(dir, 'ids', `${idShard(id)}.json`), 'utf8'));
        expect(shard[id]).toBe(day);
    });

    const aliasOf = async (old: string): Promise<string | undefined> => {
        const shard = JSON.parse(await readFile(path.join(dir, 'aliases', `${idShard(old)}.json`), 'utf8').catch(() => '{}'));
        return Object.hasOwn(shard, old) ? shard[old] : undefined;
    };

    test('a number one source uses has an alias, in the shard of the old id', async () => {
        expect(await aliasOf('maplify:1')).toBe('maplify:whale_alert:1');
        expect(await aliasOf('maplify:228810')).toBe('maplify:wras:228810');
    });

    test('a number two sources use has none', async () => {
        expect(await aliasOf('maplify:228809')).toBeUndefined();
    });

    test('only Maplify ids have aliases, and the id index itself holds no old-form id', async () => {
        expect(await aliasOf('inaturalist:2')).toBeUndefined();
        const shard = JSON.parse(await readFile(path.join(dir, 'ids', `${idShard('maplify:1')}.json`), 'utf8').catch(() => '{}'));
        expect(Object.hasOwn(shard, 'maplify:1')).toBe(false);
    });

    test('an undated occurrence is left out, not indexed under a day of null', async () => {
        const shard = JSON.parse(await readFile(path.join(dir, 'ids', `${idShard('happywhale:undated')}.json`), 'utf8').catch(() => '{}'));
        expect(Object.hasOwn(shard, 'happywhale:undated')).toBe(false);
    });
});

