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
 *   npx tsx scripts/dwca/guard.ts
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
// Constants (all env-overridable with documented defaults)
// ---------------------------------------------------------------------------

const ZIP_PATH = 'dist/dwca/salishsea-occurrences-v1.zip';
const PARQUET_PATH = 'dist/dwca/salishsea-occurrences-v1.parquet';
const DIFF_PATH = 'dist/dwca/guard-diff.txt';

/** G-02: 50 KB floor for the zip archive. */
const ZIP_FLOOR_BYTES = Number(process.env['ZIP_FLOOR_BYTES'] ?? 51200);

/** CONTEXT: 10 KB floor for the parquet sidecar (symmetry with zip floor). */
const PARQUET_FLOOR_BYTES = Number(process.env['PARQUET_FLOOR_BYTES'] ?? 10240);

/** G-02: 1,000 row floor for dwc.occurrences. */
const ROW_FLOOR = BigInt(process.env['ROW_FLOOR'] ?? 1000);

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

export async function main(): Promise<void> {
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
    const zipOk = zipBytes > ZIP_FLOOR_BYTES;
    const parquetOk = parquetBytes > PARQUET_FLOOR_BYTES;
    const rowOk = rowCount > ROW_FLOOR;

    if (zipOk && parquetOk && rowOk) {
        console.log(
            `guard ok: zip=${zipBytes} bytes (>${ZIP_FLOOR_BYTES}), parquet=${parquetBytes} (>${PARQUET_FLOOR_BYTES}), rows=${rowCount} (>${ROW_FLOOR})`,
        );
        return;
    }

    // G-04: Trip — build structured diff, write to file, exit 1.
    const diff = {
        zip_bytes: Number(zipBytes),
        zip_floor: ZIP_FLOOR_BYTES,
        zip_ok: zipOk,
        parquet_bytes: Number(parquetBytes),
        parquet_floor: PARQUET_FLOOR_BYTES,
        parquet_ok: parquetOk,
        row_count: Number(rowCount),
        row_floor: Number(ROW_FLOOR),
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
