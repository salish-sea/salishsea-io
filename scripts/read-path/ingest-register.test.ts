import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { CATALOGUE_DIR } from './catalogue.ts';
import { candidateProblems, latestTag, REGISTER_TABLES } from './ingest-register.ts';

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
            ['entities', 'names', 'mappings', 'ancestor', 'deprecations', 'classification', 'vitals', 'current_status',
                'status_dates', 'taxon_ancestor', 'group_ranks', 'parentage', 'matriarchs']);
        expect(REGISTER_TABLES.find(t => t.table === 'vitals')!.file).toBe('entities');
        expect(REGISTER_TABLES.find(t => t.table === 'status_dates')!.file).toBe('current_status');
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


describe('a candidate edition is checked against the catalogue task before it is adopted (decision 123)', () => {
    // The columns each published file has that the build reads (REGISTER_TABLES), and an edition's rows.
    const FILES: Record<string, [string, string[]]> = {
        entities: ['data', ['entity_id', 'kind', 'rank', 'label', 'sex', 'born']],
        names: ['data', ['entity_id', 'name', 'type', 'language']],
        mappings: ['data', ['subject_id', 'predicate_id', 'object_id']],
        ancestor: ['dist', ['entity_id', 'ancestor_id', 'depth', 'ancestor_kind']],
        deprecations: ['data', ['entity_id', 'replaced_by']],
        classification: ['dist', ['entity_id', 'label', 'taxon_id', 'scientific_name', 'taxon_rank', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus']],
        current_status: ['dist', ['entity_id', 'status', 'effective']],
        taxon_ancestor: ['dist', ['taxon_id', 'ancestor_id', 'depth', 'ancestor_rank', 'ancestor_name']],
        parentage: ['data', ['child_id', 'parent_id', 'role']],
        matriarchs: ['data', ['matriline_id', 'matriarch_id']],
    };
    type Rows = Record<string, string[][]>;
    const writeEdition = async (dir: string, rows: Rows) => {
        for (const [table, [sub, columns]] of Object.entries(FILES)) {
            await mkdir(path.join(dir, sub), {recursive: true});
            const lines = [columns.join('\t'), ...(rows[table] ?? []).map(r => r.join('\t'))];
            await writeFile(path.join(dir, sub, `${table}.tsv`), lines.join('\n') + '\n');
        }
    };
    const whale = (id: string, label: string) => ['SSA:' + id, 'individual', '', label, '', ''];
    const BIGGS: Rows = {
        entities: [['SSA:0000002', 'group', 'ecotype', "Bigg's", '', ''], whale('0011000', 'T100'), whale('0011001', 'T100A')],
        ancestor: [['SSA:0011000', 'SSA:0000002', '1', 'group'], ['SSA:0011001', 'SSA:0000002', '1', 'group']],
        parentage: [['SSA:0011001', 'SSA:0011000', 'mother']],
        current_status: [['SSA:0011000', 'alive', ''], ['SSA:0011001', 'alive', '']],
    };

    /** A catalogue directory whose files hold a nickname on T100 and a superseded alternate code T100Z for T100A. */
    async function catalogueDir(parent: string): Promise<string> {
        const dir = path.join(parent, 'catalogue');
        await mkdir(dir);
        const head = (cols: string[]) => cols.join('\t') + '\n';
        await writeFile(path.join(dir, 'designations.tsv'),
            head(['id', 'entity_id', 'code', 'scheme', 'status', 'is_primary', 'in_catalog', 'authority_id'])
            + '1\tSSA:0011001\tT100Z\tbc_wa\tsuperseded\tfalse\ttrue\t\n');
        await writeFile(path.join(dir, 'nicknames.tsv'),
            head(['id', 'entity_id', 'name', 'status', 'namer_id', 'named_year', 'theme']) + '1\tSSA:0011000\tMoon\tofficial\t1\t\t\n');
        for (const file of ['parties.tsv', 'haulouts.tsv']) await copyFile(path.join(CATALOGUE_DIR, file), path.join(dir, file));
        return dir;
    }

    const problemsOf = async (rows: Rows) => {
        const parent = await mkdtemp(path.join(tmpdir(), 'ingest-'));
        try {
            await writeEdition(path.join(parent, 'edition'), rows);
            return (await candidateProblems(path.join(parent, 'edition'), await catalogueDir(parent))).join('\n');
        } finally {
            await rm(parent, {recursive: true, force: true});
        }
    };

    test('an edition that only adds an unrelated whale is accepted', async () => {
        expect(await problemsOf({
            ...BIGGS,
            entities: [...BIGGS.entities!, whale('0011999', 'T199')],
            ancestor: [...BIGGS.ancestor!, ['SSA:0011999', 'SSA:0000002', '1', 'group']],
            current_status: [...BIGGS.current_status!, ['SSA:0011999', 'alive', '']],
        })).toBe('');
    });

    test('an edition that deprecates a whale a nickname names is refused', async () => {
        expect(await problemsOf({...BIGGS, deprecations: [['SSA:0011000', 'SSA:0011001']]}))
            .toMatch(/nicknames.tsv names an entity that is no generated animal or group \(id\/entity_id\): 1\/SSA:0011000/);
    });

    test('an edition that relabels a whale as a code a checked-in row holds is refused, though every row still resolves', async () => {
        const relabelled = {...BIGGS, entities: [BIGGS.entities![0]!, BIGGS.entities![1]!, whale('0011001', 'T100Z')]};
        expect(await problemsOf(relabelled)).toMatch(/designations repeats \(code\)/);
    });

    test('an edition with no life statuses is refused', async () => {
        expect(await problemsOf({...BIGGS, current_status: []})).toMatch(/register.current_status is empty/);
    });
});
