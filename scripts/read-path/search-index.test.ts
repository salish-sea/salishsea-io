import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { beforeAll, describe, expect, test } from 'vitest';

import { buildSearchIndex, readInputs } from './search-index.ts';
import type { SearchIndex } from '../../src/search.ts';

/** Bigg's T065A, Fingers, in the T065As; J31 in the J31s, in J pod, in the Southern Residents; J56, never reported. */
const DOCS: Record<string, object[]> = {
    individuals: [
        {id: 1, entity_id: 'SSA:0010193', primary_designation: 'T065A'},
        {id: 10020030, entity_id: 'SSA:0020030', primary_designation: 'J31'},
        {id: 10020056, entity_id: 'SSA:0020056', primary_designation: 'J56'},
        {id: 10020003, entity_id: 'SSA:0020003', primary_designation: 'J3'},
        {id: 9, entity_id: null, primary_designation: 'T999'},
    ],
    designations: [
        {id: 1, individual_id: 1, code: 'T065A'}, {id: 2, individual_id: 1, code: 'CA172'},
        {id: 10020030, individual_id: 10020030, code: 'J31'},
    ],
    nicknames: [
        {id: 1, individual_id: 1, social_group_id: null, name: 'Fingers', status: 'official'},
        {id: 2, individual_id: 1, social_group_id: null, name: 'Old Name', status: 'deprecated'},
    ],
    social_groups: [
        {id: 200, kind: 'ecotype', designation: 'Biggs', entity_id: 'SSA:0000002'},
        {id: 100, kind: 'matriline', designation: 'T065A', entity_id: 'SSA:0002163'},
        {id: 10000010, kind: 'community', designation: 'Southern Resident', entity_id: 'SSA:0000010'},
        {id: 10000020, kind: 'pod', designation: 'J', entity_id: 'SSA:0000020'},
        {id: 10003011, kind: 'matriline', designation: 'J31', entity_id: 'SSA:0003011'},
    ],
    group_parents: [
        {group_id: 100, parent_group_id: 200},
        {group_id: 10003011, parent_group_id: 10000020}, {group_id: 10000020, parent_group_id: 10000010},
    ],
    matriline_members: [
        {group_id: 100, individual_id: 1, innermost_group_id: 100},
        {group_id: 10003011, individual_id: 10020030, innermost_group_id: 10003011},
        {group_id: 10003011, individual_id: 10020056, innermost_group_id: 10003011},
    ],
    haulouts: [
        {id: 170, name: 'Waadah Island', region: 'Strait of Juan de Fuca-West'},
        {id: 171, name: 'Waadah Island', region: 'Strait of Juan de Fuca-West'},
    ],
};

/** J31's reports: an old one, her newest, and a newer one a curator rejected, which doesn't count. */
const LINKS: Record<string, object[]> = {
    individual_occurrences: [
        {individual_id: 10020030, occurrence_id: 'maplify:1', observed_at: '2024-11-07T18:02:00+00:00', is_present: true, status: 'candidate'},
        {individual_id: 10020030, occurrence_id: 'maplify:30', observed_at: '2026-10-06T20:00:00+00:00', is_present: true, status: 'candidate'},
        {individual_id: 10020030, occurrence_id: 'maplify:31', observed_at: '2026-10-07T20:00:00+00:00', is_present: true, status: 'rejected'},
        {individual_id: 1, occurrence_id: 'maplify:2', observed_at: '2026-09-01T03:00:00+00:00', is_present: false, status: 'candidate'},
    ],
    group_occurrences: [
        {social_group_id: 10003011, occurrence_id: 'maplify:30', observed_at: '2026-10-06T20:00:00+00:00', is_present: true, status: 'candidate'},
    ],
    ecotype_occurrences: [
        {ecotype_id: 10000010, occurrence_id: 'maplify:30', observed_at: '2026-10-06T20:00:00+00:00', is_present: true, status: 'candidate'},
        {ecotype_id: 10000020, occurrence_id: 'maplify:30', observed_at: '2026-10-06T20:00:00+00:00', is_present: true, status: 'candidate'},
    ],
};

let index: SearchIndex;
const find = (label: string) => index.entries.find(e => e.label === label)!;

beforeAll(async () => {
    const snapshot = path.join(await mkdtemp(path.join(tmpdir(), 'read-path-search-')), 'snapshot.duckdb');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
    await conn.run(`ATTACH '${snapshot}' AS store`);
    for (const schema of ['snapshot', 'build', 'register']) await conn.run(`CREATE SCHEMA store.${schema}`);
    for (const [schema, tables] of [['snapshot', DOCS], ['build', LINKS]] as const)
        for (const [table, rows] of Object.entries(tables)) {
            await conn.run(`CREATE TABLE store.${schema}.${table} (doc VARCHAR)`);
            for (const row of rows) await conn.run(`INSERT INTO store.${schema}.${table} VALUES (${q(JSON.stringify(row))})`);
        }
    await conn.run('CREATE TABLE store.register.names (entity_id VARCHAR, name VARCHAR, type VARCHAR, language VARCHAR)');
    await conn.run(`INSERT INTO store.register.names VALUES ('SSA:0000010', 'SRKW', 'hidden', 'en'), ('SSA:0000010', 'Southern Residents', 'common', 'en')`);
    // J3, in no matriline of ours, is still beneath the Southern Residents.
    await conn.run('CREATE TABLE store.register.ancestor (entity_id VARCHAR, ancestor_id VARCHAR, depth INTEGER)');
    await conn.run(`INSERT INTO store.register.ancestor VALUES ('SSA:0020003', 'SSA:0000020', 1), ('SSA:0020003', 'SSA:0000010', 2), ('SSA:0010193', 'SSA:0000002', 2)`);
    conn.closeSync();
    db.closeSync();
    index = buildSearchIndex(await readInputs(snapshot));
});

describe('the search index (GH #640)', () => {
    test('an animal answers to every code it has carried and its nicknames, and says what it is', () => {
        expect(find('T065A')).toMatchObject({
            kind: 'individual', note: "Bigg's killer whale · Fingers", href: '/individuals/0010193/T065A',
            keys: ['t65a', 'ca172', 'fingers'],
        });
        expect(find('J31').note).toBe('Southern Resident killer whale');
        // In no matriline of ours, but beneath the Southern Residents by the register.
        expect(find('J3').note).toBe('Southern Resident killer whale');
    });

    test('its most recent sighting is its newest report that counts, opened on the map', () => {
        expect(find('J31').latest).toEqual({date: '2026-10-06', href: '/?d=2026-10-06&o=maplify%3A30'});
        // An absence is not a sighting; never reported, no latest.
        expect(find('T065A').latest).toBeUndefined();
        expect(find('J56').latest).toBeUndefined();
    });

    test('only what has a page: no animal without a register identifier', () => {
        expect(index.entries.map(e => e.label)).not.toContain('T999');
        expect(index.entries.filter(e => e.kind === 'matriline').map(e => e.label)).toEqual(['T065As', 'J31s']);
    });

    test('a pod by its name, however it is written, with its population and its newest report', () => {
        expect(find('J pod')).toMatchObject({
            kind: 'pod', note: 'Pod · Southern Resident killer whales', href: '/pods/0000020/J-pod',
            keys: ['j pod', 'jpod'], latest: {date: '2026-10-06', href: '/?d=2026-10-06&o=maplify%3A30'},
        });
        expect(index.entries.map(e => e.label)).not.toContain('J');
    });

    test('matrilines name their population; a population answers to the register\'s search name', () => {
        expect(find('J31s')).toMatchObject({note: 'Matriline · Southern Resident killer whales', href: '/matrilines/0003011/J31s'});
        expect(find('J31s').latest?.date).toBe('2026-10-06');
        const srkw = find('Southern Resident killer whales');
        expect(srkw).toMatchObject({kind: 'population', href: '/populations/0000010/Southern-Resident'});
        expect(srkw.keys).toContain('srkw');
        expect(srkw.keys).not.toContain('southern residents');
    });

    test('haul-out sites, and the map\'s regions, which open the map filtered to them', () => {
        expect(find('Waadah Island')).toMatchObject({kind: 'haulout', note: 'Haul-out site · Strait of Juan de Fuca-West', href: '/haulouts/170/Waadah-Island'});
        // The atlas's second point for the same site is one result, not two.
        expect(index.entries.filter(e => e.label === 'Waadah Island')).toHaveLength(1);
        expect(find('San Juans')).toMatchObject({kind: 'region', href: '/?r=san-juans'});
        expect(index.entries.map(e => e.label)).not.toContain('Everywhere');
    });
});
