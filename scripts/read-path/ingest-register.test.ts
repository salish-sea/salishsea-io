import { afterEach, describe, expect, test, vi } from 'vitest';

import { latestTag, REGISTER_TABLES } from './ingest-register.ts';

describe('latestTag (decision 064)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    const answering = (status: number, location: string | null) =>
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status, headers: location ? {location} : {}})));

    test('the tag releases/latest redirects to', async () => {
        answering(302, 'https://github.com/salish-sea/animals/releases/tag/2026.09.6');
        await expect(latestTag()).resolves.toBe('2026.09.6');
    });

    test('an answer that names no release is an error, never a guess', async () => {
        answering(200, null);
        await expect(latestTag()).rejects.toThrow(/without a release tag/);
        answering(302, 'https://github.com/salish-sea/animals/releases');
        await expect(latestTag()).rejects.toThrow(/without a release tag/);
    });
});

describe('REGISTER_TABLES', () => {
    test('the six tables the derivation reads, depth typed as Postgres types it', () => {
        expect(REGISTER_TABLES.map(t => t.table)).toEqual(
            ['entities', 'names', 'mappings', 'ancestor', 'deprecations', 'classification']);
        expect(REGISTER_TABLES.find(t => t.table === 'ancestor')!.select).toContain('CAST(depth AS INTEGER)');
    });
});
