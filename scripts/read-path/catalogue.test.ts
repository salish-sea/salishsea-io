import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, test } from 'vitest';

import { CATALOGUE, CATALOGUE_DIR, documents, jsonbOrdered } from './catalogue.ts';
import { readTsv } from './reference.ts';

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
});
