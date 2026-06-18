/**
 * Unit tests for scripts/dwca/guard.ts — G-01..G-04 hard-floor empty-result guard.
 *
 * Tests:
 *   1. Guard passes when all metrics are above floor values.
 *   2. Guard trips when zip size <= ZIP_FLOOR_BYTES.
 *   3. Guard trips when parquet size <= PARQUET_FLOOR_BYTES.
 *   4. Guard trips when dwc.occurrences row count <= ROW_FLOOR (DSN-gated).
 *   5. Guard never logs the DSN to stdout/stderr.
 *   6. guard-diff.txt content shape matches the documented format.
 *
 * Cross-reference:
 *   - 07-01-PLAN.md Task 1 for the full behavior spec.
 *   - 07-CONTEXT.md G-01..G-04 for the locked guard decisions.
 *   - scripts/dwca/build.test.ts for the HAS_DSN gating pattern.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (must be hoisted before any imports of the mocked modules)
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
    writeFileSync: vi.fn(),
    default: { writeFileSync: vi.fn() },
}));

vi.mock('node:fs/promises', () => ({
    stat: vi.fn(),
    default: { stat: vi.fn() },
}));

vi.mock('@duckdb/node-api', () => ({
    DuckDBInstance: {
        create: vi.fn(),
    },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as duckdbModule from '@duckdb/node-api';
import { main } from './guard.ts';

// ---------------------------------------------------------------------------
// DSN gating (mirrors build.test.ts pattern)
// ---------------------------------------------------------------------------

const DSN = process.env['SUPABASE_DB_URL'];
const HAS_DSN = !!DSN;

// ---------------------------------------------------------------------------
// Shared mock factory helpers
// ---------------------------------------------------------------------------

function makeStatMock(zipSize: number, parquetSize: number) {
    return vi.fn().mockImplementation(async (path: unknown) => {
        const p = String(path);
        if (p.includes('.parquet')) return { size: parquetSize };
        return { size: zipSize }; // zip
    });
}

function makeDuckdbMock(rowCount: bigint) {
    const mockResult = {
        getRows: () => [[rowCount]],
    };
    const mockConn = {
        run: vi.fn().mockResolvedValue(undefined),
        runAndReadAll: vi.fn().mockResolvedValue(mockResult),
        closeSync: vi.fn(),
    };
    const mockDb = {
        connect: vi.fn().mockResolvedValue(mockConn),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(duckdbModule.DuckDBInstance.create).mockResolvedValue(mockDb as any);
    return { mockConn, mockDb };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('guard', () => {
    let processExitSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let origDsn: string | undefined;

    beforeEach(() => {
        // Capture and suppress console + process.exit.
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        processExitSpy = vi.spyOn(process, 'exit').mockImplementation(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (() => { throw new Error('process.exit called'); }) as any,
        );

        // Provide a fake DSN so the DSN guard passes in stat-only tests.
        origDsn = process.env['SUPABASE_DB_URL'];
        process.env['SUPABASE_DB_URL'] = 'postgres://fake:fake@host:5432/db';

        // Reset mock call counts between tests.
        vi.mocked(fs.writeFileSync).mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (origDsn === undefined) delete process.env['SUPABASE_DB_URL'];
        else process.env['SUPABASE_DB_URL'] = origDsn;
    });

    // -----------------------------------------------------------------------
    // Test 1: pass case (all metrics above floor)
    // -----------------------------------------------------------------------

    test('guard passes when zip > floor AND parquet > floor AND row count > floor', async () => {
        // zip: 200 KB (above 50 KB floor), parquet: 50 KB (above 10 KB floor), rows: 5000 (above 1000 floor)
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(BigInt(5000));

        await main();

        expect(processExitSpy).not.toHaveBeenCalled();
        expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();

        const logCalls = consoleLogSpy.mock.calls.flat().join(' ');
        expect(logCalls).toContain('guard ok:');
    });

    // -----------------------------------------------------------------------
    // Test 2: zip floor trip
    // -----------------------------------------------------------------------

    test('guard trips when zip <= ZIP_FLOOR_BYTES', async () => {
        // zip: 10 KB (below 51200 floor), parquet: 50 KB (above floor), rows: 5000
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(10_240, 51_200));
        makeDuckdbMock(BigInt(5000));

        await expect(main()).rejects.toThrow('process.exit called');

        expect(processExitSpy).toHaveBeenCalledWith(1);
        expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();

        const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        const rawMatch = content.match(/Raw: (.+)/);
        expect(rawMatch).toBeTruthy();
        const parsed = JSON.parse(rawMatch![1]!);
        expect(parsed.zip_ok).toBe(false);
        expect(parsed.row_ok).toBe(true);
        expect(parsed.parquet_ok).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 3: parquet floor trip
    // -----------------------------------------------------------------------

    test('guard trips when parquet <= PARQUET_FLOOR_BYTES', async () => {
        // zip: 200 KB (above floor), parquet: 1 KB (below 10240 floor), rows: 5000
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 1_024));
        makeDuckdbMock(BigInt(5000));

        await expect(main()).rejects.toThrow('process.exit called');

        expect(processExitSpy).toHaveBeenCalledWith(1);
        expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();

        const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        const rawMatch = content.match(/Raw: (.+)/);
        expect(rawMatch).toBeTruthy();
        const parsed = JSON.parse(rawMatch![1]!);
        expect(parsed.parquet_ok).toBe(false);
        expect(parsed.zip_ok).toBe(true);
        expect(parsed.row_ok).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 4: row count floor trip (DSN-gated)
    // -----------------------------------------------------------------------

    const testRowFloor = HAS_DSN ? test : test.skip;
    testRowFloor('guard trips when dwc.occurrences row count <= ROW_FLOOR', async () => {
            // Both file sizes above floor; set ROW_FLOOR to a very large value
            // so the real row count (from the live DB) trips the floor.
            vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));

            // Restore real DuckDB for this DSN-gated test.
            vi.mocked(duckdbModule.DuckDBInstance.create).mockRestore();

            const origFloor = process.env['ROW_FLOOR'];
            process.env['ROW_FLOOR'] = '9999999999'; // above any real row count
            // Also restore the real DSN.
            process.env['SUPABASE_DB_URL'] = DSN as string;

            try {
                await expect(main()).rejects.toThrow('process.exit called');

                expect(processExitSpy).toHaveBeenCalledWith(1);
                expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();

                const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
                const rawMatch = content.match(/Raw: (.+)/);
                expect(rawMatch).toBeTruthy();
                const parsed = JSON.parse(rawMatch![1]!);
                expect(parsed.row_ok).toBe(false);
            } finally {
                if (origFloor === undefined) delete process.env['ROW_FLOOR'];
                else process.env['ROW_FLOOR'] = origFloor;
            }
        },
    );

    // -----------------------------------------------------------------------
    // Test 5: DSN is never logged
    // -----------------------------------------------------------------------

    test('guard never logs the DSN', async () => {
        // Trigger a failure path with a recognizable DSN.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 1_024)); // trip parquet
        makeDuckdbMock(BigInt(5000));

        const testDsn = 'postgres://leaktest:secret@host:5432/db';
        process.env['SUPABASE_DB_URL'] = testDsn;

        await expect(main()).rejects.toThrow('process.exit called');

        // Assert no spy call contains the DSN
        const allLogArgs = [
            ...consoleLogSpy.mock.calls,
            ...consoleErrorSpy.mock.calls,
        ]
            .flat()
            .map(String);

        for (const arg of allLogArgs) {
            expect(arg).not.toContain('leaktest:secret');
            expect(arg).not.toContain('leaktest');
        }
    });

    // -----------------------------------------------------------------------
    // Test 5b: guard writes diff file with correct path when parquet trips
    // -----------------------------------------------------------------------

    test('guard writes diff to dist/dwca/guard-diff.txt on any trip', async () => {
        // Trip the parquet floor.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 512));
        makeDuckdbMock(BigInt(5000));

        await expect(main()).rejects.toThrow('process.exit called');

        expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();
        const [writePath] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        expect(writePath).toBe('dist/dwca/guard-diff.txt');
    });

    // -----------------------------------------------------------------------
    // Test 6: guard-diff.txt content shape
    // -----------------------------------------------------------------------

    test('guard-diff.txt content shape matches documented format', async () => {
        // Trip the zip floor.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(1_024, 51_200)); // zip below floor
        makeDuckdbMock(BigInt(5000));

        await expect(main()).rejects.toThrow('process.exit called');

        expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();
        const [writePath, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];

        // Path must be dist/dwca/guard-diff.txt
        expect(writePath).toBe('dist/dwca/guard-diff.txt');

        // Content must start with the header line.
        expect(content).toContain('DwC-A nightly guard tripped');

        // Must contain all three metric lines.
        expect(content).toMatch(/zip bytes:\s+\d+ \(floor \d+\) (OK|FAIL)/);
        expect(content).toMatch(/parquet bytes:\s+\d+ \(floor \d+\) (OK|FAIL)/);
        expect(content).toMatch(/row count:\s+\d+ \(floor \d+\) (OK|FAIL)/);

        // Must contain "Yesterday's archive remains the published version."
        expect(content).toContain("Yesterday's archive remains the published version.");

        // Must contain a Raw: JSON line with all required fields.
        const rawMatch = content.match(/Raw: (.+)/);
        expect(rawMatch).toBeTruthy();
        const raw = JSON.parse(rawMatch![1]!);
        expect(raw).toHaveProperty('zip_bytes');
        expect(raw).toHaveProperty('zip_floor');
        expect(raw).toHaveProperty('zip_ok');
        expect(raw).toHaveProperty('parquet_bytes');
        expect(raw).toHaveProperty('parquet_floor');
        expect(raw).toHaveProperty('parquet_ok');
        expect(raw).toHaveProperty('row_count');
        expect(raw).toHaveProperty('row_floor');
        expect(raw).toHaveProperty('row_ok');
    });
});
