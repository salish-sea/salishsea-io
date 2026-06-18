import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    AlignmentError,
    assertFieldAlignment,
    assertNonZeroRows,
    assertNoZeroByteFile,
    type CountConnection,
    type PgColumn,
} from './assertions.ts';

/**
 * DWCA-02 runtime guardrail unit surface. Validates the structural-diff
 * shape that `build.ts` (Plan 05) surfaces on F-02 drift, plus the two
 * zero-result guards.
 *
 * No DuckDB connection is required: `assertNonZeroRows` is structurally
 * typed and accepts a plain object mock; `assertFieldAlignment` is fed
 * literal `PgColumn[]` arrays; `assertNoZeroByteFile` operates on a tmp
 * file written via `fs/promises`.
 */

const createdPaths: string[] = [];

afterEach(async () => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop();
        if (path === undefined) continue;
        await rm(path, { force: true, recursive: true });
    }
});

async function makeTmpFile(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'dwca-test-'));
    createdPaths.push(dir);
    const path = join(dir, `f-${randomUUID()}.bin`);
    await writeFile(path, content);
    return path;
}

function mockConn(rows: Record<string, unknown>[]): CountConnection {
    return {
        runAndReadAll: async (_sql: string) => ({
            getRowObjects: () => rows,
        }),
    };
}

describe('assertFieldAlignment', () => {
    test('aligned arrays return silently', () => {
        const pg: readonly PgColumn[] = [
            { name: 'a', ordinal: 1 },
            { name: 'b', ordinal: 2 },
            { name: 'c', ordinal: 3 },
        ];
        const ts = [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as const;
        expect(() => assertFieldAlignment(pg, ts, 'occurrences')).not.toThrow();
    });

    test('extra TS entry surfaces as [+i] with the missing index', () => {
        const pg: readonly PgColumn[] = [
            { name: 'a', ordinal: 1 },
            { name: 'b', ordinal: 2 },
        ];
        const ts = [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as const;
        let caught: unknown;
        try {
            assertFieldAlignment(pg, ts, 'occurrences');
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(AlignmentError);
        const e = caught as AlignmentError;
        expect(e.diff.some((line) => /\[\+2\].*"c"/.test(line))).toBe(true);
        expect(e.table).toBe('occurrences');
    });

    test('extra PG column surfaces as [-i] with the trailing ordinal', () => {
        const pg: readonly PgColumn[] = [
            { name: 'a', ordinal: 1 },
            { name: 'b', ordinal: 2 },
            { name: 'c', ordinal: 3 },
        ];
        const ts = [{ name: 'a' }, { name: 'b' }] as const;
        let caught: unknown;
        try {
            assertFieldAlignment(pg, ts, 'multimedia');
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(AlignmentError);
        const e = caught as AlignmentError;
        expect(e.diff.some((line) => /\[-2\].*"c"/.test(line))).toBe(true);
        expect(e.table).toBe('multimedia');
    });

    test('name mismatch at same ordinal surfaces as [~i]', () => {
        const pg: readonly PgColumn[] = [
            { name: 'a', ordinal: 1 },
            { name: 'x', ordinal: 2 },
        ];
        const ts = [{ name: 'a' }, { name: 'b' }] as const;
        let caught: unknown;
        try {
            assertFieldAlignment(pg, ts, 'occurrences');
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(AlignmentError);
        const e = caught as AlignmentError;
        expect(e.diff.some((line) => /\[~1\].*"b".*"x"/.test(line))).toBe(true);
    });

    test('AlignmentError is an Error instance with table and diff readonly props', () => {
        const pg: readonly PgColumn[] = [{ name: 'a', ordinal: 1 }];
        const ts = [{ name: 'b' }] as const;
        let caught: unknown;
        try {
            assertFieldAlignment(pg, ts, 'multimedia');
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(caught).toBeInstanceOf(AlignmentError);
        const e = caught as AlignmentError;
        expect(e.name).toBe('AlignmentError');
        expect(typeof e.table).toBe('string');
        expect(Array.isArray(e.diff)).toBe(true);
        expect(e.diff.length).toBeGreaterThan(0);
        // message embeds the table name with the dwc. prefix
        expect(e.message).toContain('dwc.multimedia');
    });

    test('multi-error diff collects every mismatch in order', () => {
        const pg: readonly PgColumn[] = [
            { name: 'a', ordinal: 1 },
            { name: 'XX', ordinal: 2 },
            { name: 'c', ordinal: 3 },
        ];
        const ts = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] as const;
        let caught: unknown;
        try {
            assertFieldAlignment(pg, ts, 'occurrences');
        } catch (err) {
            caught = err;
        }
        const e = caught as AlignmentError;
        expect(e.diff.length).toBe(2);
        expect(e.diff[0]).toMatch(/\[~1\]/);
        expect(e.diff[1]).toMatch(/\[\+3\]/);
    });
});

describe('assertNonZeroRows', () => {
    test('returns the bigint count when non-zero', async () => {
        const conn = mockConn([{ n: 5n }]);
        await expect(assertNonZeroRows(conn, 'pgdb.dwc.occurrences')).resolves.toBe(5n);
    });

    test('rejects with empty-result error mentioning the table name when count is 0', async () => {
        const conn = mockConn([{ n: 0n }]);
        await expect(
            assertNonZeroRows(conn, 'pgdb.dwc.occurrences'),
        ).rejects.toThrow(/Empty result.*pgdb\.dwc\.occurrences/);
    });

    test('coerces a non-bigint count (e.g. number) into a bigint', async () => {
        const conn = mockConn([{ n: 42 }]);
        await expect(assertNonZeroRows(conn, 'pgdb.dwc.multimedia')).resolves.toBe(42n);
    });
});

describe('assertNoZeroByteFile', () => {
    test('resolves on a non-empty file', async () => {
        const path = await makeTmpFile('hello');
        await expect(assertNoZeroByteFile(path)).resolves.toBeUndefined();
    });

    test('rejects on a zero-byte file with a message identifying the path', async () => {
        const path = await makeTmpFile('');
        await expect(assertNoZeroByteFile(path)).rejects.toThrow(
            /Zero-byte file:/,
        );
        await expect(assertNoZeroByteFile(path)).rejects.toThrow(path);
    });
});
