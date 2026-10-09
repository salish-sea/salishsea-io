import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

/**
 * source_acoustic_bout_entities (derive/sources.sql): a bout's tags arrive as whole chains
 * (J pod with Southern Resident, Killer whale and Cetacean), and each cited entity a more
 * specific one on the same bout implies is dropped, unless it is the surer claim
 * (salish-8vr.32). The register here is the slice of it these bouts reach, as edition
 * 2026.10.1 has it.
 */

const CETACEA = 'SSA:0000934', ORCA = 'SSA:0000900', SRKW = 'SSA:0000010', BIGGS = 'SSA:0000002';
const J = 'SSA:0000020', K = 'SSA:0000021', L = 'SSA:0000022', T034S = 'SSA:0002014';

const REGISTER = `
    CREATE SCHEMA register;
    CREATE TABLE register.entities (entity_id VARCHAR, kind VARCHAR, label VARCHAR);
    INSERT INTO register.entities VALUES
        ('${CETACEA}', 'taxon', 'Cetacea'), ('${ORCA}', 'taxon', 'Orcinus orca'),
        ('${SRKW}', 'group', 'Southern Resident'), ('${BIGGS}', 'group', 'Bigg''s'),
        ('${J}', 'group', 'J pod'), ('${K}', 'group', 'K pod'), ('${L}', 'group', 'L pod'),
        ('${T034S}', 'group', 'T034s');
    CREATE TABLE register.ancestor (entity_id VARCHAR, ancestor_id VARCHAR, depth INTEGER, ancestor_kind VARCHAR);
    INSERT INTO register.ancestor VALUES
        ('${SRKW}', '${ORCA}', 2, 'taxon'), ('${BIGGS}', '${ORCA}', 1, 'taxon'),
        ('${J}', '${SRKW}', 2, 'group'), ('${J}', '${ORCA}', 4, 'taxon'),
        ('${K}', '${SRKW}', 2, 'group'), ('${K}', '${ORCA}', 4, 'taxon'),
        ('${L}', '${SRKW}', 2, 'group'), ('${L}', '${ORCA}', 4, 'taxon'),
        ('${T034S}', '${BIGGS}', 1, 'group'), ('${T034S}', '${ORCA}', 2, 'taxon');
    CREATE TABLE register.classification (entity_id VARCHAR, taxon_id VARCHAR);
    INSERT INTO register.classification VALUES ('${ORCA}', 'NCBITaxon:9733'), ('${CETACEA}', 'NCBITaxon:9721');
    CREATE TABLE register.taxon_ancestor (taxon_id VARCHAR, ancestor_id VARCHAR, depth INTEGER);
    INSERT INTO register.taxon_ancestor VALUES
        ('NCBITaxon:9733', 'NCBITaxon:9733', 0), ('NCBITaxon:9733', 'NCBITaxon:9721', 4),
        ('NCBITaxon:9721', 'NCBITaxon:9721', 0);
`;

/** The two views, cut from sources.sql as written, over these bouts' tags. */
async function citedAfterFiltering(tags: [bout: string, entity: string, certainty: string | null][]): Promise<Record<string, string[]>> {
    const sql = await readFile(new URL('./sources.sql', import.meta.url), 'utf8');
    const start = sql.indexOf('CREATE OR REPLACE TEMP VIEW register_implies');
    const end = sql.indexOf(';', sql.indexOf('CREATE OR REPLACE TEMP VIEW source_acoustic_bout_entities'));
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    try {
        await conn.run(REGISTER);
        await conn.run(`
            CREATE SCHEMA orcasound;
            CREATE TABLE orcasound.bouts (id VARCHAR, category VARCHAR);
            CREATE TABLE orcasound.bout_entities (bout_id VARCHAR, entity_id VARCHAR, certainty VARCHAR)`);
        for (const bout of new Set(tags.map(([b]) => b)))
            await conn.run(`INSERT INTO orcasound.bouts VALUES ('${bout}', '${bout === 'vessel' ? 'anthrophony' : 'biophony'}')`);
        for (const [bout, entity, certainty] of tags)
            await conn.run(`INSERT INTO orcasound.bout_entities VALUES ('${bout}', '${entity}', ${certainty ? `'${certainty}'` : 'NULL'})`);
        await conn.run(sql.slice(start, end + 1));
        const rows = (await conn.runAndReadAll(`
            SELECT bout_id, entity_id || coalesce(' ' || certainty, '') FROM source_acoustic_bout_entities
            ORDER BY bout_id, entity_id`)).getRows() as [string, string][];
        const byBout: Record<string, string[]> = {};
        for (const [bout, cited] of rows) (byBout[bout] ??= []).push(cited);
        return byBout;
    } finally {
        conn.closeSync();
    }
}

describe('source_acoustic_bout_entities', () => {
    test('a chain names only its deepest tags, the taxa above the species included', async () => {
        expect(await citedAfterFiltering([
            ['b', CETACEA, null], ['b', ORCA, null], ['b', SRKW, null], ['b', J, null], ['b', K, null],
        ])).toEqual({b: [J, K]});
    });

    test("orcasite#1001's J + K + L?: Southern Resident goes, implied by the certain J and K", async () => {
        expect(await citedAfterFiltering([
            ['b', ORCA, null], ['b', SRKW, null], ['b', J, null], ['b', K, null], ['b', L, 'possible'],
        ])).toEqual({b: [J, K, `${L} possible`]});
    });

    test('the surer claim above a hedge stays: certainly Southern Resident, possibly L pod', async () => {
        expect(await citedAfterFiltering([
            ['b', ORCA, null], ['b', SRKW, null], ['b', L, 'possible'],
        ])).toEqual({b: [SRKW, `${L} possible`]});
    });

    test('a claim as sure as the one above it implies it, whichever word says so', async () => {
        expect(await citedAfterFiltering([
            ['b', SRKW, 'probable'], ['b', L, 'probable'],
        ])).toEqual({b: [`${L} probable`]});
    });

    test('a matriline implies its ecotype; bouts are taken one at a time', async () => {
        expect(await citedAfterFiltering([
            ['a', BIGGS, null], ['a', T034S, null], ['b', BIGGS, null], ['b', ORCA, null],
        ])).toEqual({a: [T034S], b: [BIGGS]});
    });

    test('only biophony bouts, as before', async () => {
        expect(await citedAfterFiltering([['vessel', ORCA, null]])).toEqual({});
    });
});
