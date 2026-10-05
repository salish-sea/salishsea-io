/**
 * The upstream sources a derivation reads (decision 061, salish-xv35.9): the build's
 * mirrors, attached under the names Stelis reads them by, and derive/sources.sql's views
 * over them in the shape of Postgres's tables.
 */

import type { DuckDBConnection } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

/** Each source's SQLite mirror, as the ingest tasks write them. */
export type Mirrors = {maplify: string, inaturalist: string, orcasound: string};

/** Stelis's names for them (src/salishsea.rkt's relation resolver). */
const ALIASES = {maplify: 'maplify_mirror', inaturalist: 'inaturalist_mirror', orcasound: 'orcasound'} as const;

export async function attachSources(conn: DuckDBConnection, mirrors: Mirrors): Promise<void> {
    await conn.run('INSTALL sqlite; LOAD sqlite');
    for (const [source, alias] of Object.entries(ALIASES) as [keyof Mirrors, string][])
        await conn.run(`ATTACH '${mirrors[source].replaceAll("'", "''")}' AS ${alias} (TYPE sqlite, READ_ONLY)`);
    await conn.run(await readFile(new URL('./sources.sql', import.meta.url), 'utf8'));
    await conn.run(await readFile(new URL('./source-taxa.sql', import.meta.url), 'utf8'));
}

/**
 * Only iNaturalist's taxa (derive/source-taxa.sql), for a derivation that reads no other
 * source: the catalogue's views (derive-catalogue.ts). It then needs only that mirror to
 * exist, which is all its task declares.
 */
export async function attachTaxa(conn: DuckDBConnection, inaturalist: string): Promise<void> {
    await conn.run('INSTALL sqlite; LOAD sqlite');
    await conn.run(`ATTACH '${inaturalist.replaceAll("'", "''")}' AS ${ALIASES.inaturalist} (TYPE sqlite, READ_ONLY)`);
    await conn.run(await readFile(new URL('./source-taxa.sql', import.meta.url), 'utf8'));
}

/** The three mirror paths from a command line, in Mirrors' order, or null if any is missing. */
export function mirrorArgs(args: readonly string[]): Mirrors | null {
    const [maplify, inaturalist, orcasound] = args;
    return maplify && inaturalist && orcasound ? {maplify, inaturalist, orcasound} : null;
}
