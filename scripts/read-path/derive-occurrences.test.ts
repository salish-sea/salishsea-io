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
import { deriveOccurrences } from './derive-occurrences.ts';
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
            await deriveOccurrences(snapshot, mirrors);
            expect(await compare(snapshot)).toBe(true);
            await deriveIdentifierCandidates(snapshot);
            expect(await compareCandidates(snapshot)).toBe(true);
            // The catalogue's views over the register (salish-9uu.2.3), which the profile
            // links read, derived as the build derives them and checked against Postgres's.
            await deriveCatalogue(snapshot, mirrors);
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
