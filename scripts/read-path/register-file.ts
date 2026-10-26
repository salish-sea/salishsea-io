/**
 * The register's own DuckDB file (salish-vedj). ingest-register writes the register's tables
 * there, beside the mirrors, writing a new file and renaming it over the old so a reader
 * that already has it open keeps the edition it opened. It used to be a schema of the
 * snapshot file, which DuckDB lets one process open for writing and nobody else open
 * meanwhile, so no ingest could run beside a build of the rest.
 *
 * Attached as `register`, its tables keep the names they had as that schema
 * (`register.entities` and the rest), so the derivations' SQL reads them unchanged.
 */

import path from 'node:path';

import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Where the register is for a build whose snapshot is `snapshot`: `mirrors/` beside it, the
 * rule Stelis's salishsea.rkt places the mirrors and the register by (register-db).
 */
export function registerFile(snapshot: string): string {
    return path.join(path.dirname(snapshot), 'mirrors', 'register.duckdb');
}

/** Attach the register read-only as `register`. */
export async function attachRegister(conn: DuckDBConnection, file: string): Promise<void> {
    await conn.run(`ATTACH '${file.replaceAll("'", "''")}' AS register (READ_ONLY)`);
}
