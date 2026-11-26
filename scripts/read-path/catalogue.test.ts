import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { describe, expect, test } from 'vitest';

import { CATALOGUE, CATALOGUE_DIR, documents, fileColumns, generatedRows, jsonbOrdered, loadCatalogue, registerVitals } from './catalogue.ts';
import { loadReference, readTsv } from './reference.ts';
import { registerFile } from './register-file.ts';

/**
 * The register tables the catalogue reads, in the database attached as `register`, holding `rows`: a small
 * Southern Resident community by default. Each entity is [id, kind, rank, label].
 */
async function registerFixture(conn: DuckDBConnection, {
    entities = [] as [string, string, string | null, string][],
    ancestor = [] as [string, string][],
    parentage = [] as [string, string][],
    matriarchs = [] as [string, string][],
    deprecated = [] as string[],
} = {}): Promise<void> {
    const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replaceAll("'", "''")}'`);
    const fill = async (table: string, columns: string, rows: (string | null)[][]) => {
        await conn.run(`CREATE TABLE register.${table} (${columns})`);
        if (rows.length) await conn.run(`INSERT INTO register.${table} VALUES ${rows.map(r => `(${r.map(q).join(', ')})`).join(', ')}`);
    };
    await fill('entities', 'entity_id VARCHAR, kind VARCHAR, label VARCHAR', entities.map(([id, kind, , label]) => [id, kind, label]));
    await fill('group_ranks', 'entity_id VARCHAR, rank VARCHAR', entities.map(([id, , rank]) => [id, rank]));
    await fill('ancestor', 'entity_id VARCHAR, ancestor_id VARCHAR', ancestor);
    await fill('parentage', 'child_id VARCHAR, parent_id VARCHAR, role VARCHAR', parentage.map(([c, p]) => [c, p, 'mother']));
    await fill('matriarchs', 'matriline_id VARCHAR, matriarch_id VARCHAR', matriarchs);
    await fill('deprecations', 'entity_id VARCHAR, replaced_by VARCHAR', deprecated.map(id => [id, null]));
    // What the catalogue takes each animal's vitals from: every animal alive, with nothing else known.
    const animals = entities.filter(([, kind]) => kind === 'individual').map(([id]) => id);
    await fill('vitals', 'entity_id VARCHAR, sex VARCHAR, born VARCHAR', animals.map(id => [id, null, null]));
    await fill('current_status', 'entity_id VARCHAR, status VARCHAR', animals.map(id => [id, 'alive']));
    await fill('status_dates', 'entity_id VARCHAR, effective VARCHAR', []);
}

type Fixture = Parameters<typeof registerFixture>[1];
const together = (...parts: Required<NonNullable<Fixture>>[]): Required<NonNullable<Fixture>> => ({
    entities: parts.flatMap(p => p.entities), ancestor: parts.flatMap(p => p.ancestor),
    parentage: parts.flatMap(p => p.parentage), matriarchs: parts.flatMap(p => p.matriarchs),
    deprecated: parts.flatMap(p => p.deprecated),
});

/** J pod's J31s, as edition 2026.10.1 has them, and a deprecated stray and a Bigg's whale that are not generated. */
const SOUTHERN_RESIDENTS = {
    entities: [
        ['SSA:0000010', 'group', 'community', 'Southern Resident'],
        ['SSA:0000020', 'group', 'pod', 'J pod'],
        ['SSA:0000030', 'group', 'clan', 'J clan'],
        ['SSA:0003011', 'group', 'matriline', 'J31s'],
        ['SSA:0020005', 'individual', null, 'J11'],
        ['SSA:0020030', 'individual', null, 'J31'],
        ['SSA:0020099', 'individual', null, 'J99'],
        ['SSA:0010193', 'individual', null, 'T065A'],
    ] as [string, string, string | null, string][],
    ancestor: [
        ['SSA:0000020', 'SSA:0000010'], ['SSA:0000030', 'SSA:0000010'], ['SSA:0003011', 'SSA:0000010'],
        ['SSA:0020005', 'SSA:0000010'], ['SSA:0020030', 'SSA:0000010'], ['SSA:0020099', 'SSA:0000010'],
        ['SSA:0020005', 'SSA:0003011'], ['SSA:0020030', 'SSA:0003011'],
    ] as [string, string][],
    parentage: [['SSA:0020030', 'SSA:0020005'], ['SSA:0020099', 'SSA:0020030']] as [string, string][],
    matriarchs: [['SSA:0003011', 'SSA:0020030']] as [string, string][],
    deprecated: ['SSA:0020099'],
};

describe("the Southern Residents' rows are generated from the register (decision 070)", () => {
    test('each animal, its primary designation and its mother; the community, pods and matrilines, without clans', async () => {
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        try {
            await conn.run(`ATTACH ':memory:' AS store`);
            await conn.run(`ATTACH ':memory:' AS register`);
            await registerFixture(conn, SOUTHERN_RESIDENTS);
            await generatedRows(conn);
            const rows = async (view: string) => (await conn.runAndReadAll(`SELECT * FROM ${view} ORDER BY id`)).getRowObjectsJS();
            expect(await rows('gen_individuals')).toEqual([
                {id: 10020005, entity_id: 'SSA:0020005', primary_designation: 'J11', mother_id: null,
                    maternity_certainty: 'presumed', father_id: null, paternity_certainty: null},
                {id: 10020030, entity_id: 'SSA:0020030', primary_designation: 'J31', mother_id: 10020005,
                    maternity_certainty: 'presumed', father_id: null, paternity_certainty: null},
            ]);
            expect((await rows('gen_designations')).map(d => [d['individual_id'], d['code'], d['is_primary']]))
                .toEqual([[10020005, 'J11', true], [10020030, 'J31', true]]);
            expect((await rows('gen_social_groups')).map(g => [g['id'], g['kind'], g['designation'], g['anchor_individual_id']]))
                .toEqual([
                    [10000010, 'community', 'Southern Resident', null],
                    [10000020, 'pod', 'J', null],
                    [10003011, 'matriline', 'J31', 10020030],
                ]);
        } finally {
            conn.closeSync();
        }
    });
});

/**
 * A small Bigg's ecotype with each case decision 123 decides:
 *   T100s: three whales, kept; T190s: a line of one, dropped; T200s: two whales and no matriarch, kept;
 *   T300s: the same two whales as its sub-line T300As, dropped, the sub-line kept; T400s: one whale
 *   whose recorded calf sits outside it, kept; T500s: one whale and a deprecated one, dropped.
 */
const BIGGS = {
    entities: [
        ['SSA:0000002', 'group', 'ecotype', "Bigg's"],
        ['SSA:0001001', 'group', 'matriline', 'T100s'],
        ['SSA:0001002', 'group', 'matriline', 'T190s'],
        ['SSA:0001003', 'group', 'matriline', 'T200s'],
        ['SSA:0001004', 'group', 'matriline', 'T300s'],
        ['SSA:0001005', 'group', 'matriline', 'T300As'],
        ['SSA:0001006', 'group', 'matriline', 'T400s'],
        ['SSA:0001007', 'group', 'matriline', 'T500s'],
        ['SSA:0011000', 'individual', null, 'T100'],
        ['SSA:0011001', 'individual', null, 'T100A'],
        ['SSA:0011002', 'individual', null, 'T100B'],
        ['SSA:0011900', 'individual', null, 'T190'],
        ['SSA:0012001', 'individual', null, 'T200A'],
        ['SSA:0012002', 'individual', null, 'T200B'],
        ['SSA:0013001', 'individual', null, 'T300A1'],
        ['SSA:0013002', 'individual', null, 'T300A2'],
        ['SSA:0014000', 'individual', null, 'T400'],
        ['SSA:0014001', 'individual', null, 'T401'],
        ['SSA:0015001', 'individual', null, 'T500A'],
        ['SSA:0015002', 'individual', null, 'T500B'],
    ] as [string, string, string | null, string][],
    ancestor: [
        ...['SSA:0001001', 'SSA:0001002', 'SSA:0001003', 'SSA:0001004', 'SSA:0001005', 'SSA:0001006', 'SSA:0001007']
            .map(line => [line, 'SSA:0000002']),
        ['SSA:0001005', 'SSA:0001004'],
        ...['SSA:0011000', 'SSA:0011001', 'SSA:0011002'].flatMap(w => [[w, 'SSA:0001001'], [w, 'SSA:0000002']]),
        ['SSA:0011900', 'SSA:0001002'], ['SSA:0011900', 'SSA:0000002'],
        ...['SSA:0012001', 'SSA:0012002'].flatMap(w => [[w, 'SSA:0001003'], [w, 'SSA:0000002']]),
        ...['SSA:0013001', 'SSA:0013002'].flatMap(w => [[w, 'SSA:0001005'], [w, 'SSA:0001004'], [w, 'SSA:0000002']]),
        ['SSA:0014000', 'SSA:0001006'], ['SSA:0014000', 'SSA:0000002'], ['SSA:0014001', 'SSA:0000002'],
        ...['SSA:0015001', 'SSA:0015002'].flatMap(w => [[w, 'SSA:0001007'], [w, 'SSA:0000002']]),
    ] as [string, string][],
    parentage: [
        ['SSA:0011001', 'SSA:0011000'], ['SSA:0011002', 'SSA:0011000'], ['SSA:0014001', 'SSA:0014000'],
    ] as [string, string][],
    matriarchs: [
        ['SSA:0001001', 'SSA:0011000'], ['SSA:0001006', 'SSA:0014000'],
    ] as [string, string][],
    deprecated: ['SSA:0015002'],
};

async function inMemoryRegister(fixture: Fixture): Promise<DuckDBConnection> {
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH ':memory:' AS store`);
    await conn.run(`ATTACH ':memory:' AS register`);
    await registerFixture(conn, fixture);
    return conn;
}

describe("the Bigg's rows are generated from the register too (decision 123)", () => {
    test('a matriline needs two animals by descent, or a matriarch with a recorded calf, and is not a copy of a line inside it', async () => {
        const conn = await inMemoryRegister(BIGGS);
        try {
            await generatedRows(conn);
            const rows = async (view: string) => (await conn.runAndReadAll(`SELECT * FROM ${view} ORDER BY id`)).getRowObjectsJS();
            const groups = (await rows('gen_social_groups')).map(g => [g['entity_id'], g['kind'], g['designation'], g['anchor_individual_id']]);
            expect(groups).toEqual([
                ['SSA:0000002', 'ecotype', "Bigg's", null],
                ['SSA:0001001', 'matriline', 'T100', 10011000],
                ['SSA:0001003', 'matriline', 'T200', null],
                ['SSA:0001005', 'matriline', 'T300A', null],
                ['SSA:0001006', 'matriline', 'T400', 10014000],
            ]);
            const animals = (await rows('gen_individuals')).map(i => i['primary_designation']);
            expect(animals).toEqual(['T100', 'T100A', 'T100B', 'T190', 'T200A', 'T200B', 'T300A1', 'T300A2', 'T400', 'T401', 'T500A']);
            expect((await rows('gen_individuals')).filter(i => i['mother_id'] !== null).map(i => [i['primary_designation'], i['mother_id']]))
                .toEqual([['T100A', 10011000], ['T100B', 10011000], ['T401', 10014000]]);
        } finally {
            conn.closeSync();
        }
    });

    // As views, every constraint check expanded the whole matriline rule again and the task ran out of
    // its 64 MB on the real register (review of decision 123). Only the real register reproduced the
    // failure; synthetic data of its size merely made the views slow. So this test pins the cause (the
    // generated rows are tables) rather than measuring the budget, and the size test below only smokes it.
    test("a matriline whose matriarch the register deprecated has no row for her calf's sake", async () => {
        const conn = await inMemoryRegister({...BIGGS, deprecated: [...BIGGS.deprecated, 'SSA:0014000']});
        try {
            await generatedRows(conn);
            const lines = (await conn.runAndReadAll(`SELECT designation FROM gen_social_groups WHERE kind = 'matriline' ORDER BY id`)).getRows().map(r => r[0]);
            expect(lines).toEqual(['T100', 'T200', 'T300A']);
        } finally {
            conn.closeSync();
        }
    });

    test('the generated rows are tables, computed once', async () => {
        const conn = await inMemoryRegister(BIGGS);
        try {
            await generatedRows(conn);
            const tables = (await conn.runAndReadAll(`SELECT table_name FROM duckdb_tables() WHERE temporary ORDER BY table_name`)).getRows().map(r => r[0]);
            expect(tables).toEqual(['gen_designations', 'gen_individuals', 'gen_matriline_candidates', 'gen_matrilines', 'gen_members', 'gen_social_groups']);
        } finally {
            conn.closeSync();
        }
    });

    test('the two populations are generated together', async () => {
        const conn = await inMemoryRegister(together(SOUTHERN_RESIDENTS, BIGGS));
        try {
            await generatedRows(conn);
            const kinds = (await conn.runAndReadAll(`SELECT kind, count(*) FROM gen_social_groups GROUP BY kind ORDER BY kind`)).getRows();
            expect(kinds.map(([k, n]) => [k, Number(n)])).toEqual([['community', 1], ['ecotype', 1], ['matriline', 5], ['pod', 1]]);
        } finally {
            conn.closeSync();
        }
    });
});

/**
 * A Bigg's ecotype the size of the register's own: about 750 animals in 140 lines, 65 sub-lines
 * inside them, a mother for most animals, and the ancestry of each. The catalogue task has 64 MB.
 */
function productionSized(): NonNullable<Fixture> & Required<NonNullable<Fixture>> {
    const id = (prefix: number, n: number) => `SSA:${String(prefix * 10000 + n).padStart(7, '0')}`;
    const entities: [string, string, string | null, string][] = [['SSA:0000002', 'group', 'ecotype', "Bigg's"]];
    const ancestor: [string, string][] = [];
    const parentage: [string, string][] = [];
    const matriarchs: [string, string][] = [];
    let animals = 0;
    for (let line = 0; line < 140; line++) {
        const top = id(1, line);
        entities.push([top, 'group', 'matriline', `T${line + 100}s`]);
        ancestor.push([top, 'SSA:0000002']);
        const members: string[] = [];
        for (let k = 0; k < (line < 50 ? 6 : 5); k++) {
            const animal = id(2, animals++);
            members.push(animal);
            entities.push([animal, 'individual', null, `T${line + 100}${String.fromCharCode(65 + k)}`]);
            ancestor.push([animal, top], [animal, 'SSA:0000002']);
            if (k > 0) parentage.push([animal, members[0]!]);
        }
        matriarchs.push([top, members[0]!]);
        // sub-lines nested four deep, the way the register nests a family's branches
        if (line < 65) {
            let outer = top;
            const chain: string[] = [top];
            for (const [depth, take] of [[1, 4], [2, 3], [3, 2], [4, 1]] as const) {
                const sub = id(2 + depth, line);
                entities.push([sub, 'group', 'matriline', `T${line + 100}${'WXYZ'[depth - 1]}s`]);
                for (const above of new Set([outer, ...chain])) ancestor.push([sub, above]);
                ancestor.push([sub, 'SSA:0000002']);
                chain.push(sub);
                for (const animal of members.slice(1, 1 + take)) ancestor.push([animal, sub]);
                outer = sub;
            }
        }
    }
    return {entities, ancestor, parentage, matriarchs, deprecated: []};
}

/** A catalogue directory holding the files that are not generated: parties and haul-outs as checked in, and the given designations and nicknames. */
async function catalogueDir(parent: string, designations: string[][], nicknames: string[][]): Promise<string> {
    const dir = path.join(parent, 'catalogue');
    await mkdir(dir);
    for (const file of ['parties.tsv', 'haulouts.tsv']) await copyFile(path.join(CATALOGUE_DIR, file), path.join(dir, file));
    const tsv = (head: string, rows: string[][]) => [head, ...rows.map(r => r.join('\t'))].join('\n') + '\n';
    await writeFile(path.join(dir, 'designations.tsv'), tsv(fileColumns('designations').map(([c]) => c).join('\t'), designations));
    await writeFile(path.join(dir, 'nicknames.tsv'), tsv(fileColumns('nicknames').map(([c]) => c).join('\t'), nicknames));
    return dir;
}

/** Load the catalogue of a register holding `fixture` and `dir`'s files; the documents of each table, or the error. */
async function loadFixture(parent: string, fixture: Fixture, dir: string):
    Promise<{docs: Record<string, Record<string, unknown>[]>} | {error: string}> {
    const snapshot = path.join(parent, 'snapshot.duckdb');
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await loadReference(conn, 'store');
    await mkdir(path.dirname(registerFile(snapshot)), {recursive: true});
    await conn.run(`ATTACH '${registerFile(snapshot)}' AS register`);
    await registerFixture(conn, fixture);
    conn.closeSync();
    const error = await loadCatalogue(snapshot, dir).then(() => null, (e: Error) => e.message);
    if (error !== null) return {error};
    const read = await (await DuckDBInstance.create(snapshot)).connect();
    try {
        const docs: Record<string, Record<string, unknown>[]> = {};
        for (const table of Object.keys(CATALOGUE))
            docs[table] = (await read.runAndReadAll(`SELECT doc FROM "snapshot"."snapshot".${table}`)).getRows()
                .map(([doc]) => JSON.parse(String(doc)) as Record<string, unknown>);
        return {docs};
    } finally {
        read.closeSync();
    }
}

describe("the checked-in designations and nicknames are keyed by register identifier (decision 123)", () => {
    const withTempDir = async (run: (parent: string) => Promise<void>) => {
        const parent = await mkdtemp(path.join(tmpdir(), 'catalogue-'));
        try {
            await run(parent);
        } finally {
            await rm(parent, {recursive: true, force: true});
        }
    };

    test('other designations, flags on a primary one, and nicknames on an animal and on a matriline', () => withTempDir(async parent => {
        const dir = await catalogueDir(parent, [
            ['1', 'SSA:0011001', 'AB5', 'alaska', 'active', 'false', 'true', ''],
            ['2', 'SSA:0011001', 'T100Z', 'bc_wa', 'superseded', 'false', 'true', ''],
            ['', 'SSA:0011000', 'T100', 'bc_wa', 'uncertain', 'true', 'false', ''],
        ], [
            ['1', 'SSA:0011000', 'Moon', 'official', '1', '2001', ''],
            ['2', 'SSA:0001001', 'The Moons', 'provisional', '1', '', ''],
        ]);
        const loaded = await loadFixture(parent, together(SOUTHERN_RESIDENTS, BIGGS), dir);
        if ('error' in loaded) throw new Error(loaded.error);
        const {designations, nicknames, individuals, social_groups: groups} = loaded.docs;
        const id = (entity: string) => individuals!.find(i => i['entity_id'] === entity)!['id'];
        const of = (code: string) => designations!.find(d => d['code'] === code)!;
        // the override changes the generated primary's flags, and adds no second primary
        expect(designations!.filter(d => d['individual_id'] === id('SSA:0011000'))).toHaveLength(1);
        expect(of('T100')).toMatchObject({id: id('SSA:0011000'), is_primary: true, status: 'uncertain', in_catalog: false});
        expect(of('T100A')).toMatchObject({is_primary: true, status: 'active', in_catalog: true});
        expect(of('AB5')).toMatchObject({id: 1, individual_id: id('SSA:0011001'), scheme: 'alaska', is_primary: false, superseded_by: null});
        // a superseded code points at its animal's primary designation, whose id is the animal's
        expect(of('T100Z')).toMatchObject({id: 2, status: 'superseded', superseded_by: id('SSA:0011001')});
        expect(nicknames!.find(n => n['name'] === 'Moon')).toMatchObject({individual_id: id('SSA:0011000'), social_group_id: null, named_year: 2001});
        const line = groups!.find(g => g['entity_id'] === 'SSA:0001001')!['id'];
        expect(nicknames!.find(n => n['name'] === 'The Moons')).toMatchObject({individual_id: null, social_group_id: line, status: 'provisional'});
    }));

    test('a row naming no generated animal or group is refused, and named', () => withTempDir(async parent => {
        const dir = await catalogueDir(parent, [
            ['1', 'SSA:0019999', 'AB5', 'alaska', 'active', 'false', 'true', ''],
            ['', 'SSA:0019998', 'T999', 'bc_wa', 'uncertain', 'true', 'true', ''],
            // an override that gives T100 another code than the register's, and a row with no is_primary
            ['', 'SSA:0011000', 'T101', 'bc_wa', 'uncertain', 'true', 'true', ''],
            ['3', 'SSA:0011002', 'X1', 'alaska', 'active', '', 'true', ''],
        ], [
            // the T190s line has one animal and no row, so a nickname on it has nothing to attach to
            ['1', 'SSA:0001002', 'Lonely', 'official', '1', '', ''],
        ]);
        const loaded = await loadFixture(parent, together(SOUTHERN_RESIDENTS, BIGGS), dir);
        const error = 'error' in loaded ? loaded.error : '';
        expect(error).toMatch(/designations.tsv names an entity that is no generated animal \(entity_id\/code\): SSA:0019999\/AB5, SSA:0019998\/T999/);
        expect(error).toMatch(/gives a primary designation a code other than the register's \(entity_id\/code\/register's code\): SSA:0011000\/T101\/T100/);
        expect(error).toMatch(/designations.tsv leaves is_primary empty \(entity_id\/code\): SSA:0011002\/X1/);
        expect(error).toMatch(/nicknames.tsv names an entity that is no generated animal or group \(id\/entity_id\): 1\/SSA:0001002/);
    }));

    test('a register the size of the real one loads within the catalogue task\'s 64 MB', () => withTempDir(async parent => {
        const biggs = productionSized();
        // as many nicknames as the checked-in file holds, six of them on lines
        const named = biggs.entities.filter(([, kind]) => kind === 'individual').slice(0, 397).map(([entity]) => entity)
            .concat(biggs.entities.filter(([, kind, , label]) => kind === 'group' && /^T\d+s$/.test(label)).slice(0, 6).map(([entity]) => entity));
        const dir = await catalogueDir(parent, [], named.map((entity, i) => [String(i + 1), entity, `Name ${i + 1}`, 'official', '1', '', '']));
        const loaded = await loadFixture(parent, biggs, dir);
        if ('error' in loaded) throw new Error(loaded.error);
        expect(loaded.docs['individuals']).toHaveLength(750);
        expect(loaded.docs['social_groups']!.length).toBeGreaterThan(200);
        expect(loaded.docs['nicknames']).toHaveLength(403);
    }), 120_000);

    test('a relabelled whale that takes a checked-in code stops the load, though every row still resolves', () => withTempDir(async parent => {
        const dir = await catalogueDir(parent, [['1', 'SSA:0011001', 'T100Z', 'bc_wa', 'superseded', 'false', 'true', '']], []);
        const relabelled = {...BIGGS, entities: BIGGS.entities.map(e => e[0] === 'SSA:0011001' ? [e[0], e[1], e[2], 'T100Z'] as typeof e : e)};
        const loaded = await loadFixture(parent, together(SOUTHERN_RESIDENTS, relabelled), dir);
        expect('error' in loaded ? loaded.error : '').toMatch(/designations repeats \(code\)/);
    }));

    test("a register that records no mother for any of a generated population's animals is refused (guard)", () => withTempDir(async parent => {
        const dir = await catalogueDir(parent, [], []);
        const noBiggsMothers = together(SOUTHERN_RESIDENTS, {...BIGGS, parentage: []});
        const loaded = await loadFixture(parent, noBiggsMothers, dir);
        expect('error' in loaded ? loaded.error : '').toMatch(/records no mother for any animal of Bigg's \(SSA:0000002\)/);
    }));
});

describe('the catalogue as documents (decision 064)', () => {
    test("keys in jsonb's order: shorter first, then bytewise", () => {
        expect(Object.keys(jsonbOrdered({entity_id: 1, id: 2, kind: 3, code: 4, name: 5})))
            .toEqual(['id', 'code', 'kind', 'name', 'entity_id']);
    });

    test("a designation's folded code is the register's fold, as Postgres's generated column was", () => {
        const [doc] = documents('designations', [{id: 1, code: "T090", individual_id: 2}], new Map());
        expect(JSON.parse(doc!)).toEqual({id: 1, code: 'T090', code_folded: 't90', individual_id: 2});
        const [group] = documents('social_groups', [{id: 1, designation: null}], new Map());
        expect(JSON.parse(group!)['designation_folded']).toBeNull();
    });

    test('a haul-out site has a location and a list of species, as Postgres stored them', () => {
        const [doc] = documents('haulouts', [{id: 1, lat: 48.38217, lon: -124.59167, atlas_species: 'PV,ZC'}], new Map());
        expect(doc).toBe('{"id":1,"location":{"lat":48.38217,"lon":-124.59167},"atlas_species":["PV","ZC"]}');
    });

    test("an individual's vitals are the register's, and one with none to take is refused", () => {
        const vitals = new Map([[7, {sex: 'female', born_earliest: 1979, born_latest: 1979, life_status: 'alive'}]]);
        const [doc] = documents('individuals', [{id: 7, entity_id: 'SSA:0010000'}], vitals);
        expect(JSON.parse(doc!)).toMatchObject({id: 7, sex: 'female', life_status: 'alive'});
        expect(() => documents('individuals', [{id: 8, entity_id: 'SSA:0010001'}], vitals)).toThrow(/no register entity/);
    });

    test('every checked-in file reads with its declared types, and a table with no file is generated whole', async () => {
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        try {
            for (const [table, {file}] of Object.entries(CATALOGUE)) {
                if (file === null) continue;
                const n = (await conn.runAndReadAll(`SELECT count(*) FROM ${readTsv(path.join(CATALOGUE_DIR, file), fileColumns(table))}`)).getRows()[0]![0];
                expect(Number(n), table).toBeGreaterThan(0);
            }
            expect(Object.entries(CATALOGUE).filter(([, {file}]) => file === null).map(([table]) => table))
                .toEqual(['individuals', 'social_groups']);
        } finally {
            conn.closeSync();
        }
    });

    test('the checked-in designations and nicknames have well-formed register identifiers and unique keys, and their overrides have designation-shaped codes (not that the entities exist: ingest checks that)', async () => {
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        try {
            const rows = async (table: string) => (await conn.runAndReadAll(
                `SELECT * FROM ${readTsv(path.join(CATALOGUE_DIR, CATALOGUE[table]!.file!), fileColumns(table))}`)).getRowObjectsJS();
            const designations = await rows('designations');
            const nicknames = await rows('nicknames');
            for (const row of [...designations, ...nicknames]) expect(row['entity_id'], JSON.stringify(row)).toMatch(/^SSA:\d{7}$/);
            const overrides = designations.filter(d => d['is_primary'] === true);
            const others = designations.filter(d => d['is_primary'] === false);
            expect(overrides.length + others.length).toBe(designations.length);
            expect(overrides.length).toBeGreaterThan(0);
            for (const d of overrides) expect(d['code'], JSON.stringify(d)).toMatch(/^[A-Z]+\d+[A-Z0-9]*$/);
            expect(overrides.every(d => d['id'] === null), 'a primary designation is generated, so its row holds no id').toBe(true);
            expect(others.every(d => d['id'] !== null), 'any other designation holds its own id').toBe(true);
            const unique = (values: unknown[]) => new Set(values).size === values.length;
            expect(unique(overrides.map(d => d['entity_id'])), 'one override per animal').toBe(true);
            expect(unique(designations.map(d => d['code'])), 'a code once').toBe(true);
            expect(unique(nicknames.map(n => `${n['entity_id']}/${n['name']}`)), 'a name once per entity').toBe(true);
        } finally {
            conn.closeSync();
        }
    });

    // What Postgres refused on insert, the rows are held to (Fable review, salish-9uu.2.3).
    test('a catalogue that breaks what Postgres enforced is refused, naming every row', async () => {
        const parent = await mkdtemp(path.join(tmpdir(), 'catalogue-'));
        try {
            // a nickname credited to no party; a designation scheme Postgres has no label for, and a code twice
            const dir = await catalogueDir(parent, [
                ['1', 'SSA:0011001', 'AB5', 'atlantis', 'active', 'false', 'true', ''],
                ['2', 'SSA:0011002', 'AB5', 'alaska', 'active', 'false', 'true', ''],
            ], [['1', 'SSA:0011000', 'Moon', 'official', '99999', '', '']]);
            // a haul-out with no latitude, and one too wide
            const lines = (await readFile(path.join(dir, 'haulouts.tsv'), 'utf8')).replace(/\n$/, '').split('\n');
            const cells = (line: string) => line.split('\t');
            const a = cells(lines[1]!); a[3] = '';
            const b = cells(lines[2]!); b[5] = '9000';
            await writeFile(path.join(dir, 'haulouts.tsv'), [lines[0], a.join('\t'), b.join('\t'), ...lines.slice(3)].join('\n') + '\n');
            const loaded = await loadFixture(parent, together(SOUTHERN_RESIDENTS, BIGGS), dir);
            const error = 'error' in loaded ? loaded.error : null;
            expect(error).toMatch(/nicknames.namer_id names no row of parties/);
            expect(error).toMatch(/designations.scheme is not a public.designation_scheme: atlantis/);
            expect(error).toMatch(/designations repeats \(code\)/);
            expect(error).toMatch(/haulouts.lat is empty/);
            expect(error).toMatch(/haulouts rows must have a radius from 50 to 5,000 metres/);
        } finally {
            await rm(parent, {recursive: true, force: true});
        }
    });
});

describe("an individual's vitals from the register", () => {
    // salish-fwyt.4.2: `born` is an EDTF date (the register's docs/glossary.md); every form it
    // lists gives the years it opens and closes with, so a more precise birth isn't lost.
    test('a birth in any EDTF form the register uses gives its earliest and latest year', async () => {
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        try {
            const births = ['1998', '2020-09', '2024-06-14', '1998?', '1979~', '1995/1998', '../1966', '1968/..', '../1985-07', null, 'unknown'];
            await conn.run("ATTACH ':memory:' AS register");
            await conn.run(`CREATE TABLE register.vitals (entity_id VARCHAR, sex VARCHAR, born VARCHAR)`);
            await conn.run(`CREATE TABLE register.current_status (entity_id VARCHAR, status VARCHAR)`);
            await conn.run(`CREATE TABLE register.status_dates (entity_id VARCHAR, effective VARCHAR)`);
            await conn.run(`CREATE TABLE individuals (id INTEGER, entity_id VARCHAR)`);
            for (const [i, born] of births.entries()) {
                await conn.run(`INSERT INTO register.vitals VALUES ('SSA:00200${i}', 'F', ${born === null ? 'NULL' : `'${born}'`})`);
                await conn.run(`INSERT INTO register.current_status VALUES ('SSA:00200${i}', 'alive')`);
                await conn.run(`INSERT INTO individuals VALUES (${i}, 'SSA:00200${i}')`);
            }
            const vitals = await registerVitals(conn, 'individuals');
            const years = births.map((born, i) => [born, vitals.get(i)!['born_earliest'], vitals.get(i)!['born_latest']]);
            expect(years).toEqual([
                ['1998', 1998, 1998], ['2020-09', 2020, 2020], ['2024-06-14', 2024, 2024],
                ['1998?', 1998, 1998], ['1979~', 1979, 1979], ['1995/1998', 1995, 1998],
                ['../1966', null, 1966], ['1968/..', 1968, null], ['../1985-07', null, 1985],
                [null, null, null], ['unknown', null, null],
            ]);
        } finally {
            conn.closeSync();
        }
    });

    // salish-fwyt.4.3: the year of a death is the year its status took effect, when that is a date;
    // the Bigg's deaths read '../2026-07', dead by the sheet's snapshot, which dates nothing.
    test('a dated death gives its year, an undated one none, and a living animal none', async () => {
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        try {
            await conn.run("ATTACH ':memory:' AS register");
            await conn.run(`CREATE TABLE register.vitals AS SELECT * FROM (VALUES
                ('SSA:0020001', 'F', '1971'), ('SSA:0020002', 'M', '2004'), ('SSA:0010003', 'F', '../1985'),
                ('SSA:0020004', 'F', '2019'), ('SSA:0020005', 'M', '1990-05')) v(entity_id, sex, born)`);
            await conn.run(`CREATE TABLE register.current_status AS SELECT * FROM (VALUES
                ('SSA:0020001', 'presumed_dead'), ('SSA:0020002', 'dead'), ('SSA:0010003', 'dead'),
                ('SSA:0020004', 'alive'), ('SSA:0020005', 'presumed_dead')) s(entity_id, status)`);
            await conn.run(`CREATE TABLE register.status_dates AS SELECT * FROM (VALUES
                ('SSA:0020001', '2016'), ('SSA:0020002', '2023-08-14'), ('SSA:0010003', '../2026-07'),
                ('SSA:0020004', '2019'), ('SSA:0020005', NULL)) d(entity_id, effective)`);
            await conn.run(`CREATE TABLE individuals AS SELECT * FROM (VALUES
                (1, 'SSA:0020001'), (2, 'SSA:0020002'), (3, 'SSA:0010003'), (4, 'SSA:0020004'), (5, 'SSA:0020005')) i(id, entity_id)`);
            const vitals = await registerVitals(conn, 'individuals');
            const died = Object.fromEntries([...vitals].map(([id, v]) => [id, v['died']]));
            expect(died).toEqual({1: 2016, 2: 2023, 3: null, 4: null, 5: null});
            expect(vitals.get(1)).toMatchObject({life_status: 'presumed_deceased', born_earliest: 1971});
        } finally {
            conn.closeSync();
        }
    });
});
