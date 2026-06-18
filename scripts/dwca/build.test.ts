/**
 * DwC-A build pipeline integration test — Phase 06 Plan 06.
 *
 * Exercises `npm run build:dwca` end-to-end against the live local Supabase
 * Postgres, then introspects the produced artifacts in `dist/dwca/`. Covers
 * five of the six DWCA-* requirements automatically:
 *
 *   - DWCA-01: zip exists with the four expected entries; parquet sidecar present.
 *   - DWCA-02: meta.xml field indices round-trip against `OCCURRENCE_FIELDS`
 *     and `MULTIMEDIA_FIELDS` and the data-file header rows.
 *   - DWCA-03: every multimedia.coreId appears in the occurrence.occurrenceID set.
 *   - DWCA-04: neither CSV starts with the UTF-8 BOM bytes EF BB BF; every
 *     occurrence row splits into exactly 25 fields (no embedded tab leakage).
 *   - DWCA-06: parquet `geo` kv-metadata is GeoParquet 1.0.0 / primary_column=
 *     geometry / encoding=WKB; column count is 26 (25 dwc + geometry); row
 *     count matches the source view; ST_AsText round-trips POINT.
 *
 * DWCA-05 is the GBIF validator manual upload — handled by Task 2's checkpoint.
 *
 * GATING: The whole describe block is skipped unless `SUPABASE_DB_URL` is
 * exported in the environment. `vitest.config.ts` calls `loadEnv(mode, ...)`,
 * which sources `.env.local` / `.env.{mode}` files — if a developer puts
 * `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
 * in `.env.local`, the integration suite activates automatically. Otherwise
 * the unit-test suite still runs green on a fresh checkout.
 *
 * SECURITY: The DSN is never logged. We pass it to the child build via
 * `execSync(..., { env: { ...process.env, SUPABASE_DB_URL: DSN } })` and to
 * DuckDB ATTACH via a string-interpolated SQL statement, but never
 * `console.log` it or include it in error messages.
 *
 * Cross-reference: 06-RESEARCH.md §T8 (round-trip parse pattern), §T10
 * (Vitest gating), §T11 (DuckDB parquet introspection); 06-CONTEXT.md F-05
 * (no BOM, tab/newline collapse); 06-VALIDATION.md Per-Task Verification
 * Map (this file populates DWCA-01..04/06).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

import { DuckDBInstance } from '@duckdb/node-api';

import { OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS } from './fields.ts';

// ---------------------------------------------------------------------------
// Gating + artifact paths
// ---------------------------------------------------------------------------

const DSN = process.env['SUPABASE_DB_URL'];
const HAS_DSN = !!DSN;

const DIST = path.resolve(process.cwd(), 'dist/dwca');
const ZIP = path.join(DIST, 'salishsea-occurrences-v1.zip');
const PARQUET = path.join(DIST, 'salishsea-occurrences-v1.parquet');
const OCC_TXT = path.join(DIST, 'occurrence.txt');
const MM_TXT = path.join(DIST, 'multimedia.txt');

// When DSN is absent, use describe.skip so every nested test reports as
// skipped (with a clean reason). When DSN is present, run the suite. This
// pattern keeps Vitest's exit code at 0 on a fresh checkout while still
// surfacing each integration test name in the reporter when active.
const d = HAS_DSN
    ? describe
    : describe.skip;

d('build:dwca integration (DWCA-01..04/06; requires SUPABASE_DB_URL)', () => {
    beforeAll(() => {
        // Run the full pipeline against the live local DB. stdio:'inherit'
        // forwards build.ts's progress log to the test output. The
        // SUPABASE_DB_URL env is passed through explicitly — it is NEVER
        // interpolated into the command string.
        execSync('npm run build:dwca', {
            stdio: 'inherit',
            env: { ...process.env, SUPABASE_DB_URL: DSN as string },
        });
    }, 60_000);

    // -----------------------------------------------------------------------
    // DWCA-01: zip + parquet artifacts exist
    // -----------------------------------------------------------------------

    test('DWCA-01: zip exists with four entries in the documented order', () => {
        expect(existsSync(ZIP)).toBe(true);
        expect(statSync(ZIP).size).toBeGreaterThan(0);

        // Use `unzip -l` to enumerate the central directory in archive order.
        // Available on macOS and the ubuntu GitHub runner by default.
        const listing = execSync(`unzip -l ${ZIP}`, { encoding: 'utf8' });
        for (const name of ['meta.xml', 'eml.xml', 'occurrence.txt', 'multimedia.txt']) {
            expect(listing).toContain(name);
        }
    });

    test('DWCA-01 secondary: parquet sidecar exists and is non-empty', () => {
        expect(existsSync(PARQUET)).toBe(true);
        expect(statSync(PARQUET).size).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    // DWCA-02: meta.xml field indices align with data-file header columns
    // -----------------------------------------------------------------------

    test('DWCA-02: meta.xml core field indices round-trip with OCCURRENCE_FIELDS', () => {
        const metaXml = execSync(`unzip -p ${ZIP} meta.xml`, { encoding: 'utf8' });

        // Extract the <core>...</core> block (greedy across newlines).
        const coreMatch = metaXml.match(/<core\b[\s\S]*?<\/core>/);
        expect(coreMatch, 'meta.xml must contain a <core>...</core> block').toBeTruthy();
        const coreBlock = coreMatch![0];

        const fieldPairs = [...coreBlock.matchAll(/<field\s+index="(\d+)"\s+term="([^"]+)"\s*\/>/g)]
            .map((m) => [m[1]!, m[2]!] as const)
            .sort((a, b) => Number(a[0]) - Number(b[0]));

        const expected = OCCURRENCE_FIELDS.map((f, i) => [String(i), f.termUri] as const);
        expect(fieldPairs).toEqual(expected);

        const header = readFileSync(OCC_TXT, 'utf8').split('\n')[0]!.split('\t');
        expect(header).toEqual(OCCURRENCE_FIELDS.map((f) => f.name));
    });

    test('DWCA-02: meta.xml extension field indices round-trip with MULTIMEDIA_FIELDS', () => {
        const metaXml = execSync(`unzip -p ${ZIP} meta.xml`, { encoding: 'utf8' });

        const extMatch = metaXml.match(/<extension\b[\s\S]*?<\/extension>/);
        expect(extMatch, 'meta.xml must contain an <extension>...</extension> block').toBeTruthy();
        const extBlock = extMatch![0];

        const fieldPairs = [...extBlock.matchAll(/<field\s+index="(\d+)"\s+term="([^"]+)"\s*\/>/g)]
            .map((m) => [m[1]!, m[2]!] as const)
            .sort((a, b) => Number(a[0]) - Number(b[0]));

        const expected = MULTIMEDIA_FIELDS.map((f, i) => [String(i), f.termUri] as const);
        expect(fieldPairs).toEqual(expected);

        const header = readFileSync(MM_TXT, 'utf8').split('\n')[0]!.split('\t');
        expect(header).toEqual(MULTIMEDIA_FIELDS.map((f) => f.name));
    });

    // -----------------------------------------------------------------------
    // DWCA-03: multimedia anti-join is empty
    // -----------------------------------------------------------------------

    test('DWCA-03: every multimedia.coreId is present in occurrence.occurrenceID', () => {
        const occLines = readFileSync(OCC_TXT, 'utf8').split('\n').filter(Boolean);
        // Drop the header; column 0 of OCCURRENCE_FIELDS is occurrenceID.
        const occIds = new Set(occLines.slice(1).map((l) => l.split('\t')[0]!));

        const mmLines = readFileSync(MM_TXT, 'utf8').split('\n').filter(Boolean);
        // mmLines[0] is the header; rows[1..] are data. If multimedia.txt has
        // only the header (no observation photos in the seed), the anti-join
        // is trivially empty and the test passes — that is the correct
        // behavior per the plan's threat register (T-06-06-EMPTY-MM accept).
        const orphans: string[] = [];
        for (const row of mmLines.slice(1)) {
            const coreId = row.split('\t')[0]!;
            if (!occIds.has(coreId)) orphans.push(coreId);
        }
        expect(orphans).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // DWCA-04: no BOM; freetext tab-collapse keeps rows at fixed column count
    // -----------------------------------------------------------------------

    test('DWCA-04: occurrence.txt has no UTF-8 BOM', () => {
        const buf = readFileSync(OCC_TXT);
        // BOM is the byte sequence EF BB BF. Any one byte mismatching is enough.
        const isBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
        expect(isBom).toBe(false);
    });

    test('DWCA-04: multimedia.txt has no UTF-8 BOM', () => {
        const buf = readFileSync(MM_TXT);
        const isBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
        expect(isBom).toBe(false);
    });

    test('DWCA-04: every occurrence row has exactly 25 tab-delimited columns (no leaked tabs)', () => {
        const lines = readFileSync(OCC_TXT, 'utf8').split('\n').filter(Boolean);
        // Skip header. If a freetext column carried an unescaped tab, the
        // row would have >25 fields and this test would fail loudly.
        const widths = lines.slice(1).map((l) => l.split('\t').length);
        const wrong = widths.filter((n) => n !== OCCURRENCE_FIELDS.length);
        expect(wrong).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // DWCA-02 round-trip (concrete): first data row has 25 fields and the
    // rightsHolder / license indices carry interpretable strings. We do NOT
    // assert specific values — the GBIF validator (Task 2) is the semantic
    // judge. We only assert the column-to-term wiring is intact.
    // -----------------------------------------------------------------------

    test('DWCA-02 round-trip: first occurrence row has 25 fields; rightsHolder + license columns populated', () => {
        const lines = readFileSync(OCC_TXT, 'utf8').split('\n').filter(Boolean);
        expect(lines.length).toBeGreaterThan(1); // header + at least one row
        const firstDataRow = lines[1]!.split('\t');
        expect(firstDataRow.length).toBe(OCCURRENCE_FIELDS.length);

        // OCCURRENCE_FIELDS[19] is rightsHolder; [22] is license. Find them
        // dynamically to be robust against any future reorder + still gate
        // on the canonical names.
        const rhIdx = OCCURRENCE_FIELDS.findIndex((f) => f.name === 'rightsHolder');
        const licIdx = OCCURRENCE_FIELDS.findIndex((f) => f.name === 'license');
        expect(rhIdx).toBeGreaterThanOrEqual(0);
        expect(licIdx).toBeGreaterThanOrEqual(0);
        // Values may be empty strings if the seed row has NULLs; we assert
        // the cells are reachable strings (not undefined) — that proves the
        // header-to-row width contract end-to-end.
        expect(typeof firstDataRow[rhIdx]).toBe('string');
        expect(typeof firstDataRow[licIdx]).toBe('string');
    });

    // -----------------------------------------------------------------------
    // DWCA-06: parquet GeoParquet 1.0.0 metadata + row count + WKT round-trip
    // -----------------------------------------------------------------------

    test('DWCA-06: parquet has GeoParquet 1.0.0 metadata, 26 columns, row parity, POINT geometries', async () => {
        const db = await DuckDBInstance.create(':memory:');
        const conn = await db.connect();
        try {
            await conn.run('INSTALL spatial; LOAD spatial;');
            await conn.run('INSTALL postgres; LOAD postgres;');

            // (1) GeoParquet kv-metadata. parquet_kv_metadata returns BLOBs;
            // `decode(...)` casts them to VARCHAR (per the §R1 footgun fix in
            // build.ts step 12). value::text would hex-escape bytes.
            const geoReader = await conn.runAndReadAll(
                `SELECT decode(key) AS k, decode(value) AS v FROM parquet_kv_metadata('${PARQUET}') WHERE key = 'geo'::blob`,
            );
            const geoRows = geoReader.getRowObjects();
            expect(geoRows.length).toBe(1);
            const geoJsonRaw = geoRows[0]!['v'];
            const geo = JSON.parse(
                typeof geoJsonRaw === 'string' ? geoJsonRaw : String(geoJsonRaw),
            );
            expect(geo.version).toBe('1.0.0');
            expect(geo.primary_column).toBe('geometry');
            expect(geo.columns.geometry.encoding).toBe('WKB');
            // geometry_types is present in DuckDB 1.1+; assert if available.
            if (Array.isArray(geo.columns.geometry.geometry_types)) {
                const types: string[] = geo.columns.geometry.geometry_types;
                const hasPoint = types.some((t) => t === 'Point' || t.startsWith('Point'));
                expect(hasPoint).toBe(true);
            }

            // (2) Column count = 25 dwc + 1 geometry = 26.
            const descReader = await conn.runAndReadAll(
                `DESCRIBE SELECT * FROM read_parquet('${PARQUET}')`,
            );
            expect(descReader.getRowObjects().length).toBe(
                OCCURRENCE_FIELDS.length + 1,
            );

            // (3) Geometry round-trip — every wkt starts with POINT.
            const wktReader = await conn.runAndReadAll(
                `SELECT ST_AsText(geometry) AS wkt FROM read_parquet('${PARQUET}') LIMIT 5`,
            );
            const wktRows = wktReader.getRowObjects();
            expect(wktRows.length).toBeGreaterThan(0);
            for (const row of wktRows) {
                const wkt = String(row['wkt']).toUpperCase();
                expect(wkt.startsWith('POINT(') || wkt.startsWith('POINT (')).toBe(true);
            }

            // (4) Row-count parity: parquet vs source view. Attach the same
            // Postgres DSN read-only, then compare counts.
            await conn.run(
                `ATTACH '${DSN}' AS pgdb (TYPE postgres, READ_ONLY)`,
            );
            const viewCountReader = await conn.runAndReadAll(
                'SELECT COUNT(*) AS n FROM pgdb.dwc.occurrences',
            );
            const parquetCountReader = await conn.runAndReadAll(
                `SELECT COUNT(*) AS n FROM read_parquet('${PARQUET}')`,
            );
            const viewN = viewCountReader.getRowObjects()[0]!['n'];
            const parquetN = parquetCountReader.getRowObjects()[0]!['n'];
            const toBig = (v: unknown): bigint =>
                typeof v === 'bigint' ? v : BigInt(v as number | string);
            expect(toBig(parquetN)).toBe(toBig(viewN));
        } finally {
            conn.closeSync();
        }
    }, 60_000);
});
