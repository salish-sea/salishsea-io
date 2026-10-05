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
    test('the tables the derivations read, depth typed as Postgres types it', () => {
        expect(REGISTER_TABLES.map(t => t.table)).toEqual(
            ['entities', 'names', 'mappings', 'ancestor', 'deprecations', 'classification', 'vitals', 'current_status']);
        expect(REGISTER_TABLES.find(t => t.table === 'vitals')!.file).toBe('entities');
        expect(REGISTER_TABLES.find(t => t.table === 'ancestor')!.select).toContain('CAST(depth AS INTEGER)');
    });
});

describe('latestTag classifies what fails (decision 042)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    test('no connection, or GitHub erroring, is transient: a source outage, not our build stopping', async () => {
        const { isTransientUpstream } = await import('../ingest/retry.ts');
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
        await expect(latestTag().catch(e => isTransientUpstream(e))).resolves.toBe(true);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status: 503})));
        await expect(latestTag().catch(e => isTransientUpstream(e))).resolves.toBe(true);
    });

    test('an answer GitHub meant, that names no release, is a defect', async () => {
        const { isTransientUpstream } = await import('../ingest/retry.ts');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {status: 200})));
        await expect(latestTag().catch(e => isTransientUpstream(e))).resolves.toBe(false);
    });
});
