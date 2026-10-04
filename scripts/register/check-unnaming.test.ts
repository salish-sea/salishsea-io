/**
 * The register-refresh workflow's refusal (salish-xv35.9.2): an edition that would un-name
 * a Maplify pair the map shows is refused before it is loaded, unless a curator accepted
 * the un-naming in data/maplify-unnamed.tsv. The edition is read the way the build reads
 * one — its TSVs, the same name index, the same resolution.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { checkEdition } from './check-unnaming.ts';
import { pairKey, parseUnnamed } from './unnamed.ts';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'check-unnaming-')); });
afterAll(async () => { await rm(dir, {recursive: true, force: true}); });

/** An unpacked edition whose register names these taxa, with the columns the register publishes. */
async function edition(name: string, taxa: [id: string, label: string, names: string[]][]): Promise<string> {
    const root = path.join(dir, name);
    await mkdir(path.join(root, 'data'), {recursive: true});
    await mkdir(path.join(root, 'dist'), {recursive: true});
    const tsv = (header: string[], rows: (string | null)[][]) =>
        [header, ...rows].map(r => r.map(c => c ?? '').join('\t')).join('\n') + '\n';
    await writeFile(path.join(root, 'data', 'entities.tsv'), tsv(
        ['entity_id', 'kind', 'rank', 'label', 'taxon_id', 'born', 'sex', 'source_id', 'note'],
        taxa.map(([id, label]) => [id, 'taxon', 'species', label, id, null, null, 'src', null])));
    await writeFile(path.join(root, 'data', 'names.tsv'), tsv(
        ['entity_id', 'name', 'type', 'language', 'source_id', 'note'],
        taxa.flatMap(([id, , names]) => names.map(n => [id, n, 'common', 'en', 'src', null]))));
    await writeFile(path.join(root, 'dist', 'ancestor.tsv'), tsv(
        ['entity_id', 'ancestor_id', 'depth', 'ancestor_label', 'ancestor_kind', 'ancestor_rank'], []));
    await writeFile(path.join(root, 'data', 'deprecations.tsv'), tsv(
        ['entity_id', 'reason', 'replaced_by', 'consider', 'date', 'source_id', 'note'], []));
    return root;
}

const named = (name: string | null, scientific_name: string, entity_id: string) => ({name, scientific_name, entity_id});

describe('checkEdition', () => {
    test('an edition that still names every pair passes', async () => {
        const root = await edition('fine', [['SSA:1', 'Orcinus orca', ['Orca', 'Killer Whale (Orca)']], ['SSA:2', 'Balaenoptera borealis', ['Sei Whale']]]);
        expect(await checkEdition(root, [named('Orca', 'Orcinus orca', 'SSA:1'), named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')], new Set()))
            .toEqual([]);
    });

    test('one that stops naming a pair is refused, naming it', async () => {
        const root = await edition('lost', [['SSA:1', 'Orcinus orca', ['Orca']]]);
        expect(await checkEdition(root, [named('Orca', 'Orcinus orca', 'SSA:1'), named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')], new Set()))
            .toEqual([{name: 'Sei Whale', scientific_name: 'Balaenoptera borealis', was: 'SSA:2', sightings: 0}]);
    });

    test('unless a curator accepted that un-naming', async () => {
        const root = await edition('accepted', [['SSA:1', 'Orcinus orca', ['Orca']]]);
        const allowed = new Set([pairKey({name: 'Sei Whale', scientific_name: 'Balaenoptera borealis'})]);
        expect(await checkEdition(root, [named('Orca', 'Orcinus orca', 'SSA:1'), named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')], allowed))
            .toEqual([]);
    });

    test('a pair moving to another entity is a register edit doing its job', async () => {
        const root = await edition('moved', [['SSA:9', 'Orcinus orca', ['Orca']]]);
        expect(await checkEdition(root, [named('Orca', 'Orcinus orca', 'SSA:1')], new Set())).toEqual([]);
    });
});

describe('the allow-list', () => {
    test('is a TSV with a header, an empty name meaning none', () => {
        expect(parseUnnamed('name\tscientific_name\tsince\treason\nSei Whale\tBalaenoptera borealis\t2026-10-04\tnot in the Salish Sea\n\tN/A\t2026-10-04\tno name at all\n'))
            .toEqual([
                {name: 'Sei Whale', scientific_name: 'Balaenoptera borealis', since: '2026-10-04', reason: 'not in the Salish Sea'},
                {name: null, scientific_name: 'N/A', since: '2026-10-04', reason: 'no name at all'},
            ]);
        expect(parseUnnamed('name\tscientific_name\tsince\treason\n')).toEqual([]);
    });

    test('refuses a changed header or a ragged row rather than guess', () => {
        expect(() => parseUnnamed('name\tscientific\n')).toThrow(/expected columns/);
        expect(() => parseUnnamed('name\tscientific_name\tsince\treason\nOrca\tOrcinus orca\n')).toThrow(/ragged/);
    });
});
