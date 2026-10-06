import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import { animalNames } from './animal-names.ts';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'names-')); });
afterEach(async () => { await rm(dir, {recursive: true, force: true}); });

const orca = {entity_id: 'SSA:0000900', common_name: 'Orca', taxon_common_name: 'Killer whale', inaturalist_scientific_name: 'Orcinus orca'};
const humpback = {entity_id: 'SSA:0000901', common_name: null, taxon_common_name: 'Humpback whale', inaturalist_scientific_name: 'Megaptera novaeangliae'};

test('the names the build published, for the ids asked; none before the first build; reread when the build rewrites it', async () => {
    const names = animalNames(dir);
    expect(names(['SSA:0000900']).size).toBe(0);
    const file = path.join(dir, 'animal-names.json');
    await writeFile(file, JSON.stringify([orca]));
    expect([...names(['SSA:0000900', 'SSA:0000901'])]).toEqual([['SSA:0000900', orca]]);
    // a later build adds a species: the file's time moves, and so does the answer
    await writeFile(file, JSON.stringify([orca, humpback]));
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    expect(names(['SSA:0000901']).get('SSA:0000901')).toEqual(humpback);
    // unreadable: no names, not a failed read
    await writeFile(file, '{ not json');
    const broken = new Date(Date.now() + 10_000);
    await utimes(file, broken, broken);
    expect(names(['SSA:0000900']).size).toBe(0);
});
