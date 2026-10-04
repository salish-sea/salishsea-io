/**
 * The guard against a register edition un-naming Maplify sightings (salish-xv35.9): what
 * the last passing build named (at first, what Postgres's ingest named), the register
 * must still name.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { baselineFile, checkNames, judge } from './check-maplify-names.ts';

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
    mkdirSync(path.dirname(target), {recursive: true});
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

describe('judge', () => {
    const named = (name: string | null, sci: string, entity: string) => ({name, scientific_name: sci, entity_id: entity});
    const pair = (name: string | null, sci: string, entity: string | null, sightings = 1) =>
        ({name, scientific_name: sci, entity_id: entity, sightings});

    test('a named pair that now resolves to nothing is reported, with its sightings', () => {
        expect(judge([named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')],
                     [pair('Sei Whale', 'Balaenoptera borealis', null, 4)]).unnamed)
            .toEqual([{name: 'Sei Whale', scientific_name: 'Balaenoptera borealis', was: 'SSA:2', sightings: 4}]);
    });

    test('moving to another entity is a register edit doing its job', () => {
        expect(judge([named('Orca', 'Orcinus orca', 'SSA:1')], [pair('Orca', 'Orcinus orca', 'SSA:9')]).unnamed).toEqual([]);
    });

    test('a pair the mirror no longer holds has no sighting to lose, and stays in the baseline', () => {
        const {unnamed, next} = judge([named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')], []);
        expect(unnamed).toEqual([]);
        expect(next).toEqual([named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')]);
    });

    test('so a pair that leaves and comes back unnamed is still caught', () => {
        const {next} = judge([named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')], [pair('Orca', 'Orcinus orca', 'SSA:1')]);
        expect(judge(next, [pair('Sei Whale', 'Balaenoptera borealis', null)]).unnamed.map(u => u.was)).toEqual(['SSA:2']);
    });

    test('a pair never named is not the guard\'s business, and is not in the next baseline', () => {
        const {unnamed, next} = judge([], [pair('Something', 'Unknown', null), pair('Orca', 'Orcinus orca', 'SSA:1')]);
        expect(unnamed).toEqual([]);
        expect(next).toEqual([named('Orca', 'Orcinus orca', 'SSA:1')]);
    });

    test('a pair with no common name is told apart from one whose name is the string "null"', () => {
        expect(judge([named(null, 'Balaenoptera borealis', 'SSA:2')],
                     [pair('null', 'Balaenoptera borealis', null), pair(null, 'Balaenoptera borealis', 'SSA:2')]).unnamed)
            .toEqual([]);
    });
});

describe('checkNames', () => {
    test('with no baseline, Postgres\'s answer stands in; a pass writes the build\'s own', async () => {
        const file = await snapshot('bootstrap.duckdb',
            [['SSA:1', 'Orcinus orca'], ['SSA:2', 'Balaenoptera borealis']],
            [['Orca', 'Orcinus orca', 'SSA:1']]);
        const m = mirror('bootstrap/maplify.sqlite', [['Orca', 'Orcinus orca'], ['Sei Whale', 'Balaenoptera borealis']]);
        expect(existsSync(baselineFile(m))).toBe(false);
        expect(await checkNames(file, m)).toEqual([]);
        expect(JSON.parse(readFileSync(baselineFile(m), 'utf8')).pairs.map((p: {entity_id: string}) => p.entity_id).sort())
            .toEqual(['SSA:1', 'SSA:2']);
    });

    test('Postgres\'s answer counts before the first pass: what it named must still resolve', async () => {
        const file = await snapshot('bootstrap-fail.duckdb',
            [['SSA:1', 'Orcinus orca']],
            [['Sei Whale', 'Balaenoptera borealis', 'SSA:2']]);
        const m = mirror('bootstrap-fail/maplify.sqlite', [['Sei Whale', 'Balaenoptera borealis']]);
        expect(await checkNames(file, m)).toEqual([
            {name: 'Sei Whale', scientific_name: 'Balaenoptera borealis', was: 'SSA:2', sightings: 1},
        ]);
        expect(existsSync(baselineFile(m))).toBe(false);
    });

    test('once there is a baseline it is what counts, and a failure leaves it as it was', async () => {
        // Postgres named nothing; the last build named the Sei whale; this register doesn't.
        const file = await snapshot('baseline.duckdb', [['SSA:1', 'Orcinus orca']], []);
        const m = mirror('baseline/maplify.sqlite', [['Sei Whale', 'Balaenoptera borealis']]);
        const before = `${JSON.stringify({pairs: [{name: 'Sei Whale', scientific_name: 'Balaenoptera borealis', entity_id: 'SSA:2'}]})}\n`;
        writeFileSync(baselineFile(m), before);
        expect((await checkNames(file, m)).map(u => u.was)).toEqual(['SSA:2']);
        expect(readFileSync(baselineFile(m), 'utf8')).toBe(before);
    });
});
