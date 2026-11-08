import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { CATALOGUE_VIEWS, deriveCatalogue } from './derive-catalogue.ts';
import { deriveIdentifierCandidates } from './derive-identifier-candidates.ts';
import { readFile } from 'node:fs/promises';
import { ARM_INPUTS, armsFor, changedInputs, deriveOccurrences, parseArms, SOURCES, type Source } from './derive-occurrences.ts';
import { deriveProfileLinks } from './derive-profile-links.ts';
import { mirrorsFromSnapshot } from './derive/mirrors-from-snapshot.ts';
import { withDwc } from './dwca.ts';
import { fixtureSnapshot } from './twin-fixture.ts';
import { readsText, REMARKS, TEXTS } from './derive/readings.ts';

/** Run `use` on a read-only connection to the snapshot, closed after. */
async function withStore<T>(snapshot: string, use: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        return await use(conn);
    } finally { conn.closeSync(); db.closeSync(); }
}

/**
 * The documents a query returns, sorted, each parsed and written out again as the day
 * files write it: spacing and how a number is written ("48.0" or "48") don't count, but
 * key order and every value do. `omit` drops keys the expected rows don't carry.
 */
async function documents(conn: DuckDBConnection, sql: string, omit: string[] = []): Promise<string[]> {
    return (await conn.runAndReadAll(sql)).getRows().map(([text]) => {
        const doc = JSON.parse(text as string) as Record<string, unknown>;
        for (const key of omit) delete doc[key];
        return JSON.stringify(doc);
    }).sort();
}

/**
 * The rows one query returns and the other doesn't, counting duplicates, each labelled
 * with its side; none when the two agree. Every column is compared as text.
 */
async function rowsOnOneSide(conn: DuckDBConnection, expected: string, derived: string) {
    const text = (sql: string) => `SELECT COLUMNS(*)::VARCHAR FROM (${sql})`;
    return (await conn.runAndReadAll(`
        SELECT 'expected only' AS side, * FROM (${text(expected)} EXCEPT ALL ${text(derived)})
        UNION ALL
        SELECT 'derived only', * FROM (${text(derived)} EXCEPT ALL ${text(expected)})
        ORDER BY ALL`)).getRowObjectsJson();
}

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
        // a new basemap version's water regions move every arm's places (salish-fwyt.2)
        expect(armsFor(['water-regions.json'])).toEqual({all: 'water-regions.json is read by every arm, or unknown here'});
        // and so does a change to the landmarks, or to the list that places them (decision 100)
        expect(armsFor(['reference/landmarks.tsv'])).toHaveProperty('all');
        expect(armsFor(['places-osm.json'])).toHaveProperty('all');
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
        'inaturalist_mirror.identifications': 'source_inaturalist_identifications',
        'inaturalist_mirror.comments': 'inaturalist_mirror.comments',
        'public.observations': 'public.observations', 'public.observation_photos': 'public.observation_photos',
        'public.contributors': 'public.contributors',
        'orcasound.bouts': 'source_acoustic_bouts', 'orcasound.bout_entities': 'source_acoustic_bout_entities', 'public.hydrophones': 'public.hydrophones',
    };

    const HELPERS = ['sources.sql', 'shared.sql', 'lookups.sql', 'maplify-collection.sql'];
    // the two arms whose views bind to tables a TypeScript writer resolves first: what it reads counts as the arm's
    const WRITERS: Partial<Record<Source, string>> = {maplify: 'maplify-entities.ts', inaturalist: 'inaturalist-scope.ts'};

    /** Every view (or CTE) a statement defines, and every relation it reads, by name. */
    function readGraph(sql: string): Map<string, Set<string>> {
        const graph = new Map<string, Set<string>>();
        // one fragment per definition: a `;` can sit inside a macro's body
        // A table an arm writes into `memory` first, as the iNaturalist arm's confirmations
        // are, counts as a view under the name the arm reads it by.
        for (const statement of sql.split(/(?=CREATE OR REPLACE (?:TEMP |TABLE memory\.))/)) {
            const defined = [
                ...[...statement.matchAll(/CREATE OR REPLACE TEMP VIEW (\w+)/g)].map(m => m[1]!),
                ...[...statement.matchAll(/CREATE OR REPLACE TABLE memory\.main\.(\w+)/g)].map(m => `memory.${m[1]!}`),
            ];
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
        // each text-reading arm's texts, which derive/readings.ts reads for it into memory.reading
        for (const source of SOURCES) {
            if (!readsText(source)) continue;
            const reads = [...TEXTS[source].matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi)].map(m => m[1]!);
            graph.set(`${source}_occurrences`, new Set([...(graph.get(`${source}_occurrences`) ?? []), ...reads]));
        }
        // and the remarks on iNaturalist's observations, which it reads into memory.remark_claims
        const remarks = [...REMARKS.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi)].map(m => m[1]!);
        graph.set('inaturalist_occurrences', new Set([...(graph.get('inaturalist_occurrences') ?? []), ...remarks]));
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

    test("a remark adds the codes the observer doesn't name, present or absent (decision 106)", async () => {
        const parts = parseArms(await readFile(new URL('./derive/occurrences.sql', import.meta.url), 'utf8'));
        const db = await DuckDBInstance.create(':memory:');
        const conn = await db.connect();
        try {
            await conn.run(parts.shared.split(/^-- --- The store/m)[0]!);
            const code = (c: string, origin = 'comment', id = 1) => `{'code': '${c}', 'origin': '${origin}', 'origin_id': ${id}}`;
            const claim = (c: string, presence: string) => `{'code': '${c}', 'presence': '${presence}', 'certainty': 'certain'}`;
            const added = async (codes: string, claims: string, absent = 'NULL') => (await conn.runAndReadAll(
                `SELECT list_transform(remark_codes(${codes}, ${claims}, ${absent}), lambda x: x.code)`)).getRows()[0]![0];
            // the observer names T46s and says T46D was absent; a comment names all three
            expect(await added(`[${code('T46s')}, ${code('T46D')}, ${code('T46B')}]`,
                `[${claim('T46s', 'present')}, ${claim('T46D', 'absent')}]`)).toEqual({items: ['T46B']});
            // no description, or no remarks
            expect(await added(`[${code('T19B', 'identification')}]`, 'NULL')).toEqual({items: ['T19B']});
            expect(await added('NULL', `[${claim('T46s', 'present')}]`)).toEqual({items: []});
            // no description, but the observer's own comment says T46D was absent
            expect(await added(`[${code('T46D')}, ${code('T46B')}]`, 'NULL', `[${code('T46D')}]`)).toEqual({items: ['T46B']});
            // and that absence is the occurrence's, unless the description names T46D either way
            const absent = async (gone: string, claims: string) => (await conn.runAndReadAll(
                `SELECT list_transform(remark_absent(${gone}, ${claims}), lambda x: x.code)`)).getRows()[0]![0];
            expect(await absent(`[${code('T46D', 'comment', 5)}]`, 'NULL')).toEqual({items: ['T46D']});
            expect(await absent(`[${code('T46D', 'comment', 5)}]`, `[${claim('T46D', 'present')}]`)).toEqual({items: []});
            expect(await absent('NULL', `[${claim('T46s', 'present')}]`)).toEqual({items: []});
        } finally { conn.closeSync(); db.closeSync(); }
    });

    test('a code only possibly there is marked with a ?, and an absent code is kept apart (decision 109)', async () => {
        const parts = parseArms(await readFile(new URL('./derive/occurrences.sql', import.meta.url), 'utf8'));
        const db = await DuckDBInstance.create(':memory:');
        const conn = await db.connect();
        try {
            await conn.run(parts.shared.split(/^-- --- The store/m)[0]!);
            const claim = (c: string, presence: string, certainty = 'certain') => `{'code': '${c}', 'presence': '${presence}', 'certainty': '${certainty}'}`;
            const read = async (macro: string, claims: string) =>
                (await conn.runAndReadAll(`SELECT ${macro}(${claims})`)).getRows()[0]![0];
            // "T46s (-D), maybe T65A, likely T137A": probable shows plain, possible with a ?
            const claims = `[${claim('T46s', 'present')}, ${claim('T65A', 'present', 'possible')}, ${claim('T137A', 'present', 'probable')}, ${claim('T46D', 'absent')}]`;
            expect(await read('reading_identifiers', claims)).toEqual({items: ['T46s', 'T65A?', 'T137A']});
            expect(await read('reading_absent', claims)).toEqual({items: ['T46D']});
            // a code named both ways is present, and only present
            const both = `[${claim('T46D', 'present')}, ${claim('T46D', 'absent')}]`;
            expect(await read('reading_identifiers', both)).toEqual({items: ['T46D']});
            expect(await read('reading_absent', both)).toEqual({items: []});
            expect((await conn.runAndReadAll(`SELECT list_transform(report_claims(${both}), lambda x: x.presence)`)).getRows()[0]![0])
                .toEqual({items: ['present']});
            // no reading is none of them
            expect(await read('reading_identifiers', 'NULL')).toEqual({items: []});
            expect(await read('reading_absent', 'NULL')).toEqual({items: []});
        } finally { conn.closeSync(); db.closeSync(); }
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

// Every derivation over the fixture (fixtures/twins/README.md, twin-fixture.ts), against the
// rows it should derive, which the fixture holds beside its inputs: a change to a derivation
// under derive/ that changes what it derives from these rows fails here. The build derives
// from its own mirrors (salish-xv35.9); here the mirrors are written from the fixture's
// source tables (derive/mirrors-from-snapshot.ts).
describe('the derivations over the fixture', () => {
    test('derive and check: occurrences, their identifier candidates, the catalogue, the profile links, the archive', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'derive-occurrences-'));
        try {
            const snapshot = path.join(dir, 'snapshot.duckdb');
            await fixtureSnapshot(snapshot);
            // The reference tables are checked-in files, as in the build (decision 064).
            await promisify(execFile)('node', [path.join(import.meta.dirname, 'reference.ts'), snapshot]);
            const mirrors = await mirrorsFromSnapshot(snapshot, dir);
            // The occurrences against snapshot.occurrences. The expected rows don't carry the
            // keys asserted on their own below: what each text names (`pods`, `absent`), where
            // each sighting was (`place`, `landmark`), and what people said on it (`activity`,
            // `identified_as`).
            const expectOccurrences = () => withStore(snapshot, async conn => expect(
                await documents(conn, 'SELECT doc FROM store.build.occurrences',
                    ['place', 'landmark', 'pods', 'activity', 'identified_as', 'absent']))
                .toEqual(await documents(conn, 'SELECT doc FROM store.snapshot.occurrences')));
            expect((await deriveOccurrences(snapshot, mirrors, null)).arms).toBe('all');
            await expectOccurrences();
            // Every document says which pods its text names (decision 105): one text here names
            // one ("J35 and J47 with Ls"), and the key is in jsonb's order, after the body.
            {
                await withStore(snapshot, async conn => {
                    const docs = (await conn.runAndReadAll('SELECT doc FROM store.build.occurrences')).getRows()
                        .map(([doc]) => JSON.parse(doc as string) as Record<string, unknown>);
                    expect(docs.length).toBeGreaterThan(0);
                    // and one comment, on 9000001, names J pod, which joins that observation's (decision 106)
                    expect(docs.filter(doc => (doc['pods'] as string[]).length)
                        .map(doc => [doc['id'], doc['pods']]).sort()).toEqual([['inaturalist:9000001', ['J']], ['maplify:acartia:13', ['L']]]);
                    // What people said on an iNaturalist observation, as its card shows it (decision
                    // 107): its identifications grouped by taxon, and its comments and remarks, oldest
                    // first. Not the hidden identification (6000005) or comment (8000003), the
                    // withdrawn identification (6000006), nor what deleted accounts wrote (6000012,
                    // 8000002). The observer's own comment says so; a comment's author is their
                    // display name, else their login.
                    const said = docs.find(doc => doc['id'] === 'inaturalist:9000002')!;
                    expect(said['identified_as']).toEqual([{taxon: 'Humpback whale', people: 1}, {taxon: 'Baleen Whales', people: 1}]);
                    expect(said['activity']).toEqual([
                        {kind: 'identification', id: 6000004, at: '2026-09-12T16:13:00+00:00', author: 'Synthetic Identifier',
                         by_observer: false, taxon: 'Baleen Whales', body: 'T137s, I think'},
                        {kind: 'comment', id: 8000001, at: '2026-09-12T17:15:00+00:00', author: 'Synthetic Identifier',
                         by_observer: false, taxon: null, body: 'Looks like T137B to me, with T137A nearby'},
                        {kind: 'comment', id: 8000005, at: '2026-09-12T19:00:00+00:00', author: 'synthetic_observer',
                         by_observer: true, taxon: null, body: 'T137s (-B)'},
                    ]);
                    // and no other source has any
                    expect(docs.filter(doc => !String(doc['id']).startsWith('inaturalist:'))
                        .every(doc => (doc['activity'] as unknown[]).length === 0 && (doc['identified_as'] as unknown[]).length === 0)).toBe(true);
                    for (const doc of docs) {
                        const keys = Object.keys(doc);
                        expect(keys[keys.indexOf('body') + 1]).toBe('pods');
                    }
                });
            }
            // told the store's tables changed: the native arm re-derived over the same
            // rows, the others untouched, and the whole still as expected
            expect((await deriveOccurrences(snapshot, mirrors, ['public.observations'])).arms).toEqual(['native']);
            await expectOccurrences();
            // the two arms that resolve into memory tables first, re-derived together
            expect((await deriveOccurrences(snapshot, mirrors, ['inaturalist_mirror.observations', 'maplify_mirror.sightings'])).arms)
                .toEqual(['maplify', 'inaturalist']);
            await expectOccurrences();
            // Given the water regions (salish-fwyt.2), each document names the one its point
            // is in, and only that, and the rest of each document is unchanged. One region
            // over the Salish Sea stands in for the basemap's list.
            const regions = path.join(dir, 'water-regions.json');
            const [w, s, e, n] = [-125.5, 47, -122, 50.5];
            await writeFile(regions, JSON.stringify({features: [{properties: {name: 'The Sea'},
                geometry: {type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}}]}));
            const places = () => withStore(snapshot, async conn => (await conn.runAndReadAll(`
                SELECT count(*) FILTER (doc->>'place' = 'The Sea'),
                       count(*) FILTER (location.lon BETWEEN ${w} AND ${e} AND location.lat BETWEEN ${s} AND ${n}),
                       count(*) FILTER (json_exists(doc, '$.place'))
                FROM store.build.occurrences`)).getRows()[0]!.map(Number));
            const [, inside, total] = await places();
            expect(inside).toBeGreaterThan(0);
            expect((await deriveOccurrences(snapshot, mirrors, null, regions)).arms).toBe('all');
            expect(await places()).toEqual([inside, inside, total]);
            await expectOccurrences();
            // one arm re-derived: the others keep the places they were given
            await deriveOccurrences(snapshot, mirrors, ['public.observations'], regions);
            expect(await places()).toEqual([inside, inside, total]);
            // Given the landmarks too (decision 100), a document with a place names the one
            // within 5 km of its point, and the rest of each document is unchanged. A point of
            // land at one occurrence's own position stands for the list.
            const query = (sql: string) => withStore(snapshot, async conn => (await conn.runAndReadAll(sql)).getRows());
            const [id, lon, lat] = (await query(`SELECT id, location.lon, location.lat FROM store.build.occurrences
                WHERE doc->>'place' = 'The Sea' ORDER BY id LIMIT 1`))[0] as [string, number, number];
            const landmarksTsv = path.join(dir, 'landmarks.tsv');
            await writeFile(landmarksTsv, `name\tkind\tsource\tlon\tlat\treports\tsays\nHere Point\tpoint\tgazetteers\t${lon}\t${lat}\t1\tHere\n`);
            const osm = path.join(dir, 'places-osm.json');
            await writeFile(osm, JSON.stringify({columns: ['name', 'kind', 'lon', 'lat', 'zoom', 'other_names'], places: []}));
            await deriveOccurrences(snapshot, mirrors, null, regions, {list: landmarksTsv, osm});
            const [here, far, keyed] = (await query(`
                SELECT count(*) FILTER (id = '${id}' AND (doc->>'landmark') = 'Here'),
                       count(*) FILTER ((doc->>'landmark') = 'Here' AND abs(location.lat - ${lat}) > 0.05),
                       count(*) FILTER (json_exists(doc, '$.landmark'))
                FROM store.build.occurrences`))[0]!.map(Number);
            expect([here, far, keyed]).toEqual([1, 0, total]);
            await expectOccurrences();
            // The identifier candidates against derived.occurrence_identifier_candidates, in
            // the columns it has.
            await deriveIdentifierCandidates(snapshot);
            const columns = 'occurrence_id, code, individual_id, social_group_id, observed_at, location_lon, location_lat, is_present, certainty';
            expect(await withStore(snapshot, conn => rowsOnOneSide(conn,
                `SELECT ${columns} FROM store.derived.occurrence_identifier_candidates`,
                `SELECT ${columns} FROM store.build.occurrence_identifier_candidates`))).toEqual([]);
            // Where each iNaturalist candidate was read (salish-4s42, decision 106), which the
            // expected rows don't carry. 9000001's T137A is its observer's, though a comment
            // names it too. 9000002 has no description. Its observer commented "T137s (-B)",
            // so T137s is theirs and T137B was absent, which outweighs another person's
            // comment naming T137B and T137A; an identification's remark naming T137s again
            // adds nothing. A deleted account's comment, a hidden one and a withdrawn
            // identification's remark name animals too, and count for nothing. T137B is a
            // candidate all the same, one that says it was absent, read from the observer's
            // comment (decision 109).
            expect(await query(`SELECT occurrence_id, code, origin, origin_id, by_observer, is_present
                FROM store.build.occurrence_identifier_candidates
                WHERE occurrence_id LIKE 'inaturalist:%' ORDER BY occurrence_id, code`)).toEqual([
                ['inaturalist:9000001', 'T137A', 'report', null, true, true],
                ['inaturalist:9000001', 'T137B', 'report', null, true, true],
                ['inaturalist:9000002', 'T137A', 'comment', 8000001n, false, true],
                ['inaturalist:9000002', 'T137B', 'comment', 8000005n, true, false],
                ['inaturalist:9000002', 'T137s', 'comment', 8000005n, true, true],
            ]);
            // every other source's candidates are their reports'
            expect(await query(`SELECT DISTINCT origin, origin_id IS NULL, by_observer
                FROM store.build.occurrence_identifier_candidates WHERE occurrence_id NOT LIKE 'inaturalist:%'`))
                .toEqual([['report', true, true]]);
            // and they are the occurrence's own identifiers too, which its card and the map
            // label show: the observer's first, then other people's, in the order read
            expect(await query(`SELECT identifiers FROM store.build.occurrences WHERE id = 'inaturalist:9000002'`))
                .toEqual([[{items: ['T137s', 'T137A']}]]);
            // and the absent ones are the document's `absent` (decision 109): the native
            // sighting's "T137s (-B) nearby, possibly T65A2" names T137B as absent and T65A2
            // with a '?', and 9000002's observer's comment "T137s (-B)" does the same
            expect(await query(`SELECT id, CAST(json_extract(doc, '$.absent') AS VARCHAR[])
                FROM store.build.occurrences WHERE json_array_length(json_extract(doc, '$.absent')) > 0 ORDER BY id`))
                .toEqual([['00000000-0000-4000-a000-000000000002', {items: ['T137B']}], ['inaturalist:9000002', {items: ['T137B']}]]);
            // The catalogue's views over the register (salish-9uu.2.3), which the profile
            // links read, derived as the build derives them: each snapshot.<view> against
            // snapshot.<view>_answer.
            await deriveCatalogue(snapshot, mirrors.inaturalist);
            await withStore(snapshot, async conn => {
                for (const view of CATALOGUE_VIEWS)
                    expect(await documents(conn, `SELECT doc FROM store.snapshot.${view}`), view)
                        .toEqual(await documents(conn, `SELECT doc FROM store.snapshot.${view}_answer`));
            });
            // The profile links: each build.<view> against snapshot.<view>.
            await deriveProfileLinks(snapshot, mirrors);
            await withStore(snapshot, async conn => {
                for (const view of ['individual_occurrences', 'group_occurrences', 'ecotype_occurrences', 'haulout_occurrences'])
                    expect(await documents(conn, `SELECT doc FROM store.build.${view}`), view)
                        .toEqual(await documents(conn, `SELECT doc FROM store.snapshot.${view}`));
            });
            // The Darwin Core archive's relations (salish-xv35.9): each against the fixture's
            // dwc.<view>, every column as text.
            const unexpected = await withDwc(snapshot, mirrors, async conn => {
                const out: Record<string, unknown[]> = {};
                for (const view of ['occurrences', 'multimedia', 'export_coverage'])
                    out[view] = await rowsOnOneSide(conn, `SELECT * FROM store.dwc.${view}`, `SELECT * FROM pgdb.dwc.${view}`);
                return out;
            });
            expect(unexpected).toEqual({occurrences: [], multimedia: [], export_coverage: []});
            // A contributor who hasn't agreed to the terms of use (#739): their sightings and
            // photos stay out of the archive, counted as withheld, which the guard accepts.
            {
                const db = await DuckDBInstance.create(':memory:');
                const conn = await db.connect();
                try {
                    await conn.run(`ATTACH '${snapshot}' AS store`);
                    await conn.run('UPDATE store.public.contributors SET terms_version = NULL');
                } finally { conn.closeSync(); db.closeSync(); }
            }
            const withheld = await withDwc(snapshot, mirrors, async conn => (await conn.runAndReadAll(`
                SELECT (SELECT count(*) FROM pgdb.dwc.occurrences WHERE "occurrenceID" LIKE 'salishsea:%'),
                       (SELECT count(*) FROM pgdb.dwc.multimedia),
                       (SELECT no_agreement FROM pgdb.dwc.export_coverage WHERE branch = 'native'),
                       (SELECT exported_rows FROM pgdb.dwc.export_coverage WHERE branch = 'maplify')`)).getRows()[0]!.map(Number));
            expect(withheld).toEqual([0, 0, 2, 5]);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    }, 120_000);
});
