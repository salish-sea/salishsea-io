/**
 * A subject's encounters are the map's travel segments that hold a report of it (decision
 * 098): two tracks far apart on one day are two encounters, a report on the same track
 * that doesn't name the subject is counted in it, and a day without a report of any
 * subject is never read.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { Encounter } from '../../src/encounter.ts';
import { writeEncounters } from './encounters.ts';

const BIGGS = {scientific_name: 'Orcinus orca rectipinnus', vernacular_name: "Bigg's killer whale", species_id: 1, entity_id: null};

/** A report as a day's file holds it, with only what the summary reads set. */
function report(id: string, observed_at: string, lon: number, lat: number, more: object = {}) {
    return {
        id, observed_at, url: `https://example.org/${id}`, body: null, count: null, identifiers: null, vitality: null,
        location: {lon, lat}, photos: [], provider: 'Maplify', provider_slug: 'maplify', collection: 'Orca Network',
        taxon: BIGGS, direction: null, confirmation: 'confirmed', ...more,
    };
}

const OCCURRENCES = [
    // 1 October 2026 (Pacific), Dalco Passage: one track of three reports, one naming the
    // matriline, one naming T065A5, and one naming nobody.
    report('dalco-1', '2026-10-01T17:00:00+00:00', -122.50, 47.33, {identifiers: ['T65As']}),
    report('dalco-2', '2026-10-01T17:30:00+00:00', -122.51, 47.34, {provider: 'SalishSea.io', provider_slug: 'direct', collection: null}),
    report('dalco-3', '2026-10-01T18:00:00+00:00', -122.52, 47.35, {identifiers: ['T65A5'],
        photos: [{src: 'https://example.org/p.jpg', thumb: null, attribution: 'A. Observer', mimetype: null, license: null}]}),
    // The same day, 90 km north in Saratoga Passage: a track of its own, whose report only
    // possibly names T065A5 ("possibly T65A5").
    report('saratoga-1', '2026-10-01T19:00:00+00:00', -122.50, 48.15, {identifiers: ['T65A5?']}),
    // 2 October: a report of nobody, on a day no subject was reported.
    report('quiet-1', '2026-10-02T19:00:00+00:00', -123.0, 48.5),
];

// 2 is a calf born in 2026, a member of matriline 10 (salish-fwyt.4.2).
const INDIVIDUALS = [{id: 1, entity_id: 'SSA:0010197', primary_designation: 'T065A5', born_earliest: null},
    {id: 2, entity_id: 'SSA:0010198', primary_designation: 'T065A6', born_earliest: 2026}];
const MEMBERS = [{group_id: 10, individual_id: 1, innermost_group_id: 10}, {group_id: 10, individual_id: 2, innermost_group_id: 10}];
const GROUPS = [{id: 10, kind: 'matriline', entity_id: 'SSA:0002163'}, {id: 11, kind: 'pod', entity_id: 'SSA:0000500'}];
const link = (occurrence_id: string, via_group: string | null = null) => ({
    occurrence_id, observed_at: OCCURRENCES.find(o => o.id === occurrence_id)!.observed_at,
    location: null, is_present: true, status: 'candidate', via_group,
});
const INDIVIDUAL_LINKS = [
    {individual_id: 1, ...link('dalco-1', 'T065A')},
    {individual_id: 1, ...link('dalco-3')},
    {individual_id: 1, ...link('saratoga-1'), certainty: 'possible'},
    // Rejected: not a report of it.
    {individual_id: 1, ...link('quiet-1'), status: 'rejected'},
    // The calf: reached through its matriline at Dalco Passage, then named itself at Saratoga.
    {individual_id: 2, ...link('dalco-1', 'T065A')},
    {individual_id: 2, ...link('saratoga-1')},
];
const GROUP_LINKS = [{social_group_id: 10, ...link('dalco-1')}];

let out: string;

beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'read-path-encounters-'));
    const snapshot = path.join(dir, 'snapshot.duckdb');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    await conn.run(`ATTACH '${snapshot}' AS store`);
    await conn.run('CREATE SCHEMA store.build');
    await conn.run('CREATE SCHEMA store.snapshot');
    const docs = async (table: string, rows: object[]) => {
        await conn.run(`CREATE TABLE ${table} (doc VARCHAR)`);
        for (const row of rows) await conn.run(`INSERT INTO ${table} VALUES ('${JSON.stringify(row).replaceAll("'", "''")}')`);
    };
    await docs('store.snapshot.individuals', INDIVIDUALS);
    await docs('store.snapshot.social_groups', GROUPS);
    await docs('store.build.individual_occurrences', INDIVIDUAL_LINKS);
    await docs('store.build.group_occurrences', GROUP_LINKS);
    await docs('store.snapshot.matriline_members', MEMBERS);
    await conn.run('CREATE TABLE store.build.occurrences (id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR)');
    for (const o of OCCURRENCES)
        await conn.run(`INSERT INTO store.build.occurrences VALUES ('${o.id}', '${o.observed_at}', '${JSON.stringify(o).replaceAll("'", "''")}')`);
    await conn.run('DETACH store');
    conn.closeSync();
    await writeEncounters(snapshot, path.join(dir, 'export'));
    out = path.join(dir, 'export', 'encounters');
});

const encounters = async (file: string): Promise<Encounter[]> => JSON.parse(await readFile(path.join(out, file), 'utf8'));

describe('writeEncounters', () => {
    test('writes a file for every subject with a page, and only those', async () => {
        expect((await readdir(path.join(out, 'individuals'))).sort()).toEqual(['0010197.json', '0010198.json']);
        expect(await readdir(path.join(out, 'matrilines'))).toEqual(['0002163.json']);
        expect((await encounters('individuals/0010198.json')).map(e => e.ids)).toEqual([['saratoga-1'], ['dalco-1']]);
    });

    test("a day's two tracks far apart are two encounters, newest first", async () => {
        const [saratoga, dalco] = await encounters('individuals/0010197.json');
        expect(saratoga).toMatchObject({day: '2026-10-01', reports: 1, ids: ['saratoga-1'], as_self: 1});
        expect(dalco).toMatchObject({day: '2026-10-01', reports: 3, ids: ['dalco-1', 'dalco-3']});
    });

    test('an encounter counts the reports that only possibly name the subject, and says nothing when none do (decision 054)', async () => {
        const [saratoga, dalco] = await encounters('individuals/0010197.json');
        expect(saratoga!.possibly).toBe(1);
        expect(dalco).not.toHaveProperty('possibly');
    });

    test("an encounter counts every report on its track, says how many name the subject itself, and pools what they hold", async () => {
        const dalco = (await encounters('individuals/0010197.json'))[1]!;
        expect(dalco.as_self).toBe(1);
        expect(dalco.start).toBe('2026-10-01T17:00:00+00:00');
        expect(dalco.end).toBe('2026-10-01T18:00:00+00:00');
        expect(dalco.identifiers).toEqual([['T65As'], ['T65A5']]);
        expect(dalco.location).toEqual({lon: -122.51, lat: 47.34});
        expect(dalco.photos).toEqual([{src: 'https://example.org/p.jpg', thumb: null, attribution: 'A. Observer', href: 'https://example.org/dalco-3'}]);
        expect(dalco.channels).toEqual([['Orca Network', 2], ['SalishSea.io', 1]]);
    });

    test("a calf's first report naming it marks that encounter, on its own timeline and on its matriline's if the matriline holds it (salish-fwyt.4.2)", async () => {
        const [saratoga, dalco] = await encounters('individuals/0010198.json');
        expect(saratoga!.firsts).toEqual([{label: 'T065A6', born: 2026}]);
        expect(dalco).not.toHaveProperty('firsts');
        // the matriline has no encounter at Saratoga, so its timeline doesn't mark one elsewhere
        expect((await encounters('matrilines/0002163.json')).some(e => e.firsts)).toBe(false);
        // T065A5 has no birth year, so no first report is marked for it
        expect((await encounters('individuals/0010197.json')).some(e => e.firsts)).toBe(false);
    });

    test("a matriline's encounters are the tracks holding a report of the group", async () => {
        expect((await encounters('matrilines/0002163.json')).map(e => e.ids)).toEqual([['dalco-1']]);
    });
});
