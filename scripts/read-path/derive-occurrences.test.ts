import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

import { compare as compareCandidates } from './compare-identifier-candidates.ts';
import { compare, differences, sourceOf } from './compare-occurrences.ts';
import { compare as compareProfileLinks, unmatched } from './compare-profile-links.ts';
import { compare as compareCatalogue } from './compare-catalogue.ts';
import { deriveCatalogue } from './derive-catalogue.ts';
import { deriveIdentifierCandidates } from './derive-identifier-candidates.ts';
import { readFile } from 'node:fs/promises';
import { ARM_INPUTS, armsFor, changedInputs, deriveOccurrences, parseArms, SOURCES, type Source } from './derive-occurrences.ts';
import { deriveProfileLinks } from './derive-profile-links.ts';
import { mirrorsFromSnapshot } from './derive/mirrors-from-snapshot.ts';
import { withDwc } from './dwca.ts';

describe('compare-occurrences', () => {
    test('a document agrees with itself however it is spaced', () => {
        expect(differences({id: 'a', location: {lat: 1, lon: 2}}, {id: 'a', location: {lat: 1, lon: 2}})).toEqual([]);
    });

    test('names the fields that differ', () => {
        expect(differences({id: 'a', count: 1, body: 'x'}, {id: 'a', count: 2, body: 'x'})).toEqual(['count']);
        expect(differences({id: 'a', taxon: {entity_id: 'SSA:1'}}, {id: 'a', taxon: {entity_id: 'SSA:2'}})).toEqual(['taxon']);
    });

    test('key order counts, since the files keep it', () => {
        expect(differences({id: 'a', url: null}, {url: null, id: 'a'})).toEqual(['(key order)']);
    });

    test('a field only one side has differs', () => {
        expect(differences({id: 'a', certainty: null}, {id: 'a'})).toEqual(['certainty']);
    });

    test('an occurrence id names its source; a native sighting is a bare uuid', () => {
        expect(sourceOf('maplify:236503')).toBe('maplify');
        expect(sourceOf('orcasound:bout_0312Vs7HxaVxyMlqmK1blR:SSA:0000900')).toBe('orcasound');
        expect(sourceOf('01977c2a-b313-77a9-8433-ffccbd56bf57')).toBe('native');
    });
});

// Which arms a build's changed inputs re-derive (Stelis ADR 0015, salish-9uu.8.1).
describe('armsFor', () => {
    test('a save changes the store\'s tables: the native arm alone', () => {
        expect(armsFor(['public.observations', 'public.observation_photos'])).toEqual({arms: ['native']});
    });

    test('two sources\' inputs: both arms, no more', () => {
        expect(armsFor(['orcasound.bouts', 'maplify_mirror.sightings'])).toEqual({arms: ['maplify', 'orcasound']});
    });

    test('an input every arm reads, or one unknown here, rebuilds everything, and is named', () => {
        expect(armsFor(['register.names'])).toEqual({all: 'register.names is read by every arm, or unknown here'});
        expect(armsFor(['public.observations', 'inaturalist_mirror.taxa'])).toEqual({all: 'inaturalist_mirror.taxa is read by every arm, or unknown here'});
        expect(armsFor(['public.observations', 'types.enums'])).toHaveProperty('all');
        expect(armsFor(['something.declared.later'])).toHaveProperty('all');
    });

    test('no list, or an empty one, is no basis: everything, and says which', () => {
        expect(armsFor(null)).toEqual({all: 'no list of changed inputs'});
        expect(armsFor([])).toEqual({all: 'an empty list of changed inputs'});
    });

    test('no input belongs to two arms', () => {
        const seen = new Map<string, string>();
        for (const source of SOURCES)
            for (const input of ARM_INPUTS[source]) {
                expect(seen.get(input), `${input} in ${seen.get(input)} and ${source}`).toBeUndefined();
                seen.set(input, source);
            }
    });

    // The map is checked against the SQL, not trusted: each input one arm claims names a
    // table (or the lookup over it) that the arm's view reads — directly, through the
    // shared helper views, or in the resolutions its TypeScript writer runs first — and
    // that no other arm's does. A view or writer that starts reading another arm's table
    // fails here, before a partial rebuild could leave its rows stale. Inputs with no table
    // of their own (the name guard's token) are the build's to vary, not the SQL's.
    // KNOWN BLIND SPOTS, stated rather than discovered: a read inside a macro body is not
    // followed (the macros here compute from their arguments and read nothing), nor is SQL a
    // writer imports from elsewhere (maplify-entities.ts's name index reads the register,
    // which every arm shares).
    const SQL_NAME: Record<string, string | null> = {
        'maplify_mirror.sightings': 'source_maplify_sightings',
        'maplify.collection_rule': 'maplify_collection',
        'maplify-names-hold': null,
        'inaturalist_mirror.observations': 'source_inaturalist_observations',
        'inaturalist_mirror.observation_photos': 'source_inaturalist_observation_photos',
        'happywhale.encounters': 'happywhale.encounters', 'happywhale.users': 'happywhale.users',
        'happywhale.individuals': 'happywhale.individuals', 'happywhale.species': 'happywhale.species',
        'happywhale.media': 'happywhale.media',
        'public.observations': 'public.observations', 'public.observation_photos': 'public.observation_photos',
        'public.contributors': 'public.contributors',
        'orcasound.bouts': 'source_acoustic_bouts', 'orcasound.bout_entities': 'source_acoustic_bout_entities',
    };

    const HELPERS = ['sources.sql', 'shared.sql', 'lookups.sql', 'maplify-collection.sql', 'extract.sql'];
    // the two arms whose views bind to tables a TypeScript writer resolves first: what it reads counts as the arm's
    const WRITERS: Partial<Record<Source, string>> = {maplify: 'maplify-entities.ts', inaturalist: 'inaturalist-scope.ts'};

    /** Every view (or CTE) a statement defines, and every relation it reads, by name. */
    function readGraph(sql: string): Map<string, Set<string>> {
        const graph = new Map<string, Set<string>>();
        // one fragment per definition: a `;` can sit inside a macro's body
        for (const statement of sql.split(/(?=CREATE OR REPLACE TEMP )/)) {
            const defined = [...statement.matchAll(/CREATE OR REPLACE TEMP VIEW (\w+)/g)].map(m => m[1]!);
            const reads = new Set([...statement.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi)].map(m => m[1]!));
            for (const name of defined) graph.set(name, new Set([...(graph.get(name) ?? []), ...reads]));
        }
        return graph;
    }

    /** What a view reads, through every view it reads: the tables at the bottom and the views on the way. */
    function reaches(graph: Map<string, Set<string>>, from: string, seen = new Set<string>()): Set<string> {
        for (const name of graph.get(from) ?? [])
            if (!seen.has(name)) { seen.add(name); reaches(graph, name, seen); }
        return seen;
    }

    test("each arm's inputs are read by its view, through the shared helpers too, and by no other arm's", async () => {
        const dir = new URL('./derive/', import.meta.url);
        const helpers = await Promise.all(HELPERS.map(f => readFile(new URL(f, dir), 'utf8')));
        const parts = parseArms(await readFile(new URL('occurrences.sql', dir), 'utf8'));
        const graph = readGraph([...helpers, ...SOURCES.map(s => parts.arms[s])].join(';\n'));
        for (const [source, file] of Object.entries(WRITERS) as [Source, string][]) {
            const code = await readFile(new URL(file, dir), 'utf8');
            const reads = [...code.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi)].map(m => m[1]!);
            graph.set(`${source}_occurrences`, new Set([...(graph.get(`${source}_occurrences`) ?? []), ...reads]));
        }
        const reads = Object.fromEntries(SOURCES.map(s => [s, reaches(graph, `${s}_occurrences`)])) as Record<Source, Set<string>>;
        for (const source of SOURCES)
            for (const input of ARM_INPUTS[source]) {
                expect(SQL_NAME, `${input} has no SQL name in this test`).toHaveProperty(input);
                const name = SQL_NAME[input];
                if (name === null || name === undefined) continue;
                expect(reads[source].has(name), `${source}'s view reads ${name}`).toBe(true);
                for (const other of SOURCES)
                    if (other !== source)
                        expect(reads[other].has(name), `${other}'s view must not read ${name}, which is ${source}'s`).toBe(false);
            }
    });

    test('occurrences.sql parts: a comment preamble, five arms each defining its own view, a shared tail', async () => {
        const parts = parseArms(await readFile(new URL('./derive/occurrences.sql', import.meta.url), 'utf8'));
        expect(parts.preamble).not.toMatch(/^CREATE/m);
        for (const source of SOURCES) {
            const views = [...parts.arms[source].matchAll(/CREATE OR REPLACE TEMP VIEW (\w+)/g)].map(m => m[1]);
            expect(views, `${source}'s section`).toEqual([`${source}_occurrences`]);
        }
        expect(parts.shared).toMatch(/CREATE SCHEMA IF NOT EXISTS build/);
        expect(parts.shared).toMatch(/TEMP MACRO occurrence_doc/);
        expect(parts.shared).not.toMatch(/INSERT INTO|CREATE OR REPLACE TABLE/);
    });

    test('a marker twice, an arm missing, or a statement above the first marker is a parse error, not a silently dropped section', () => {
        expect(() => parseArms('-- arm: native\nx;\n-- arm: native\ny;\n-- shared\nz;')).toThrow(/twice/);
        expect(() => parseArms('-- arm: native\nx;\n-- shared\nz;')).toThrow(/no '-- arm: maplify'/);
        expect(() => parseArms('-- arm: nowhere\nx;')).toThrow(/unknown arm/);
        expect(() => parseArms("SET TimeZone = 'UTC';\n-- arm: native\nx;")).toThrow(/would never run/);
    });

    test('the variable is newline-separated names; absent is null, not empty', () => {
        expect(changedInputs({})).toBeNull();
        expect(changedInputs({STELIS_CHANGED_INPUTS: ''})).toEqual([]);
        expect(changedInputs({STELIS_CHANGED_INPUTS: 'public.observations\npublic.contributors\n'}))
            .toEqual(['public.observations', 'public.contributors']);
    });
});

describe('compare-profile-links', () => {
    test('a document agrees with itself however it is spaced or its numbers written', () => {
        expect(unmatched([['{"a": 1, "b": 48.50}', 1]], [['{"a":1,"b":48.5}', 1]])).toEqual(new Map());
    });

    test('rows are a multiset: a document twice on one side and once on the other differs', () => {
        expect(unmatched([['{"a":1}', 2]], [['{"a":1}', 1]])).toEqual(new Map([['{"a":1}', 1]]));
        expect(unmatched([], [['{"a":1}', 1]])).toEqual(new Map([['{"a":1}', -1]]));
    });

    test('key order counts, since the pages read documents as written', () => {
        expect(unmatched([['{"a":1,"b":2}', 1]], [['{"b":2,"a":1}', 1]]).size).toBe(2);
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

// The port against Postgres on whatever this database holds: a migration that changes
// one of the views without changing its twin under derive/ fails here, if the data
// exercises the change. The build derives from its own mirrors (salish-xv35.9); here the
// mirrors are written from Postgres's tables, so the two derivations read the same rows.
describe.skipIf(!DSN)('the build derives what Postgres stores (local Supabase)', () => {
    test('snapshot, derive, compare: occurrences, their identifier candidates, the profile links', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'derive-occurrences-'));
        try {
            const snapshot = path.join(dir, 'snapshot.duckdb');
            await promisify(execFile)('node', [path.join(import.meta.dirname, 'snapshot.ts'), '--answers', snapshot], {
                env: {...process.env, SUPABASE_DB_URL: DSN},
            });
            // The reference tables are checked-in files, as in the build (decision 064);
            // reference.test.ts holds them equal to this database's.
            await promisify(execFile)('node', [path.join(import.meta.dirname, 'reference.ts'), snapshot]);
            const mirrors = await mirrorsFromSnapshot(snapshot, dir);
            expect((await deriveOccurrences(snapshot, mirrors, null)).arms).toBe('all');
            expect(await compare(snapshot)).toBe(true);
            // told the store's tables changed: the native arm re-derived over the same
            // rows, the others untouched, and the whole still agrees with Postgres
            expect((await deriveOccurrences(snapshot, mirrors, ['public.observations'])).arms).toEqual(['native']);
            expect(await compare(snapshot)).toBe(true);
            // the two arms that resolve into memory tables first, re-derived together
            expect((await deriveOccurrences(snapshot, mirrors, ['inaturalist_mirror.observations', 'maplify_mirror.sightings'])).arms)
                .toEqual(['maplify', 'inaturalist']);
            expect(await compare(snapshot)).toBe(true);
            await deriveIdentifierCandidates(snapshot);
            expect(await compareCandidates(snapshot)).toBe(true);
            // The catalogue's views over the register (salish-9uu.2.3), which the profile
            // links read, derived as the build derives them and checked against Postgres's.
            await deriveCatalogue(snapshot, mirrors.inaturalist);
            expect(await compareCatalogue(snapshot)).toBe(true);
            await deriveProfileLinks(snapshot, mirrors);
            expect(await compareProfileLinks(snapshot)).toBe(true);
            // The Darwin Core archive's relations (salish-xv35.9): the twins against
            // Postgres's dwc views, every column as text, as multisets.
            const unmatched = await withDwc(snapshot, mirrors, async conn => {
                const out: Record<string, number> = {};
                for (const view of ['occurrences', 'multimedia', 'export_coverage']) {
                    const differ = (a: string, b: string) => `SELECT count(*) FROM (
                        SELECT COLUMNS(*)::VARCHAR FROM ${a} EXCEPT ALL SELECT COLUMNS(*)::VARCHAR FROM ${b})`;
                    const ours = (await conn.runAndReadAll(differ(`pgdb.dwc.${view}`, `store.dwc.${view}`))).getRows()[0]![0];
                    const theirs = (await conn.runAndReadAll(differ(`store.dwc.${view}`, `pgdb.dwc.${view}`))).getRows()[0]![0];
                    out[view] = Number(ours) + Number(theirs);
                }
                return out;
            });
            expect(unmatched).toEqual({occurrences: 0, multimedia: 0, export_coverage: 0});
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    }, 120_000);
});
