import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { latestTag, REGISTER_TABLES, retire } from './ingest-register.ts';
import { attachRegister, registerFile } from './register-file.ts';

describe('latestTag (decision 064)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    const answering = (status: number, location: string | null) =>
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status, headers: location ? {location} : {}})));

    test('the tag releases/latest redirects to', async () => {
        answering(302, 'https://github.com/salish-sea/animals/releases/tag/2026.09.6');
        await expect(latestTag()).resolves.toBe('2026.09.6');
    });

    test('an answer that names no release is an error, never a guess', async () => {
        answering(200, null);
        await expect(latestTag()).rejects.toThrow(/without a release tag/);
        answering(302, 'https://github.com/salish-sea/animals/releases');
        await expect(latestTag()).rejects.toThrow(/without a release tag/);
    });
});

describe('REGISTER_TABLES', () => {
    test('the tables the derivations read, depth typed as Postgres types it', () => {
        expect(REGISTER_TABLES.map(t => t.table)).toEqual(
            ['entities', 'names', 'mappings', 'ancestor', 'deprecations', 'classification', 'vitals', 'current_status',
                'taxon_ancestor', 'group_ranks', 'parentage', 'matriarchs']);
        expect(REGISTER_TABLES.find(t => t.table === 'vitals')!.file).toBe('entities');
        expect(REGISTER_TABLES.find(t => t.table === 'ancestor')!.select).toContain('CAST(depth AS INTEGER)');
    });
});

describe('latestTag classifies what fails (decision 042)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    test('no connection, or GitHub erroring, is transient: a source outage, not our build stopping', async () => {
        const { isTransientUpstream } = await import('../ingest/retry.ts');
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
        await expect(latestTag().catch(e => isTransientUpstream(e))).resolves.toBe(true);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status: 503})));
        await expect(latestTag().catch(e => isTransientUpstream(e))).resolves.toBe(true);
    });

    test('an answer GitHub meant, that names no release, is a defect', async () => {
        const { isTransientUpstream } = await import('../ingest/retry.ts');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status: 200})));
        await expect(latestTag().catch(e => isTransientUpstream(e))).resolves.toBe(false);
    });
});

describe('retire: the register leaves the snapshot for a file of its own (salish-vedj)', () => {
    /** What `sql` answers, with `snapshot` attached as `store` and its register file, if any, as `register`. */
    async function ask(snapshot: string, sql: string): Promise<unknown[][]> {
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        try {
            await conn.run(`ATTACH '${snapshot}' AS store (READ_ONLY)`);
            if (existsSync(registerFile(snapshot))) await attachRegister(conn, registerFile(snapshot));
            return (await conn.runAndReadAll(sql)).getRows();
        } finally {
            conn.closeSync();
        }
    }

    async function snapshotHolding(tag: string): Promise<string> {
        const snapshot = path.join(await mkdtemp(path.join(tmpdir(), 'register-retire-')), 'snapshot.duckdb');
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        await conn.run(`ATTACH '${snapshot}' AS store`);
        await conn.run('CREATE SCHEMA store.register; CREATE SCHEMA store.build');
        await conn.run("CREATE TABLE store.register.entities AS SELECT 'SSA:0000001' AS entity_id, 'taxon' AS kind");
        await conn.run(`CREATE TABLE store.register.edition AS SELECT '${tag}' AS tag, 'abc' AS sha256`);
        await conn.run('CREATE TABLE store.build.occurrences AS SELECT 1 AS id');
        conn.closeSync();
        return snapshot;
    }

    const tablesIn = (snapshot: string, schema: string) => ask(snapshot,
        `SELECT table_name FROM information_schema.tables WHERE table_catalog = 'store' AND table_schema = '${schema}'`);

    test("the snapshot's register moves into the file, and only the register leaves the snapshot", async () => {
        const snapshot = await snapshotHolding('2026.10.1');
        const said: string[] = [];
        await retire(snapshot, registerFile(snapshot), m => said.push(m));
        expect(await ask(snapshot, 'SELECT tag FROM register.edition')).toEqual([['2026.10.1']]);
        expect(await ask(snapshot, 'SELECT entity_id FROM register.entities')).toEqual([['SSA:0000001']]);
        expect(await tablesIn(snapshot, 'register')).toEqual([]);
        expect(await tablesIn(snapshot, 'build')).toEqual([['occurrences']]);
        expect(said).toEqual([expect.stringMatching(/moved 2 table/), 'register: dropped from the snapshot']);
        expect(existsSync(`${registerFile(snapshot)}.new`)).toBe(false);
    });

    test('a register file already there is kept, and the stale copy only dropped', async () => {
        const snapshot = await snapshotHolding('2026.10.1');
        await retire(snapshot, registerFile(snapshot), () => {});
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        await conn.run(`ATTACH '${snapshot}' AS store`);
        await conn.run('CREATE SCHEMA store.register');
        await conn.run("CREATE TABLE store.register.edition AS SELECT '2025.01.1' AS tag, 'old' AS sha256");
        conn.closeSync();
        const said: string[] = [];
        await retire(snapshot, registerFile(snapshot), m => said.push(m));
        expect(await ask(snapshot, 'SELECT tag FROM register.edition')).toEqual([['2026.10.1']]);
        expect(await tablesIn(snapshot, 'register')).toEqual([]);
        expect(said).toEqual(['register: dropped from the snapshot']);
    });

    test('nothing to move: nothing done, nothing said', async () => {
        const snapshot = await snapshotHolding('2026.10.1');
        await retire(snapshot, registerFile(snapshot), () => {});
        const said: string[] = [];
        await retire(snapshot, registerFile(snapshot), m => said.push(m));
        await retire(path.join(path.dirname(snapshot), 'absent.duckdb'), registerFile(snapshot), m => said.push(m));
        expect(said).toEqual([]);
    });
});
