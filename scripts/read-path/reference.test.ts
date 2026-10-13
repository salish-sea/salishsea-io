import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, test } from 'vitest';

import { REFERENCE, REFERENCE_DIR, loadReference } from './reference.ts';

async function loaded<T>(dir: string, read: (q: (sql: string) => Promise<unknown[][]>) => Promise<T>): Promise<T> {
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    try {
        await loadReference(conn, 'memory', dir);
        return await read(async sql => (await conn.runAndReadAll(sql)).getRows());
    } finally {
        conn.closeSync();
    }
}

describe('reference data (decision 064)', () => {
    test('every file loads, typed, under the name the derivation joins on', async () => {
        const counts = await loaded(REFERENCE_DIR, async q => {
            const out: Record<string, number> = {};
            for (const ref of REFERENCE) out[ref.table] = Number((await q(`SELECT count(*) FROM memory.${ref.table}`))[0]![0]);
            return out;
        });
        for (const ref of REFERENCE) expect(counts[ref.table], ref.file).toBeGreaterThan(0);
    });

    test('whitespace is kept exactly, and an empty field is a null', async () => {
        const [spaced, nulls] = await loaded(REFERENCE_DIR, async q => [
            await q(`SELECT match_value FROM memory.maplify.collection_rule WHERE match_value LIKE ' %'`),
            await q(`SELECT count(*) FROM memory.public.collections WHERE organization_id IS NULL`),
        ]);
        expect(spaced).toEqual([[' Orca Network']]);
        expect(Number(nulls[0]![0])).toBeGreaterThan(0);
    });

    test('an enum type the derivation does not read, or a missing one, is refused', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'reference-'));
        try {
            for (const ref of REFERENCE) await copyFile(path.join(REFERENCE_DIR, ref.file), path.join(dir, ref.file));
            const enums = path.join(dir, 'enums.tsv');
            await writeFile(enums, (await readFile(enums, 'utf8')).replaceAll('public.sex\t', 'public.sx\t'));
            await expect(loaded(dir, async () => null)).rejects.toThrow(/expected the types/);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    test("a file whose header doesn't name the declared columns in order is refused", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'reference-'));
        try {
            for (const ref of REFERENCE) await copyFile(path.join(REFERENCE_DIR, ref.file), path.join(dir, ref.file));
            const file = path.join(dir, 'providers.tsv');
            const [, ...body] = (await readFile(file, 'utf8')).split('\n');
            await writeFile(file, ['id\tname\tslug', ...body].join('\n'));
            await expect(loaded(dir, async () => null)).rejects.toThrow(/its header is id, name, slug/);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    test('a hydrophone listed twice is refused, since each of its bouts would come out twice', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'reference-'));
        try {
            for (const ref of REFERENCE) await copyFile(path.join(REFERENCE_DIR, ref.file), path.join(dir, ref.file));
            const file = path.join(dir, 'hydrophones.tsv');
            const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
            await writeFile(file, [...lines, lines[1]!].join('\n') + '\n');
            await expect(loaded(dir, async () => null)).rejects.toThrow(/appears twice/);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    test('a hydrophone without a range is refused, since its bouts would have no ring', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'reference-'));
        try {
            for (const ref of REFERENCE) await copyFile(path.join(REFERENCE_DIR, ref.file), path.join(dir, ref.file));
            const file = path.join(dir, 'hydrophones.tsv');
            const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
            lines[1] = lines[1]!.replace(/\t\d+$/, '\t');
            await writeFile(file, lines.join('\n') + '\n');
            await expect(loaded(dir, async () => null)).rejects.toThrow(/hearing_range_m above zero/);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });

    test('a file with a value its column cannot hold is refused, not loaded', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'reference-'));
        try {
            for (const ref of REFERENCE) await copyFile(path.join(REFERENCE_DIR, ref.file), path.join(dir, ref.file));
            await writeFile(path.join(dir, 'providers.tsv'), 'id\tslug\tname\none\tdirect\tSalishSea.io Direct\n');
            await expect(loaded(dir, async () => null)).rejects.toThrow();
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
});
