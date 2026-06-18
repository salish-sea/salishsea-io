/**
 * DarwinCore Archive build orchestrator — Phase 06 Plan 05.
 *
 * Single entry point invoked by `npm run build:dwca`. Connects to Postgres via
 * DuckDB ATTACH (read-only), asserts the live `dwc.occurrences` / `dwc.multimedia`
 * view column lists match the canonical TS field arrays in `./fields.ts`,
 * COPYs the two tab-delimited data files and the GeoParquet sidecar, runs the
 * R1 empirical GeoParquet metadata check, builds `meta.xml` + `eml.xml` via the
 * pure Plan 03 generators, and writes the deterministic zip via Plan 04's
 * `writeZip`.
 *
 * Exits non-zero on any failure (drift, empty, zero-byte, missing geo metadata,
 * missing env var). NEVER writes the DSN to stdout/stderr or any log file.
 *
 * Cross-reference:
 *   - 06-05-PLAN.md for the 22-step pipeline.
 *   - 06-RESEARCH.md §T1..§T12 for the DuckDB + COPY + parquet_kv_metadata
 *     details, §R1 for the GeoParquet metadata empirical-verify decision
 *     (GEOMETRY column auto-emits `geo` metadata in DuckDB 1.5.4-r.1; we
 *     verify, not assume), §R5 for the freetext tab-collapse columns.
 *   - 06-CONTEXT.md F-02 (alignment guard), F-05 (UTF-8 no BOM),
 *     F-06 (constants as columns), G-01 (overridden per §R1: ST_Point not
 *     ST_AsWKB), G-02 (26 columns total), G-03 (CRS84 implied), G-04
 *     (geometry appended).
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { mkdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS } from './fields.ts';
import {
    assertFieldAlignment,
    assertNonZeroRows,
    assertNoZeroByteFile,
    type PgColumn,
} from './assertions.ts';
import { buildMetaXml } from './meta-xml.ts';
import { buildEml, type DatasetsRow } from './eml.ts';
import { writeZip } from './zip.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUT_DIR = 'dist/dwca';
const OUT_ZIP = path.join(OUT_DIR, 'salishsea-occurrences-v1.zip');
const OUT_PARQUET = path.join(OUT_DIR, 'salishsea-occurrences-v1.parquet');
const OUT_OCCURRENCE = path.join(OUT_DIR, 'occurrence.txt');
const OUT_MULTIMEDIA = path.join(OUT_DIR, 'multimedia.txt');

/**
 * RESEARCH §R5: the user-content occurrence columns whose values may carry
 * embedded `\t` / `\n` / `\r` and would otherwise break the tab-delimited CSV
 * column boundary. `rightsHolder` also appears as a multimedia column.
 *
 * Constant-valued columns (`basisOfRecord`, `geodeticDatum`, `occurrenceStatus`)
 * never contain tabs and don't need collapsing.
 */
const TAB_COLLAPSE_COLS: ReadonlySet<string> = new Set([
    'occurrenceRemarks',
    'dynamicProperties',
    'recordedBy',
    'rightsHolder',
    'datasetName',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the SELECT projection clause for a tab-delimited COPY. Columns in
 * `tabCollapse` are wrapped in `regexp_replace(...)` to collapse embedded
 * tabs/newlines into a single space; other columns are emitted as plain
 * `"name"` identifiers. Comma-joined; no trailing comma.
 */
function buildSelectList(
    fields: readonly { readonly name: string }[],
    tabCollapse: ReadonlySet<string>,
): string {
    return fields
        .map((f) => {
            if (tabCollapse.has(f.name)) {
                // E'[\t\n\r]+' literal regex; the surrounding TS template
                // produces the SQL string `regexp_replace("name", E'[\t\n\r]+', ' ', 'g')`.
                return `regexp_replace("${f.name}", E'[\\t\\n\\r]+', ' ', 'g') AS "${f.name}"`;
            }
            return `"${f.name}"`;
        })
        .join(', ');
}

/**
 * Convert DuckDB `DESCRIBE` result rows into `PgColumn[]`. DESCRIBE returns
 * one row per column with a `column_name` field; the array index +1 is the
 * 1-based ordinal that matches `information_schema.columns.ordinal_position`.
 */
function describeViewToPgColumns(
    rows: readonly Record<string, unknown>[],
): PgColumn[] {
    return rows.map((row, i) => {
        const raw = row['column_name'];
        const name = typeof raw === 'string' ? raw : String(raw);
        return { name, ordinal: i + 1 };
    });
}

/**
 * Return `'<redacted>'` if the input string contains a URI scheme separator
 * (`://`), otherwise return the input. Used to scrub potential DSNs from
 * error messages before logging.
 */
function maskDsn(s: string): string {
    return s.includes('://') ? '<redacted>' : s;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
    // Step 1: DSN guard. Read SUPABASE_DB_URL; exit 1 if missing. Never log it.
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }

    // Step 2: Ensure output directory exists.
    await mkdir(OUT_DIR, { recursive: true });

    // Step 3: Create DuckDB instance + connection. Use try/finally to ensure
    // the connection always closes.
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();

    try {
        // Step 4: Install + load extensions.
        await conn.run('INSTALL postgres; LOAD postgres;');
        await conn.run('INSTALL spatial; LOAD spatial;');

        // Step 5: ATTACH Postgres read-only. Wrap to scrub DSN from any error.
        try {
            await conn.run(
                `ATTACH '${dsn}' AS pgdb (TYPE postgres, READ_ONLY)`,
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // maskDsn returns '<redacted>' if `://` is found; this avoids
            // leaking the DSN if DuckDB echoes the connection string in
            // its error.
            console.error(`Failed to attach Postgres: ${maskDsn(msg)}`);
            throw err instanceof Error
                ? new Error(`Failed to attach Postgres: ${maskDsn(msg)}`)
                : new Error('Failed to attach Postgres');
        }

        // Step 6: F-02 alignment guard for dwc.occurrences. MUST precede any COPY.
        const occDescribeReader = await conn.runAndReadAll(
            'DESCRIBE pgdb.dwc.occurrences',
        );
        const occPgCols = describeViewToPgColumns(
            occDescribeReader.getRowObjects(),
        );
        assertFieldAlignment(occPgCols, OCCURRENCE_FIELDS, 'occurrences');

        // Step 7: F-02 alignment guard for dwc.multimedia.
        const mmDescribeReader = await conn.runAndReadAll(
            'DESCRIBE pgdb.dwc.multimedia',
        );
        const mmPgCols = describeViewToPgColumns(
            mmDescribeReader.getRowObjects(),
        );
        assertFieldAlignment(mmPgCols, MULTIMEDIA_FIELDS, 'multimedia');

        // Step 8: Non-zero row guard for dwc.occurrences. We do NOT block on
        // empty multimedia — it can legitimately be empty in some local
        // states.
        const occCount = await assertNonZeroRows(conn, 'pgdb.dwc.occurrences');

        // Step 9: COPY occurrence.txt — tab-delimited, UTF-8, no quoting,
        // tab-collapse on the five user-content columns per §R5.
        const occSelectList = buildSelectList(
            OCCURRENCE_FIELDS,
            TAB_COLLAPSE_COLS,
        );
        await conn.run(
            `COPY (SELECT ${occSelectList} FROM pgdb.dwc.occurrences) ` +
                `TO '${OUT_OCCURRENCE}' (FORMAT csv, DELIMITER '\t', HEADER true, QUOTE '', ESCAPE '', NULLSTR '')`,
        );

        // Step 10: COPY multimedia.txt — same convention.
        const mmSelectList = buildSelectList(
            MULTIMEDIA_FIELDS,
            TAB_COLLAPSE_COLS,
        );
        await conn.run(
            `COPY (SELECT ${mmSelectList} FROM pgdb.dwc.multimedia) ` +
                `TO '${OUT_MULTIMEDIA}' (FORMAT csv, DELIMITER '\t', HEADER true, QUOTE '', ESCAPE '', NULLSTR '')`,
        );

        // Step 11: COPY parquet. Use ST_Point GEOMETRY column (NOT ST_AsWKB
        // BLOB) — per §R1, this is the configuration under which DuckDB
        // 1.5.4-r.1 auto-emits the GeoParquet `geo` kv-metadata. We verify
        // the metadata is actually present in step 12 below.
        const plainOccList = OCCURRENCE_FIELDS.map((f) => `"${f.name}"`).join(
            ', ',
        );
        await conn.run(
            `COPY (SELECT ${plainOccList}, ST_Point("decimalLongitude", "decimalLatitude") AS geometry ` +
                `FROM pgdb.dwc.occurrences) TO '${OUT_PARQUET}' (FORMAT parquet, COMPRESSION snappy)`,
        );

        // Step 12: R1 empirical GeoParquet metadata verification. Read the
        // parquet file's `geo` kv-metadata and assert the GeoParquet 1.0.0
        // shape. If absent, fail loudly — do NOT silently fall back.
        const geoReader = await conn.runAndReadAll(
            `SELECT decode(key) AS k, decode(value) AS v FROM parquet_kv_metadata('${OUT_PARQUET}') WHERE key = 'geo'::blob`,
        );
        const geoRows = geoReader.getRowObjects();
        if (geoRows.length === 0) {
            throw new Error(
                'R1 FAILURE: parquet has no "geo" metadata after COPY. ' +
                    'The ST_Point GEOMETRY auto-emit assumption is wrong for this DuckDB version. ' +
                    'Escalation: either upgrade DuckDB or use the KV_METADATA injection fallback ' +
                    '(RESEARCH §R1 option B).',
            );
        }
        const firstGeoRow = geoRows[0];
        if (!firstGeoRow) {
            throw new Error(
                'R1 FAILURE: parquet_kv_metadata returned no row object',
            );
        }
        const geoJsonRaw = firstGeoRow['v'];
        const geoJsonStr =
            typeof geoJsonRaw === 'string' ? geoJsonRaw : String(geoJsonRaw);
        let parsed: {
            version?: unknown;
            primary_column?: unknown;
            columns?: { geometry?: { encoding?: unknown } };
        };
        try {
            parsed = JSON.parse(geoJsonStr);
        } catch (err) {
            throw new Error(
                `R1 FAILURE: parquet geo metadata is not valid JSON: ${
                    err instanceof Error ? err.message : String(err)
                } — raw value: ${geoJsonStr}`,
            );
        }
        if (parsed.version !== '1.0.0') {
            throw new Error(
                `R1 FAILURE: expected geo.version='1.0.0', got '${String(parsed.version)}' — full metadata: ${geoJsonStr}`,
            );
        }
        if (parsed.primary_column !== 'geometry') {
            throw new Error(
                `R1 FAILURE: expected geo.primary_column='geometry', got '${String(parsed.primary_column)}' — full metadata: ${geoJsonStr}`,
            );
        }
        const encoding = parsed.columns?.geometry?.encoding;
        if (encoding !== 'WKB') {
            throw new Error(
                `R1 FAILURE: expected geo.columns.geometry.encoding='WKB', got '${String(encoding)}' — full metadata: ${geoJsonStr}`,
            );
        }
        console.log(
            `[build:dwca] GeoParquet geo metadata: version=${String(parsed.version)}, primary_column=${String(parsed.primary_column)}, encoding=${String(encoding)}`,
        );

        // Step 13: Row-count parity sanity check between view and parquet.
        const parquetCountReader = await conn.runAndReadAll(
            `SELECT COUNT(*) AS n FROM read_parquet('${OUT_PARQUET}')`,
        );
        const parquetCountRows = parquetCountReader.getRowObjects();
        const firstCountRow = parquetCountRows[0];
        if (!firstCountRow) {
            throw new Error(
                'Parquet row-count query returned no rows (expected one)',
            );
        }
        const parquetCountRaw = firstCountRow['n'];
        const parquetCount =
            typeof parquetCountRaw === 'bigint'
                ? parquetCountRaw
                : BigInt(parquetCountRaw as number | string);
        if (parquetCount !== occCount) {
            throw new Error(
                `Parquet row count mismatch: parquet=${parquetCount}, view=${occCount}`,
            );
        }

        // Step 14: Zero-byte guards on the three intermediate outputs.
        await assertNoZeroByteFile(OUT_OCCURRENCE);
        await assertNoZeroByteFile(OUT_MULTIMEDIA);
        await assertNoZeroByteFile(OUT_PARQUET);

        // Step 15: Compute temporal coverage from MIN/MAX(eventDate).
        const tempReader = await conn.runAndReadAll(
            'SELECT MIN("eventDate") AS begin, MAX("eventDate") AS end FROM pgdb.dwc.occurrences',
        );
        const tempRows = tempReader.getRowObjects();
        const firstTempRow = tempRows[0];
        if (!firstTempRow) {
            throw new Error(
                'MIN/MAX(eventDate) query returned no rows (expected one)',
            );
        }
        const tempBeginRaw = firstTempRow['begin'];
        const tempEndRaw = firstTempRow['end'];
        if (tempBeginRaw === null || tempEndRaw === null) {
            throw new Error(
                'MIN/MAX(eventDate) returned NULL — dwc.occurrences may be empty (this should have been caught by assertNonZeroRows)',
            );
        }
        // eventDate is ISO 8601 in the view; slice(0,10) extracts YYYY-MM-DD
        // for the EML <calendarDate>. POLICY §6.5: date-precision strings
        // sort correctly.
        const temporalCoverage = {
            begin: String(tempBeginRaw).slice(0, 10),
            end: String(tempEndRaw).slice(0, 10),
        };

        // Step 16: Read dwc.datasets (exactly 1 row in v1.2 per POLICY §6.2).
        const datasetsReader = await conn.runAndReadAll(
            'SELECT * FROM pgdb.dwc.datasets LIMIT 1',
        );
        const datasetsRows = datasetsReader.getRowObjects();
        if (datasetsRows.length === 0) {
            throw new Error(
                'dwc.datasets is empty — expected exactly 1 row per POLICY §6.2 D-16',
            );
        }
        const datasetsRow = datasetsRows[0] as unknown as DatasetsRow;

        // Step 17: Build the two XML strings via the pure Plan 03 generators.
        const metaXml = buildMetaXml(OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS);
        const emlXml = buildEml({ datasets: datasetsRow, temporalCoverage });

        // Step 18: Read the two .txt files back into buffers.
        const occBuf = await readFile(OUT_OCCURRENCE);
        const mmBuf = await readFile(OUT_MULTIMEDIA);

        // Step 19: UTF-8 BOM defense-in-depth check. DuckDB never writes a
        // BOM per RESEARCH §T2, but a future regression would silently
        // produce mis-parsed CSVs downstream — surface here.
        if (occBuf[0] === 0xef || mmBuf[0] === 0xef) {
            throw new Error(
                'BOM detected in DuckDB output — expected UTF-8 no BOM',
            );
        }

        // Step 20: Assemble zip — meta.xml → eml.xml → occurrence.txt →
        // multimedia.txt (DwC-A convention).
        await writeZip(OUT_ZIP, [
            { name: 'meta.xml', content: Buffer.from(metaXml, 'utf8') },
            { name: 'eml.xml', content: Buffer.from(emlXml, 'utf8') },
            { name: 'occurrence.txt', content: occBuf },
            { name: 'multimedia.txt', content: mmBuf },
        ]);

        // Step 21: Final zero-byte guard on the zip.
        await assertNoZeroByteFile(OUT_ZIP);

        // Step 22: Success log.
        console.log(
            `[build:dwca] OK — ${occCount} occurrence rows, parquet=${OUT_PARQUET}, zip=${OUT_ZIP}`,
        );
    } finally {
        conn.closeSync();
    }
}

// Entry-point conditional — only run main() when invoked as a script (e.g.
// `tsx scripts/dwca/build.ts`). Importing this module from a test does NOT
// trigger the pipeline.
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[build:dwca] FAILED:', msg);
        if (err && typeof err === 'object' && 'diff' in err) {
            const diff = (err as { diff: readonly string[] }).diff;
            for (const line of diff) {
                console.error(line);
            }
        }
        process.exit(1);
    });
}
