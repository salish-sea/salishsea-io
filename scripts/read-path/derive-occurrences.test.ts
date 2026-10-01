import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

import { compare, differences, sourceOf } from './compare-occurrences.ts';
import { deriveOccurrences } from './derive-occurrences.ts';

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

const DSN = process.env['SUPABASE_DB_URL'];

// The port against Postgres on whatever this database holds: a migration that changes
// one of the five views without changing derive/occurrences.sql fails here, if the data
// exercises the change, before it can fail the build's gate in production.
describe.skipIf(!DSN)('the build derives what Postgres stores (local Supabase)', () => {
    test('snapshot, derive, compare', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'derive-occurrences-'));
        try {
            const snapshot = path.join(dir, 'snapshot.duckdb');
            await promisify(execFile)('node', [path.join(import.meta.dirname, 'snapshot.ts'), snapshot], {
                env: {...process.env, SUPABASE_DB_URL: DSN},
            });
            await deriveOccurrences(snapshot);
            expect(await compare(snapshot)).toBe(true);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    }, 120_000);
});
