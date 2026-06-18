/**
 * Runtime build-time guards consumed by `scripts/dwca/build.ts` (Plan 05).
 *
 * Three independent guards, each addressing a distinct silent-failure mode:
 *
 *   1. `assertFieldAlignment` — the F-02 invariant: the live `dwc.occurrences`
 *      / `dwc.multimedia` view column list (name AND ordinal) must match the
 *      canonical TS field array in `./fields.ts`. The Plan 02 unit guardrail
 *      catches drift in `fields.ts`; this runtime guardrail catches drift in
 *      the Postgres view (a future migration that adds/removes/reorders a
 *      column without editing `fields.ts` would otherwise silently emit a
 *      wrong-shape archive).
 *
 *   2. `assertNonZeroRows` — guards against shipping an archive whose
 *      occurrence file has zero rows (e.g. a stale `dwc.occurrences` view
 *      that resolves to no rows because of a schema rename upstream).
 *
 *   3. `assertNoZeroByteFile` — guards against shipping a zero-byte archive
 *      file (e.g. the deterministic-zip writer races a filesystem failure).
 *
 * All three throw `Error` (subclass) — none of them call `process.exit`,
 * so they remain unit-testable in Vitest. The caller in `build.ts` catches
 * and exits non-zero with a structured human-readable message.
 *
 * Cross-reference: see `.planning/phases/06-archive-generation/06-CONTEXT.md`
 * F-02 for the invariant; this file is the F-02 runtime guardrail.
 */

import { stat } from 'node:fs/promises';

/**
 * One column row returned by DuckDB `DESCRIBE pgdb.dwc.occurrences` (or
 * `pgdb.information_schema.columns`). `ordinal` is 1-based to match
 * `information_schema.columns.ordinal_position`; the diff strings render
 * the 1-based ordinal for human readability.
 *
 * The structural type avoids importing the DuckDB Node bindings here,
 * keeping `assertions.ts` DuckDB-agnostic and trivially mockable in tests.
 */
export interface PgColumn {
    readonly name: string;
    readonly ordinal: number;
}

/**
 * Thrown by `assertFieldAlignment` when the Postgres view's column list
 * diverges from the canonical TS field array. Carries the offending
 * `table` and a structured `diff` array; the caller can render the diff
 * verbatim (each entry is a one-line human-readable string).
 */
export class AlignmentError extends Error {
    public readonly table: string;
    public readonly diff: readonly string[];

    constructor(message: string, table: string, diff: readonly string[]) {
        super(message);
        this.name = 'AlignmentError';
        this.table = table;
        this.diff = diff;
    }
}

/**
 * F-02 runtime guardrail. Compares the Postgres view's column list
 * (`pgCols`, in column order, 1-based ordinal) to the canonical TS field
 * array (`tsFields`, in array index order) position-by-position. Returns
 * silently on full alignment; throws `AlignmentError` carrying a
 * structured diff on any name or count mismatch.
 *
 * The diff uses three single-character markers at each divergent index:
 *   - `[+i]` — TS array has an entry; PG view has no column at this ordinal.
 *   - `[-i]` — PG view has a column at this ordinal; TS array ends here.
 *   - `[~i]` — both sides have an entry but the names differ.
 *
 * `i` is the 0-based loop index (matches the TS array index); the PG
 * ordinal (1-based) is embedded in the rendered string for readability.
 */
export function assertFieldAlignment(
    pgCols: readonly PgColumn[],
    tsFields: readonly { readonly name: string }[],
    table: string,
): void {
    const diff: string[] = [];
    const max = Math.max(pgCols.length, tsFields.length);

    for (let i = 0; i < max; i++) {
        const pg = pgCols[i];
        const ts = tsFields[i];

        if (pg === undefined && ts !== undefined) {
            diff.push(
                `[+${i}] TS array has "${ts.name}" but view has no column at ordinal ${i + 1}`,
            );
        } else if (pg !== undefined && ts === undefined) {
            diff.push(
                `[-${i}] View has "${pg.name}" at ordinal ${pg.ordinal} but TS array ends`,
            );
        } else if (pg !== undefined && ts !== undefined && pg.name !== ts.name) {
            diff.push(
                `[~${i}] TS expects "${ts.name}" but view has "${pg.name}" at ordinal ${pg.ordinal}`,
            );
        }
    }

    if (diff.length === 0) {
        return;
    }

    const message = `Field alignment mismatch for dwc.${table}:\n${diff.join('\n')}`;
    throw new AlignmentError(message, table, diff);
}

/**
 * Structural interface for the minimum DuckDB connection surface needed
 * by `assertNonZeroRows`. The real `DuckDBConnection.runAndReadAll`
 * shape matches — but typing structurally lets tests supply a plain
 * object mock and keeps the DuckDB Node bindings out of the import graph.
 */
export interface CountConnection {
    runAndReadAll(sql: string): Promise<{
        getRowObjects(): Record<string, unknown>[];
    }>;
}

/**
 * Runs `SELECT COUNT(*) AS n FROM ${fullyQualifiedTable}` and returns the
 * count as a bigint. Throws `Error('Empty result: ' + fullyQualifiedTable)`
 * if the count is zero.
 *
 * `fullyQualifiedTable` is passed through to the SQL — callers MUST hardcode
 * it (e.g. `'pgdb.dwc.occurrences'`). There is no escaping here because
 * this is a build-time module fed by hardcoded constants.
 */
export async function assertNonZeroRows(
    conn: CountConnection,
    fullyQualifiedTable: string,
): Promise<bigint> {
    const result = await conn.runAndReadAll(
        `SELECT COUNT(*) AS n FROM ${fullyQualifiedTable}`,
    );
    const rows = result.getRowObjects();
    const first = rows[0];
    const raw = first?.['n'];
    const n = typeof raw === 'bigint' ? raw : BigInt(raw as number | string);

    if (n === 0n) {
        throw new Error(`Empty result: ${fullyQualifiedTable}`);
    }

    return n;
}

/**
 * `stat`s `path` and throws `Error('Zero-byte file: ' + path)` if the file
 * is zero bytes. Returns void on success. Lets any underlying `stat`
 * error (e.g. ENOENT) propagate.
 */
export async function assertNoZeroByteFile(path: string): Promise<void> {
    const s = await stat(path);
    if (s.size === 0) {
        throw new Error(`Zero-byte file: ${path}`);
    }
}
