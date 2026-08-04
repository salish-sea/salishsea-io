/**
 * Unit tests for scripts/dwca/guard.ts — G-01..G-04 hard-floor empty-result guard.
 *
 * Tests:
 *   1. Guard passes when all metrics are above floor values.
 *   2. Guard trips when zip size <= the zip floor.
 *   3. Guard trips when parquet size <= the parquet floor.
 *   4. Guard trips when dwc.occurrences row count <= the row floor.
 *   4b. The same against a live database, exercising ATTACH + COUNT (DSN-gated).
 *   5. floorsFromEnv reads the environment when called, not when imported.
 *   6. Guard never logs the DSN to stdout/stderr.
 *   7. guard-diff.txt content shape matches the documented format.
 *
 * Every test passes floors to `main()` explicitly. They used to be module-level
 * `const`s in guard.ts, read once at import, so a test setting
 * `process.env.ROW_FLOOR` in its body changed nothing: the row-floor case passed
 * only because CI's seed fixture sits below the *default* floor of 1,000. It
 * asserted nothing there, and failed outright against a populated local database
 * (salish-52s). Passing floors in also stops a developer's ambient
 * ZIP_FLOOR_BYTES/PARQUET_FLOOR_BYTES from perturbing the mocked size cases.
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
import { main, floorsFromEnv, type GuardFloors } from './guard.ts';

/**
 * The G-02 defaults, stated explicitly so these tests assert against known
 * numbers rather than whatever the ambient environment happens to hold.
 */
const FLOORS: GuardFloors = {
    zipBytes: 51_200,
    parquetBytes: 10_240,
    rows: 1_000n,
};

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
        // Pin the floor variables for the whole suite. Several tests below call
        // main() with no argument on purpose, to exercise the floorsFromEnv
        // default — and those are exactly the ones a developer's exported
        // ZIP_FLOOR_BYTES would perturb. vi.stubEnv is undone by
        // vi.unstubAllEnvs() in afterEach, and a test that needs a specific value
        // (the ROW_FLOOR cases) stubs over the top of these.
        vi.stubEnv('ZIP_FLOOR_BYTES', String(FLOORS.zipBytes));
        vi.stubEnv('PARQUET_FLOOR_BYTES', String(FLOORS.parquetBytes));
        vi.stubEnv('ROW_FLOOR', String(FLOORS.rows));

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
        vi.unstubAllEnvs();
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

        await main(FLOORS);

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

        await expect(main(FLOORS)).rejects.toThrow('process.exit called');

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

        await expect(main(FLOORS)).rejects.toThrow('process.exit called');

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
    // Test 4: row count floor trip
    //
    // Runs everywhere, against a mocked count. The row floor was previously only
    // covered by the DSN-gated test below, so on a machine without a local
    // database it was not covered at all.
    // -----------------------------------------------------------------------

    test('guard trips when row count <= the row floor', async () => {
        // Both file sizes comfortably above their floors, so only the row count
        // can trip: 999 against a floor of 1,000.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(999n);

        await expect(main(FLOORS)).rejects.toThrow('process.exit called');

        expect(processExitSpy).toHaveBeenCalledWith(1);
        expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();

        const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        const parsed = JSON.parse(content.match(/Raw: (.+)/)![1]!);
        expect(parsed.row_ok).toBe(false);
        expect(parsed.zip_ok).toBe(true);
        expect(parsed.parquet_ok).toBe(true);
        expect(parsed.row_count).toBe(999);
        expect(parsed.row_floor).toBe(1_000);
    });

    test('guard passes on the row floor boundary at floor + 1', async () => {
        // The floor is exclusive: `rowCount > floor`. 1,000 must trip and 1,001
        // must pass, which is what pins the comparison as `>` rather than `>=`.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(1_000n);
        await expect(main(FLOORS)).rejects.toThrow('process.exit called');

        vi.mocked(fs.writeFileSync).mockClear();
        makeDuckdbMock(1_001n);
        await main(FLOORS);
        expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
    });

    test('guard honours explicit non-default floors', async () => {
        // Every other always-run test passes floors equal to the G-02 defaults,
        // so it would still pass if main() ignored its argument and re-read the
        // environment. This one uses floors that differ from the defaults in
        // both directions, so only a main() that actually uses the argument
        // behaves as asserted.
        const custom: GuardFloors = {
            zipBytes: 300_000,      // above the mocked 204,800 -> trips
            parquetBytes: 1_000,    // below the mocked 51,200  -> passes
            rows: 10_000n,          // above the mocked 5,000   -> trips
        };
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(5_000n);

        await expect(main(custom)).rejects.toThrow('process.exit called');

        const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        const parsed = JSON.parse(content.match(/Raw: (.+)/)![1]!);
        // Under the defaults this input passes cleanly; under `custom` two floors trip.
        expect(parsed.zip_ok).toBe(false);
        expect(parsed.row_ok).toBe(false);
        expect(parsed.parquet_ok).toBe(true);
        // The report echoes the floors it was given, not the defaults.
        expect(parsed.zip_floor).toBe(300_000);
        expect(parsed.parquet_floor).toBe(1_000);
        expect(parsed.row_floor).toBe(10_000);
    });

    // -----------------------------------------------------------------------
    // Test 4c: floors that would disable the guard are rejected
    // -----------------------------------------------------------------------

    test.each([
        ['zip floor of zero', { ...FLOORS, zipBytes: 0 }],
        ['parquet floor of zero', { ...FLOORS, parquetBytes: 0 }],
        ['row floor of zero', { ...FLOORS, rows: 0n }],
        ['negative floor', { ...FLOORS, zipBytes: -1 }],
        ['unparseable floor (NaN)', { ...FLOORS, zipBytes: Number.NaN }],
        // GuardFloors is erased at runtime, so a JavaScript caller can pass these.
        // `NaN < 1n` is false, so a bare range check would let them through.
        ['row floor passed as a number', { ...FLOORS, rows: 1_000 as unknown as bigint }],
        ['row floor of NaN', { ...FLOORS, rows: Number.NaN as unknown as bigint }],
    ])('guard refuses to run with a %s', async (_label, floors) => {
        // A zero floor passes everything, so an empty env var — Number('') === 0
        // — would otherwise silently disable the check on an empty archive.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(5_000n);

        await expect(main(floors as GuardFloors)).rejects.toThrow('process.exit called');

        expect(processExitSpy).toHaveBeenCalledWith(1);
        const errors = consoleErrorSpy.mock.calls.flat().join(' ');
        expect(errors).toContain('guard floors are invalid');

        // The diff file says the guard did not run, rather than reporting a trip
        // with fabricated numbers — and overwrites the workflow's pre-seeded
        // "failed before guard.ts could run", which would be wrong here.
        const [diffPath, body] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        expect(diffPath).toBe('dist/dwca/guard-diff.txt');
        expect(body).toContain('guard did not run');
        expect(body).toContain('guard floors are invalid');
        expect(body).not.toContain('Raw:'); // not a trip report
    });

    test('a bad row-floor type is reported as a type problem, not a range one', async () => {
        // Distinct messages: a JS caller passing the wrong type needs to hear
        // "bigint", an operator with a bad env value needs to hear "integer".
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(5_000n);

        await expect(
            main({ ...FLOORS, rows: 1_000 as unknown as bigint }),
        ).rejects.toThrow('process.exit called');

        const errors = consoleErrorSpy.mock.calls.flat().join(' ');
        expect(errors).toContain('rows must be a bigint, got number');
    });

    // -----------------------------------------------------------------------
    // Test 4b: row count floor trip against a live database (DSN-gated)
    //
    // The only test that exercises the real DuckDB ATTACH + COUNT path, so it
    // earns its keep even though test 4 covers the same branch. The floor is set
    // above any plausible row count, which makes the trip deterministic whether
    // the database holds CI's seed fixture or a full local import — the previous
    // version tried to do this through process.env.ROW_FLOOR, which guard.ts had
    // already read at import time, so it silently ran against the default floor
    // of 1,000 and passed only where the data happened to sit below it.
    // -----------------------------------------------------------------------

    const testRowFloor = HAS_DSN ? test : test.skip;
    testRowFloor('guard trips on row count against a live database', async () => {
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));

        // Wire real DuckDB for this DSN-gated test. mockRestore() only works on
        // vi.spyOn() mocks; this module uses vi.fn(), so we importActual and
        // delegate via mockImplementation instead.
        const { DuckDBInstance: RealDuckDBInstance } =
            await vi.importActual<typeof import('@duckdb/node-api')>('@duckdb/node-api');
        vi.mocked(duckdbModule.DuckDBInstance.create).mockImplementation(
            RealDuckDBInstance.create.bind(RealDuckDBInstance),
        );

        process.env['SUPABASE_DB_URL'] = DSN as string;

        await expect(
            main({ ...FLOORS, rows: 9_999_999_999n }),
        ).rejects.toThrow('process.exit called');

        expect(processExitSpy).toHaveBeenCalledWith(1);
        expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledOnce();

        const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        const parsed = JSON.parse(content.match(/Raw: (.+)/)![1]!);
        expect(parsed.row_ok).toBe(false);
        // The count came from the database rather than a mock: dwc.occurrences is
        // non-empty in both CI (ci-seed.sql) and a local import. Without this the
        // test would still pass if ATTACH silently yielded nothing.
        expect(parsed.row_count).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // Test 5: floors are read from the environment at call time
    //
    // The direct regression test for salish-52s. As module-level consts these
    // were fixed at import, so the workflow's ZIP_FLOOR_BYTES/ROW_FLOOR did still
    // apply (it sets them before node starts) but nothing could vary them after.
    // -----------------------------------------------------------------------

    test('floorsFromEnv reads the environment when called', () => {
        expect(floorsFromEnv({})).toEqual(FLOORS);

        expect(
            floorsFromEnv({
                ZIP_FLOOR_BYTES: '1',
                PARQUET_FLOOR_BYTES: '2',
                ROW_FLOOR: '3',
            }),
        ).toEqual({ zipBytes: 1, parquetBytes: 2, rows: 3n });

        // Reading process.env on each call is what makes the floors testable.
        vi.stubEnv('ROW_FLOOR', '4242');
        expect(floorsFromEnv().rows).toBe(4_242n);
    });

    test.each([
        ['a fractional value', '1.5'],
        ['a non-numeric value', 'lots'],
        ['a negative value', '-1'],
        ['an empty value', ''],
        ['zero', '0'],
        ['a padded zero', '  00  '],
        ['a plus-prefixed value', '+1'],
    ])('main() refuses a ROW_FLOOR that is %s', async (_label, raw) => {
        // BigInt() throws on all but the empty case, so without screening these
        // escaped as an opaque SyntaxError instead of the guard's own message.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(5_000n);

        vi.stubEnv('ROW_FLOOR', raw);

        await expect(main()).rejects.toThrow('process.exit called');

        expect(processExitSpy).toHaveBeenCalledWith(1);
        const errors = consoleErrorSpy.mock.calls.flat().join(' ');
        expect(errors).toContain('guard floors are invalid');
        expect(errors).toContain('rows must be a positive integer');
    });

    test('main() refuses a malformed ZIP_FLOOR_BYTES the same way', async () => {
        // Number('lots') is NaN rather than a throw, so this arrives at
        // assertValidFloors instead of the screen in floorsFromEnv. Same message.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(5_000n);

        vi.stubEnv('ZIP_FLOOR_BYTES', 'lots');

        await expect(main()).rejects.toThrow('process.exit called');
        const errors = consoleErrorSpy.mock.calls.flat().join(' ');
        expect(errors).toContain('guard floors are invalid');
        expect(errors).toContain('zipBytes must be a positive integer');
    });

    test('guard applies the floors it validated, not later mutations', async () => {
        // main() awaits fs.stat and DuckDB between validating the floors and
        // applying them. A caller mutating its object in that window must not be
        // able to swap in floors that were never checked — here, zeroing them all
        // mid-run would otherwise turn a tripped guard into "guard ok".
        const mutable: GuardFloors = { ...FLOORS };
        const statMock = makeStatMock(204_800, 1_024);
        vi.mocked(fsPromises.stat).mockImplementation(
            vi.fn().mockImplementation(async (path: unknown) => {
                // Mutate mid-run, in the window between validation and comparison.
                mutable.zipBytes = 0;
                mutable.parquetBytes = 0;
                mutable.rows = 0n;
                return statMock(path);
            }),
        );
        makeDuckdbMock(5_000n);

        // parquet is 1,024 against the snapshotted floor of 10,240 -> trips.
        await expect(main(mutable)).rejects.toThrow('process.exit called');

        const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        const parsed = JSON.parse(content.match(/Raw: (.+)/)![1]!);
        expect(parsed.parquet_ok).toBe(false);
        expect(parsed.parquet_floor).toBe(10_240); // the validated value, not 0
    });

    test('main() defaults to the environment, read at call time', async () => {
        // End-to-end version of the above, and the assertion the original
        // row-floor test believed it was making: set ROW_FLOOR *after* guard.ts
        // was imported, call main() with no argument, and require it to bite.
        // Against the old module-level consts this passed silently.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 51_200));
        makeDuckdbMock(1_001n);

        vi.stubEnv('ROW_FLOOR', '1001'); // equal to the count, and `>` is strict

        await expect(main()).rejects.toThrow('process.exit called');

        const [, content] = vi.mocked(fs.writeFileSync).mock.calls[0] as [string, string];
        const parsed = JSON.parse(content.match(/Raw: (.+)/)![1]!);
        expect(parsed.row_ok).toBe(false);
        expect(parsed.row_floor).toBe(1_001);
    });

    // -----------------------------------------------------------------------
    // Test 5: DSN is never logged
    // -----------------------------------------------------------------------

    test('guard never logs the DSN', async () => {
        // Trigger a failure path with a recognizable DSN.
        vi.mocked(fsPromises.stat).mockImplementation(makeStatMock(204_800, 1_024)); // trip parquet
        makeDuckdbMock(BigInt(5000));

        const testDsn = 'postgres://leaktest:secret@host:5432/db';
        process.env['SUPABASE_DB_URL'] = testDsn;

        await expect(main(FLOORS)).rejects.toThrow('process.exit called');

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

        await expect(main(FLOORS)).rejects.toThrow('process.exit called');

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

        await expect(main(FLOORS)).rejects.toThrow('process.exit called');

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
