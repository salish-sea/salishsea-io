import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FIXED_MTIME, writeZip, type ZipEntry } from './zip.ts';

/**
 * Unit surface for the deterministic-zip writer. Covers:
 *   - smoke: produces a non-empty file on disk
 *   - determinism: identical inputs ⇒ byte-identical bytes
 *   - entry order preservation
 *   - path-traversal rejection (six categories)
 *   - parent-directory creation
 *
 * Out of scope for this file: round-tripping the actual `meta.xml` /
 * `eml.xml` content — that integration lives in Plan 06's build.test.ts.
 */

const createdDirs: string[] = [];

afterEach(async () => {
    while (createdDirs.length > 0) {
        const dir = createdDirs.pop();
        if (dir === undefined) continue;
        await rm(dir, { force: true, recursive: true });
    }
});

async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dwca-zip-test-'));
    createdDirs.push(dir);
    return dir;
}

function randomZipPath(dir: string): string {
    return join(dir, `out-${randomUUID()}.zip`);
}

describe('FIXED_MTIME', () => {
    test('equals 2000-01-01T00:00:00Z', () => {
        expect(FIXED_MTIME.getTime()).toBe(946684800000);
        expect(FIXED_MTIME.toISOString()).toBe('2000-01-01T00:00:00.000Z');
    });
});

describe('writeZip smoke', () => {
    test('writes a non-empty file containing 2 entries', async () => {
        const dir = await makeTmpDir();
        const outPath = randomZipPath(dir);
        const entries: readonly ZipEntry[] = [
            { name: 'meta.xml', content: Buffer.from('<?xml version="1.0"?><meta/>') },
            { name: 'eml.xml', content: Buffer.from('<?xml version="1.0"?><eml/>') },
        ];
        await writeZip(outPath, entries);
        const s = await stat(outPath);
        expect(s.size).toBeGreaterThanOrEqual(50);
    });
});

describe('writeZip determinism', () => {
    test('identical inputs produce byte-identical output files', async () => {
        const dir = await makeTmpDir();
        const out1 = randomZipPath(dir);
        const out2 = randomZipPath(dir);
        const entries: readonly ZipEntry[] = [
            { name: 'meta.xml', content: Buffer.from('<meta/>') },
            { name: 'eml.xml', content: Buffer.from('<eml/>') },
            { name: 'occurrence.txt', content: Buffer.from('id\toccurrenceID\n1\tabc\n') },
            { name: 'multimedia.txt', content: Buffer.from('coreid\ttype\n1\tStillImage\n') },
        ];
        await writeZip(out1, entries);
        await writeZip(out2, entries);
        const buf1 = await readFile(out1);
        const buf2 = await readFile(out2);
        expect(Buffer.compare(buf1, buf2)).toBe(0);
    });
});

describe('writeZip entry order preservation', () => {
    test('entries appear in input order in the raw zip bytes', async () => {
        const dir = await makeTmpDir();
        const outPath = randomZipPath(dir);
        const entries: readonly ZipEntry[] = [
            { name: 'a.txt', content: Buffer.from('A') },
            { name: 'b.txt', content: Buffer.from('B') },
            { name: 'c.txt', content: Buffer.from('C') },
        ];
        await writeZip(outPath, entries);
        const raw = await readFile(outPath);
        // Each local-file-header starts with the signature PK\x03\x04; the
        // metadata path (filename) follows the header. We rely on the local
        // file header containing the literal filename verbatim — true for
        // ASCII names + default (no UTF-8 EFS) settings, which yazl uses for
        // pure-ASCII names.
        const idxA = raw.indexOf(Buffer.from('a.txt'));
        const idxB = raw.indexOf(Buffer.from('b.txt'));
        const idxC = raw.indexOf(Buffer.from('c.txt'));
        expect(idxA).toBeGreaterThanOrEqual(0);
        expect(idxB).toBeGreaterThan(idxA);
        expect(idxC).toBeGreaterThan(idxB);
    });
});

describe('writeZip path-traversal rejection', () => {
    const cases: readonly string[] = [
        '',
        '../escape.txt',
        'subdir/../../escape.txt',
        '/absolute.txt',
        '\\backslash.txt',
        'has\0null.txt',
    ];

    for (const bad of cases) {
        test(`rejects ${JSON.stringify(bad)}`, async () => {
            const dir = await makeTmpDir();
            const outPath = randomZipPath(dir);
            await expect(
                writeZip(outPath, [{ name: bad, content: Buffer.from('x') }]),
            ).rejects.toThrow(/Invalid zip entry name/);
        });
    }
});

describe('writeZip parent directory creation', () => {
    test('creates nested directories recursively', async () => {
        const dir = await makeTmpDir();
        const nested = join(dir, 'nested', 'subdir', 'test.zip');
        await writeZip(nested, [
            { name: 'a.txt', content: Buffer.from('hello') },
        ]);
        const s = await stat(nested);
        expect(s.isFile()).toBe(true);
        expect(s.size).toBeGreaterThan(0);
    });
});
