/**
 * DwC-A nightly empty/under-threshold guard — Phase 07 Plan 01.
 *
 * Implements G-01..G-04 hard-floor guard per CONTEXT.md:
 *   G-01: Hard floor only (stateless — no comparison to last published archive).
 *   G-02: zip size > 50 KB AND parquet size > 10 KB AND row count > 1,000.
 *   G-03: Runs between build:dwca and the S3 upload (caller's responsibility).
 *   G-04: On trip — exit 1 + write structured diff to dist/dwca/guard-diff.txt.
 *
 * Security: NEVER writes the DSN to stdout/stderr or any log file.
 *   Per T-7-01, any error message that could contain the DSN is scrubbed via maskDsn().
 *
 * CLI invocation:
 *   pnpm exec tsx scripts/dwca/guard.ts
 *
 * Cross-reference:
 *   - 07-01-PLAN.md Task 1 for the full behavior spec.
 *   - 07-CONTEXT.md G-01..G-04 for the locked guard decisions.
 *   - scripts/dwca/build.ts for the maskDsn + DuckDB ATTACH pattern this mirrors.
 */

import { stat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

// ---------------------------------------------------------------------------
// Constants and thresholds
// ---------------------------------------------------------------------------

const ZIP_PATH = 'dist/dwca/salishsea-occurrences-v1.zip';
const PARQUET_PATH = 'dist/dwca/salishsea-occurrences-v1.parquet';
const DIFF_PATH = 'dist/dwca/guard-diff.txt';

/** The three G-02 hard floors. A metric must be strictly greater to pass. */
export interface GuardFloors {
    /** G-02: 50 KB floor for the zip archive. */
    zipBytes: number;
    /** CONTEXT: 10 KB floor for the parquet sidecar (symmetry with the zip floor). */
    parquetBytes: number;
    /** G-02: 1,000 row floor for dwc.occurrences. */
    rows: bigint;
}

/**
 * Read the floors from the environment, applying the G-02 defaults.
 *
 * Deliberately a function rather than module-level `const`s. As constants these
 * were frozen at import time, which silently made the floors untestable: a test
 * that set `process.env.ROW_FLOOR` after importing this module had no effect,
 * and the row-floor test passed only because CI's seed fixture happens to sit
 * below the *default* floor. It asserted nothing, and failed outright against a
 * realistically populated database. Prefer passing floors to `main()` directly;
 * this exists so the CLI keeps honouring the env vars the workflow sets.
 */
export function floorsFromEnv(env: NodeJS.ProcessEnv = process.env): GuardFloors {
    const floors: GuardFloors = {
        zipBytes: Number(env['ZIP_FLOOR_BYTES'] ?? 51200),
        parquetBytes: Number(env['PARQUET_FLOOR_BYTES'] ?? 10240),
        rows: parseRowFloor(env['ROW_FLOOR']),
    };
    // Validate here too, not only in main(). This is exported, and returning a
    // silently NaN or zero floor to a direct caller would be the same trap in a
    // new place. main() still validates, to cover floors it was handed directly.
    assertValidFloors(floors);
    return floors;
}

/**
 * Parse ROW_FLOOR, rejecting anything that is not a positive integer.
 *
 * Screened with a regex before `BigInt()` because BigInt throws on non-integral
 * input — `BigInt('1.5')` and `BigInt('abc')` are both SyntaxErrors — which would
 * escape as an opaque stack trace while a malformed ZIP_FLOOR_BYTES gets a clear
 * message. Number() needs no equivalent: it yields NaN, which assertValidFloors
 * rejects. The range check lives here too so that a bad *value* from the
 * environment always reports the same way, whether it is '0' or 'lots'.
 *
 * Stricter than a bare BigInt(): '+1' and '0x10' were previously accepted and are
 * now refused. Nothing in the repo uses those forms, and refusing them loudly
 * beats accepting a form nobody intended.
 */
function parseRowFloor(raw: string | undefined): bigint {
    if (raw === undefined) return 1000n;
    if (/^\s*\d+\s*$/.test(raw)) {
        const parsed = BigInt(raw);
        if (parsed >= 1n) return parsed;
    }
    rejectFloors([`rows must be a positive integer, got ${JSON.stringify(raw)}`]);
}

/**
 * Reject floors that would quietly weaken or disable the guard.
 *
 * The dangerous input is not a wild value but an empty one: `Number('')` is `0`
 * and `BigInt('')` is `0n`, so a workflow that references an unset variable —
 * `ZIP_FLOOR_BYTES: ${{ vars.SOMETHING_MISSING }}` — yields a floor of zero, and
 * a zero floor passes everything. The guard would go on reporting "guard ok" for
 * an empty archive, which is the single outcome it exists to prevent.
 *
 * Floors must therefore be positive: zero is rejected rather than treated as
 * "disable this check". Disabling a floor is not a supported configuration,
 * precisely because it is indistinguishable from the misconfiguration above.
 * NaN (from an unparseable value) is rejected for the same reason, though it
 * fails safe rather than open — every comparison against it is false, so the
 * guard would trip on a healthy archive.
 */
/** Report invalid floors and stop. Never returns. */
function rejectFloors(problems: string[]): never {
    const message = `guard floors are invalid: ${problems.join('; ')}`;
    console.error(message);
    // dwca-nightly.yml pre-seeds this file with "Workflow failed before
    // scripts/dwca/guard.ts could run", and files it as the issue body. That would
    // be wrong here — the guard ran, its configuration was rejected — and the
    // difference matters to whoever reads the issue. Overwrite with the truth.
    writeFileSync(
        DIFF_PATH,
        `DwC-A nightly guard did not run\n\n${message}\n\n` +
        `No archive was published; yesterday's remains the published version.\n`,
    );
    process.exit(1);
}

function assertValidFloors(floors: GuardFloors): void {
    const problems: string[] = [];

    for (const key of ['zipBytes', 'parquetBytes'] as const) {
        const value = floors[key];
        if (!Number.isSafeInteger(value) || value < 1) {
            problems.push(`${key} must be a positive integer, got ${value}`);
        }
    }
    // `typeof` matters as much as the range here. GuardFloors is erased at
    // runtime, so a JavaScript caller can pass `rows: NaN`; `NaN < 1n` is false,
    // which would slip an unusable floor past a bare range check even though the
    // same value in zipBytes is caught by Number.isSafeInteger. Reported
    // separately so a wrong type and a wrong value do not share one message.
    if (typeof floors.rows !== 'bigint') {
        problems.push(`rows must be a bigint, got ${typeof floors.rows} (${String(floors.rows)})`);
    } else if (floors.rows < 1n) {
        problems.push(`rows must be a positive integer, got ${floors.rows}`);
    }

    if (problems.length > 0) rejectFloors(problems);
}

// ---------------------------------------------------------------------------
// DSN masking helper (mirrors scripts/dwca/build.ts maskDsn)
// ---------------------------------------------------------------------------

/**
 * Mask the password portion of any `scheme://user:password@host…` substrings
 * found in `s`, leaving the rest of the message intact so the underlying error
 * stays actionable. Falls back to a hard `<redacted>` if no structured DSN is
 * found but `://` is still present. Mirrors scripts/dwca/build.ts.
 *
 * T-7-01 mitigation: scrub password before logging.
 */
function maskDsn(s: string): string {
    const masked = s.replace(
        /\b(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+(@)/gi,
        '$1***$2',
    );
    if (masked !== s) return masked;
    return s.includes('://') ? '<redacted>' : s;
}

// ---------------------------------------------------------------------------
// Main guard logic
// ---------------------------------------------------------------------------

export async function main(floors: GuardFloors = floorsFromEnv()): Promise<void> {
    // Before anything else: a zero or unparseable floor silently passes everything.
    assertValidFloors(floors);
    // Snapshot the validated values. `floors` belongs to the caller and there are
    // two awaits between here and the comparisons below, so reading it again at
    // the end would mean applying floors that were never validated.
    const { zipBytes: zipFloor, parquetBytes: parquetFloor, rows: rowFloor } = floors;

    // DSN guard — read SUPABASE_DB_URL; exit 1 if missing. NEVER log the DSN.
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }

    // Collect file sizes for zip and parquet.
    const [zipStat, parquetStat] = await Promise.all([
        stat(ZIP_PATH),
        stat(PARQUET_PATH),
    ]);
    const zipBytes = zipStat.size;
    const parquetBytes = parquetStat.size;

    // Connect to Postgres via DuckDB ATTACH (read-only) and query row count.
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let rowCount: bigint;

    try {
        // Install + load the postgres extension (matches build.ts pattern).
        await conn.run('INSTALL postgres; LOAD postgres;');

        // ATTACH Postgres read-only — scrub DSN from any error message.
        try {
            await conn.run(`ATTACH '${dsn}' AS pgdb (TYPE postgres, READ_ONLY)`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Failed to attach Postgres: ${maskDsn(msg)}`);
            throw new Error(`Failed to attach Postgres: ${maskDsn(msg)}`);
        }

        // Query row count from dwc.occurrences.
        const result = await conn.runAndReadAll(
            'SELECT COUNT(*) FROM pgdb.dwc.occurrences',
        );
        const rows = result.getRows();
        const rawCount = rows[0]?.[0];
        rowCount =
            typeof rawCount === 'bigint' ? rawCount : BigInt(rawCount as number | string);
    } finally {
        conn.closeSync();
    }

    // Evaluate guard conditions.
    const zipOk = zipBytes > zipFloor;
    const parquetOk = parquetBytes > parquetFloor;
    const rowOk = rowCount > rowFloor;

    if (zipOk && parquetOk && rowOk) {
        console.log(
            `guard ok: zip=${zipBytes} bytes (>${zipFloor}), parquet=${parquetBytes} (>${parquetFloor}), rows=${rowCount} (>${rowFloor})`,
        );
        return;
    }

    // G-04: Trip — build structured diff, write to file, exit 1.
    const diff = {
        zip_bytes: Number(zipBytes),
        zip_floor: zipFloor,
        zip_ok: zipOk,
        parquet_bytes: Number(parquetBytes),
        parquet_floor: parquetFloor,
        parquet_ok: parquetOk,
        row_count: Number(rowCount),
        row_floor: Number(rowFloor),
        row_ok: rowOk,
    };

    const humanBody =
        `DwC-A nightly guard tripped\n\n` +
        `zip bytes:     ${diff.zip_bytes} (floor ${diff.zip_floor}) ${zipOk ? 'OK' : 'FAIL'}\n` +
        `parquet bytes: ${diff.parquet_bytes} (floor ${diff.parquet_floor}) ${parquetOk ? 'OK' : 'FAIL'}\n` +
        `row count:     ${diff.row_count} (floor ${diff.row_floor}) ${rowOk ? 'OK' : 'FAIL'}\n\n` +
        `Yesterday's archive remains the published version.\n` +
        `Raw: ${JSON.stringify(diff)}\n`;

    writeFileSync(DIFF_PATH, humanBody);
    console.error(`guard tripped: ${JSON.stringify(diff)}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when invoked as a script, not when imported.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[guard] FAILED:', maskDsn(msg));
        process.exit(1);
    });
}
