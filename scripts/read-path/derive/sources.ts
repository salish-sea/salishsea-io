/**
 * The upstream sources a derivation reads (decision 061, salish-xv35.9): the build's
 * mirrors, attached under the names Stelis reads them by, and derive/sources.sql's views
 * over them in the shape of Postgres's tables.
 */

import type { DuckDBConnection } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';
import { sqlString } from '../duckdb-budget.ts';

/**
 * Each source's SQLite mirror, as the ingest tasks write them. The two for Orcasound's
 * detections (salish-fizm.1, decision 122) are only for the derivation that reads them,
 * derive-occurrences.ts, which gives both or neither: the profile links and the archive
 * read no detection, so their tasks don't depend on those files.
 */
export type Mirrors = {
    maplify: string, inaturalist: string, orcasound: string,
    /** orcasite's detections, and OrcaHello's moderators' answers to them. */
    detections?: {orcasite: string, orcahello: string},
};

/** Stelis's names for them (src/salishsea.rkt's relation resolver). */
const ALIASES = {maplify: 'maplify_mirror', inaturalist: 'inaturalist_mirror', orcasound: 'orcasound'} as const;
const DETECTION_ALIASES = {orcasite: 'orcasound_detections', orcahello: 'orcahello'} as const;

export async function attachSources(conn: DuckDBConnection, mirrors: Mirrors): Promise<void> {
    await conn.run('INSTALL sqlite; LOAD sqlite');
    for (const [source, alias] of Object.entries(ALIASES) as [keyof typeof ALIASES, string][])
        await conn.run(`ATTACH ${sqlString(mirrors[source])} AS ${alias} (TYPE sqlite, READ_ONLY)`);
    await conn.run(await readFile(new URL('./sources.sql', import.meta.url), 'utf8'));
    await conn.run(await readFile(new URL('./source-taxa.sql', import.meta.url), 'utf8'));
    if (mirrors.detections) {
        for (const [source, alias] of Object.entries(DETECTION_ALIASES) as [keyof typeof DETECTION_ALIASES, string][])
            await conn.run(`ATTACH ${sqlString(mirrors.detections[source])} AS ${alias} (TYPE sqlite, READ_ONLY)`);
        await conn.run(await readFile(new URL('./detection-sources.sql', import.meta.url), 'utf8'));
    }
}

/**
 * Only iNaturalist's taxa (derive/source-taxa.sql), for a derivation that reads no other
 * source: the catalogue's views (derive-catalogue.ts). It then needs only that mirror to
 * exist, which is all its task declares.
 */
export async function attachTaxa(conn: DuckDBConnection, inaturalist: string): Promise<void> {
    await conn.run('INSTALL sqlite; LOAD sqlite');
    await conn.run(`ATTACH ${sqlString(inaturalist)} AS ${ALIASES.inaturalist} (TYPE sqlite, READ_ONLY)`);
    await conn.run(await readFile(new URL('./source-taxa.sql', import.meta.url), 'utf8'));
}

/**
 * The mirror paths from a command line, in Mirrors' order: the three sources', and
 * optionally orcasite's detections' and OrcaHello's after them. Null if one of the three is
 * missing, or if only one of the other two is given.
 */
export function mirrorArgs(args: readonly string[]): Mirrors | null {
    const [maplify, inaturalist, orcasound, orcasite, orcahello, ...rest] = args;
    if (!maplify || !inaturalist || !orcasound || rest.length > 0 || (orcasite === undefined) !== (orcahello === undefined)) return null;
    return orcasite && orcahello ? {maplify, inaturalist, orcasound, detections: {orcasite, orcahello}} : {maplify, inaturalist, orcasound};
}
