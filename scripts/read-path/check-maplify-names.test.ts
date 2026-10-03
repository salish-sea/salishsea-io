/**
 * The guard against a register edition un-naming Maplify sightings (salish-xv35.9): what
 * Postgres named, the build's own rule must still name.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { unnamedPairs } from './check-maplify-names.ts';

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'check-maplify-names-'));
});

afterAll(async () => {
    await rm(dir, {recursive: true, force: true});
});

/** The build's Maplify mirror, holding these (name, scientific name) pairs. */
function mirror(file: string, pairs: [name: string | null, scientific: string][]): string {
    const target = path.join(dir, file);
    const db = new DatabaseSync(target);
    db.exec('CREATE TABLE sightings (name TEXT, scientific_name TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO sightings VALUES (?, ?)');
    for (const [name, scientific] of pairs) insert.run(name, scientific);
    db.close();
    return target;
}

/** A snapshot whose register has these entities, and Postgres's Maplify sightings. */
async function snapshot(
    file: string,
    entities: [id: string, label: string][],
    sightings: [name: string | null, scientific: string, entity: string | null][],
): Promise<string> {
    const target = path.join(dir, file);
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH '${target}' AS s`);
    await conn.run(`
        CREATE SCHEMA s.register; CREATE SCHEMA s.maplify;
        CREATE TABLE s.register.entities (entity_id VARCHAR, kind VARCHAR, label VARCHAR);
        CREATE TABLE s.register.names (entity_id VARCHAR, name VARCHAR, type VARCHAR, language VARCHAR);
        CREATE TABLE s.register.ancestor (entity_id VARCHAR, ancestor_id VARCHAR, depth INTEGER, ancestor_kind VARCHAR);
        CREATE TABLE s.register.deprecations (entity_id VARCHAR, replaced_by VARCHAR);
        CREATE TABLE s.maplify.sightings (name VARCHAR, scientific_name VARCHAR, entity_id VARCHAR)`);
    for (const [id, label] of entities)
        await conn.run(`INSERT INTO s.register.entities VALUES ('${id}', 'taxon', '${label}')`);
    for (const [name, scientific, entity] of sightings)
        await conn.run(`INSERT INTO s.maplify.sightings VALUES (${name === null ? 'NULL' : `'${name}'`}, '${scientific}', ${entity === null ? 'NULL' : `'${entity}'`})`);
    await conn.run('DETACH s');
    conn.closeSync();
    return target;
}

test('every pair Postgres named still resolves: nothing to report', async () => {
    const file = await snapshot('named.duckdb',
        [['SSA:1', 'Orcinus orca'], ['SSA:2', 'Balaenoptera borealis']],
        [['Orca', 'Orcinus orca', 'SSA:1'], ['Sei Whale', 'Balaenoptera borealis', 'SSA:2']]);
    const m = mirror('named.sqlite', [['Orca', 'Orcinus orca'], ['Sei Whale', 'Balaenoptera borealis']]);
    expect(await unnamedPairs(file, m)).toEqual([]);
});

test('a pair Postgres named that the register no longer names is reported, with its sightings', async () => {
    const file = await snapshot('unnamed.duckdb',
        [['SSA:1', 'Orcinus orca']],
        [['Orca', 'Orcinus orca', 'SSA:1'],
         ['Sei Whale', 'Balaenoptera borealis', 'SSA:2'], ['Sei Whale', 'Balaenoptera borealis', 'SSA:2']]);
    const m = mirror('unnamed.sqlite', [['Orca', 'Orcinus orca'], ['Sei Whale', 'Balaenoptera borealis']]);
    expect(await unnamedPairs(file, m)).toEqual([
        {name: 'Sei Whale', scientific_name: 'Balaenoptera borealis', was: 'SSA:2', sightings: 2},
    ]);
});

test('a pair Postgres never named is not the guard\'s business', async () => {
    const file = await snapshot('never.duckdb',
        [['SSA:1', 'Orcinus orca']],
        [['Something', 'Unknown thing', null]]);
    const m = mirror('never.sqlite', [['Something', 'Unknown thing']]);
    expect(await unnamedPairs(file, m)).toEqual([]);
});

test('a pair only Postgres still holds can\'t be lost from the map, so it doesn\'t count', async () => {
    const file = await snapshot('gone.duckdb',
        [['SSA:1', 'Orcinus orca']],
        [['Orca', 'Orcinus orca', 'SSA:1'], ['Sei Whale', 'Balaenoptera borealis', 'SSA:2']]);
    const m = mirror('gone.sqlite', [['Orca', 'Orcinus orca']]);
    expect(await unnamedPairs(file, m)).toEqual([]);
});

test('a pair with no common name matches its mirror row by its scientific name alone', async () => {
    const file = await snapshot('nameless.duckdb',
        [['SSA:1', 'Orcinus orca']],
        [[null, 'Balaenoptera borealis', 'SSA:2']]);
    const m = mirror('nameless.sqlite', [[null, 'Balaenoptera borealis']]);
    expect(await unnamedPairs(file, m)).toEqual([
        {name: null, scientific_name: 'Balaenoptera borealis', was: 'SSA:2', sightings: 1},
    ]);
});
