/**
 * Which register entity each Maplify sighting names, resolved in the build (decision 061,
 * salish-xv35.11) rather than read from the column the ingest wrote, so the Maplify mirror
 * can hold only what Maplify said.
 *
 * The rule is the ingest's own `resolveEntity` (scripts/ingest/maplify.ts) over the
 * register's name index, which the build reads from its snapshot of the register with the
 * same SQL the ingest runs in Postgres (NAME_INDEX_SQL). As resolve-maplify.ts does, it runs
 * once per distinct (name, scientific name) pair, about eighty, not once per sighting, and
 * SQL joins the answers.
 */

import type { DuckDBConnection } from '@duckdb/node-api';

import { resolveEntity, type NormalizedSighting } from '../../ingest/maplify.ts';
import { buildNameIndex, NAME_INDEX_SQL, type RegisterName } from '../../register/name-index.ts';

/**
 * Write `maplify_entity(name, scientific_name, entity_id)`, one row per distinct pair the
 * sightings use, into the connection's in-memory catalog. The connection must already be
 * using the snapshot.
 */
export async function writeMaplifyEntities(conn: DuckDBConnection): Promise<void> {
    const names = (await conn.runAndReadAll(NAME_INDEX_SQL)).getRowObjectsJS() as unknown as RegisterName[];
    const index = buildNameIndex(names);
    const pairs = (await conn.runAndReadAll(
        'SELECT DISTINCT name, scientific_name FROM maplify.sightings',
    )).getRows() as [string | null, string][];
    await conn.run(`CREATE OR REPLACE TABLE memory.main.maplify_entity (
        name VARCHAR, scientific_name VARCHAR, entity_id VARCHAR)`);
    const appender = await conn.createAppender('maplify_entity', 'main', 'memory');
    try {
        for (const [name, scientificName] of pairs) {
            // resolveEntity reads only these two of a sighting's fields.
            const entity = resolveEntity({name, scientificName} as NormalizedSighting, index);
            if (name === null) appender.appendNull(); else appender.appendVarchar(name);
            appender.appendVarchar(scientificName);
            if (entity === null) appender.appendNull(); else appender.appendVarchar(entity);
            appender.endRow();
        }
        appender.flushSync();
    } finally {
        appender.closeSync();
    }
}
