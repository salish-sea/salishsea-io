import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { describe, expect, test } from 'vitest';

import { CATALOGUE, CATALOGUE_DIR, documents, generatedRows, jsonbOrdered, loadCatalogue } from './catalogue.ts';
import { loadReference, readTsv } from './reference.ts';

/**
 * The register tables the catalogue reads, in `store.register`, holding `rows`: a small
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
        await conn.run(`CREATE TABLE store.register.${table} (${columns})`);
        if (rows.length) await conn.run(`INSERT INTO store.register.${table} VALUES ${rows.map(r => `(${r.map(q).join(', ')})`).join(', ')}`);
    };
    await conn.run('CREATE SCHEMA store.register');
    await fill('entities', 'entity_id VARCHAR, kind VARCHAR, label VARCHAR', entities.map(([id, kind, , label]) => [id, kind, label]));
    await fill('group_ranks', 'entity_id VARCHAR, rank VARCHAR', entities.map(([id, , rank]) => [id, rank]));
    await fill('ancestor', 'entity_id VARCHAR, ancestor_id VARCHAR', ancestor);
    await fill('parentage', 'child_id VARCHAR, parent_id VARCHAR, role VARCHAR', parentage.map(([c, p]) => [c, p, 'mother']));
    await fill('matriarchs', 'matriline_id VARCHAR, matriarch_id VARCHAR', matriarchs);
    await fill('deprecations', 'entity_id VARCHAR, replaced_by VARCHAR', deprecated.map(id => [id, null]));
}

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

    test('every checked-in file reads with its declared types, and no individual is without an entity', async () => {
        const conn = await (await DuckDBInstance.create(':memory:')).connect();
        try {
            for (const [table, {file, columns}] of Object.entries(CATALOGUE)) {
                const n = (await conn.runAndReadAll(`SELECT count(*) FROM ${readTsv(path.join(CATALOGUE_DIR, file), columns)}`)).getRows()[0]![0];
                expect(Number(n), table).toBeGreaterThan(0);
            }
            const individuals = CATALOGUE['individuals']!;
            const orphans = (await conn.runAndReadAll(
                `SELECT count(*) FROM ${readTsv(path.join(CATALOGUE_DIR, individuals.file), individuals.columns)} WHERE entity_id IS NULL`,
            )).getRows()[0]![0];
            expect(Number(orphans)).toBe(0);
        } finally {
            conn.closeSync();
        }
    });

    // What Postgres refused on insert, the files are held to (Fable review, salish-9uu.2.3).
    test('a catalogue that breaks what Postgres enforced is refused, naming every row', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'catalogue-'));
        const snapshot = path.join(dir, 'snapshot.duckdb');
        try {
            const conn = await (await DuckDBInstance.create(':memory:')).connect();
            await conn.run(`ATTACH '${snapshot}' AS store`);
            await loadReference(conn, 'store');
            // A register with no Southern Residents: only the files' own rows are held to account.
            await registerFixture(conn);
            conn.closeSync();
            for (const {file} of Object.values(CATALOGUE)) await copyFile(path.join(CATALOGUE_DIR, file), path.join(dir, file));
            const edit = async (file: string, change: (lines: string[]) => string[]) => {
                const lines = (await readFile(path.join(dir, file), 'utf8')).replace(/\n$/, '').split('\n');
                await writeFile(path.join(dir, file), change(lines).join('\n') + '\n');
            };
            const cells = (line: string) => line.split('\t');
            // a nickname credited to no party, and one belonging to nobody
            await edit('nicknames.tsv', ([h, first, second, ...rest]) => {
                const a = cells(first!); a[5] = '99999';
                const b = cells(second!); b[1] = ''; b[2] = '';
                return [h!, a.join('\t'), b.join('\t'), ...rest];
            });
            // a designation scheme Postgres has no label for, and a code twice
            await edit('designations.tsv', ([h, first, second, ...rest]) => {
                const a = cells(first!); a[3] = 'atlantis';
                const b = cells(second!); b[2] = a[2]!;
                return [h!, a.join('\t'), b.join('\t'), ...rest];
            });
            // a haul-out with no latitude, and one too wide
            await edit('haulouts.tsv', ([h, first, second, ...rest]) => {
                const a = cells(first!); a[3] = '';
                const b = cells(second!); b[5] = '9000';
                return [h!, a.join('\t'), b.join('\t'), ...rest];
            });
            const error = await loadCatalogue(snapshot, dir).then(() => null, (e: Error) => e.message);
            expect(error).toMatch(/nicknames.namer_id names no row of parties/);
            expect(error).toMatch(/nicknames rows must name exactly one individual or group/);
            expect(error).toMatch(/designations.scheme is not a public.designation_scheme: atlantis/);
            expect(error).toMatch(/designations repeats \(code\)/);
            expect(error).toMatch(/haulouts.lat is empty/);
            expect(error).toMatch(/haulouts rows must have a radius from 50 to 5,000 metres/);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
});
