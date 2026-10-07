/**
 * The whales page from a store shaped like the build's: which taxa count as cetaceans,
 * how a report reaches its species, and what the page says (salish-nkbq).
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { beforeAll, describe, expect, test } from 'vitest';

import { assembleWhales, readInputs, renderWhalesPage, type Inputs } from './whales.ts';

const shell = `<!DOCTYPE html><html><head><title>x</title><meta name="description" content="x">
<meta property="og:title" content="x"><meta property="og:description" content="x">
<script type="module" src="/src/whales-page.ts"></script></head><body><whales-page></whales-page></body></html>`;

/** A register with Cetacea, two whales beneath it, a parvorder, a seal, and killer whale ecotypes. */
const ENTITIES: [string, string, string][] = [
    ['SSA:0000934', 'taxon', 'Cetacea'],
    ['SSA:0000935', 'taxon', 'Mysticeti'],
    ['SSA:0000900', 'taxon', 'Orcinus orca'],
    ['SSA:0000901', 'taxon', 'Megaptera novaeangliae'],
    ['SSA:0000904', 'taxon', 'Phoca vitulina'],
    ['SSA:0000002', 'group', "Bigg's"],
    ['SSA:0000003', 'group', 'Resident'],
    ['SSA:0000010', 'group', 'Southern Resident'],
];
const CLASSIFICATION: [string, string, string, string][] = [
    ['SSA:0000934', 'NCBITaxon:9721', 'Cetacea', 'infraorder'],
    ['SSA:0000935', 'NCBITaxon:9761', 'Mysticeti', 'parvorder'],
    ['SSA:0000900', 'NCBITaxon:9733', 'Orcinus orca', 'species'],
    ['SSA:0000901', 'NCBITaxon:9773', 'Megaptera novaeangliae', 'species'],
    ['SSA:0000904', 'NCBITaxon:9720', 'Phoca vitulina', 'species'],
];
const TAXON_ANCESTOR: [string, string, number][] = [
    ['NCBITaxon:9721', 'NCBITaxon:9721', 0],
    ['NCBITaxon:9761', 'NCBITaxon:9761', 0], ['NCBITaxon:9761', 'NCBITaxon:9721', 1],
    ['NCBITaxon:9733', 'NCBITaxon:9733', 0], ['NCBITaxon:9733', 'NCBITaxon:9721', 3],
    ['NCBITaxon:9773', 'NCBITaxon:9773', 0], ['NCBITaxon:9773', 'NCBITaxon:9761', 3],
    ['NCBITaxon:9773', 'NCBITaxon:9721', 4],
    ['NCBITaxon:9720', 'NCBITaxon:9720', 0], ['NCBITaxon:9720', 'NCBITaxon:33554', 5],
];
const ANCESTOR: [string, string, number, string][] = [
    ['SSA:0000002', 'SSA:0000900', 1, 'taxon'],
    ['SSA:0000003', 'SSA:0000900', 1, 'taxon'],
    ['SSA:0000010', 'SSA:0000003', 1, 'group'],
    ['SSA:0000010', 'SSA:0000900', 2, 'taxon'],
];
/** id, observed_at, the entity it names, located */
const OCCURRENCES: [string, string, string, boolean][] = [
    ['hump-1', '2026-09-01T18:00:00+00:00', 'SSA:0000901', true],
    ['hump-2', '2026-08-01T18:00:00+00:00', 'SSA:0000901', true],
    ['biggs-1', '2026-07-01T18:00:00+00:00', 'SSA:0000002', true],
    ['srkw-1', '2026-09-15T18:00:00+00:00', 'SSA:0000010', false],
    ['baleen-1', '2026-05-01T18:00:00+00:00', 'SSA:0000935', true],
    ['cetacean-1', '2026-04-01T18:00:00+00:00', 'SSA:0000934', true],
    ['seal-1', '2026-09-20T18:00:00+00:00', 'SSA:0000904', true],
];

let inputs: Inputs;

beforeAll(async () => {
    const snapshot = path.join(await mkdtemp(path.join(tmpdir(), 'read-path-whales-')), 'snapshot.duckdb');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
    await conn.run(`ATTACH '${snapshot}' AS store`);
    for (const schema of ['register', 'snapshot', 'build']) await conn.run(`CREATE SCHEMA store.${schema}`);
    await conn.run('CREATE TABLE store.register.entities (entity_id VARCHAR, kind VARCHAR, label VARCHAR)');
    await conn.run(`INSERT INTO store.register.entities VALUES ${ENTITIES.map(r => `(${r.map(q).join(', ')})`).join(', ')}`);
    await conn.run('CREATE TABLE store.register.classification (entity_id VARCHAR, taxon_id VARCHAR, scientific_name VARCHAR, taxon_rank VARCHAR)');
    await conn.run(`INSERT INTO store.register.classification VALUES ${CLASSIFICATION.map(r => `(${r.map(q).join(', ')})`).join(', ')}`);
    await conn.run('CREATE TABLE store.register.taxon_ancestor (taxon_id VARCHAR, ancestor_id VARCHAR, depth INTEGER)');
    await conn.run(`INSERT INTO store.register.taxon_ancestor VALUES ${TAXON_ANCESTOR.map(([t, a, d]) => `(${q(t)}, ${q(a)}, ${d})`).join(', ')}`);
    await conn.run('CREATE TABLE store.register.ancestor (entity_id VARCHAR, ancestor_id VARCHAR, depth INTEGER, ancestor_kind VARCHAR)');
    await conn.run(`INSERT INTO store.register.ancestor VALUES ${ANCESTOR.map(([e, a, d, k]) => `(${q(e)}, ${q(a)}, ${d}, ${q(k)})`).join(', ')}`);
    await conn.run('CREATE TABLE store.snapshot.animal_names (doc VARCHAR)');
    for (const [entity_id, common_name] of [['SSA:0000900', 'Killer whale'], ['SSA:0000901', 'Humpback whale']])
        await conn.run(`INSERT INTO store.snapshot.animal_names VALUES (${q(JSON.stringify({entity_id, common_name}))})`);
    await conn.run('CREATE TABLE store.snapshot.social_groups (doc VARCHAR)');
    for (const g of [{kind: 'ecotype', entity_id: 'SSA:0000002', designation: 'Biggs'}, {kind: 'matriline', entity_id: 'SSA:0020001', designation: 'T065A'}])
        await conn.run(`INSERT INTO store.snapshot.social_groups VALUES (${q(JSON.stringify(g))})`);
    await conn.run('CREATE TABLE store.build.occurrences (id VARCHAR, observed_at TIMESTAMPTZ, doc VARCHAR)');
    for (const [id, observed_at, entity_id, located] of OCCURRENCES) {
        const doc = {id, observed_at, taxon: {entity_id}, location: located ? {lat: 48.5, lon: -123} : null};
        await conn.run(`INSERT INTO store.build.occurrences VALUES (${q(id)}, ${q(observed_at)}, ${q(JSON.stringify(doc))})`);
    }
    conn.closeSync();
    db.closeSync();
    inputs = await readInputs(snapshot);
});

describe('the whales page', () => {
    test('a cetacean is a species under Cetacea: the seal is not one', () => {
        expect(inputs.species.map(s => s.entity_id)).toEqual(['SSA:0000900', 'SSA:0000901']);
        expect(inputs.reports.map(r => r.occurrence_id)).not.toContain('seal-1');
    });

    test('a report of an ecotype counts toward its species; one named only above species is counted apart', () => {
        const {species, unidentified} = assembleWhales(inputs);
        expect(species.map(s => [s.common_name, s.reports.map(r => r.occurrence_id)])).toEqual([
            ['Humpback whale', ['hump-1', 'hump-2']],
            ['Killer whale', ['srkw-1', 'biggs-1']],
        ]);
        expect(unidentified).toBe(2);
    });

    test('a species links the ecotypes that have pages', () => {
        const orca = assembleWhales(inputs).species.find(s => s.entity_id === 'SSA:0000900')!;
        expect(orca.ecotypes).toEqual([{href: '/populations/0000002/Biggs', label: "Bigg's (transient)"}]);
    });

    test('the page: the nav with Whales current, each species with its facts and map, the rest counted', () => {
        const doc = renderWhalesPage(shell, assembleWhales(inputs));
        expect(doc).toContain('<title>Whales · SalishSea.io</title>');
        expect(doc).toContain('<link rel="canonical" href="https://salishsea.io/whales">');
        expect(doc).toMatch(/<a class="whales-link" href="\/whales" aria-current="page">Whales<\/a>/);
        expect(doc).not.toContain('<script');
        expect(doc).toMatch(/<h2>Humpback whale<\/h2>.*<h2>Killer whale<\/h2>/s);
        expect(doc).toContain('Ecotypes: <a href="/populations/0000002/Biggs">Bigg&#39;s (transient)</a>');
        expect(doc).toMatch(/2 more reports name a cetacean only/);
        expect(doc.match(/<svg class="small-map"/g)).toHaveLength(2);
    });
});
