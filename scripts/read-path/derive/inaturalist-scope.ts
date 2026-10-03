/**
 * Which iNaturalist observations are out of the map's scope, decided in the build
 * (decision 061, salish-xv35.8), as derive/maplify-entities.ts decides Maplify's: the
 * build's iNaturalist mirror keeps everything in the fetch box, so the ingest's own
 * isIngestable runs here (decision 044: a killer whale anywhere, anything else only inside
 * the Salish Sea).
 *
 * isIngestable reads an observation's taxon ancestry, which iNaturalist sends with each
 * observation. What the build derives from today, Postgres's copy, doesn't keep it, so the
 * ancestry is walked up the taxa table's parent links, which the taxon closure guarantees
 * are all there.
 */

import type { DuckDBConnection } from '@duckdb/node-api';

import { isIngestable, type NormalizedObservation } from '../../ingest/inaturalist.ts';

/** A taxon's ancestors, nearest last, by its parent links; a cycle or a gap ends the walk. */
export function ancestry(taxonId: number, parentOf: ReadonlyMap<number, number | null>): number[] {
    const chain: number[] = [];
    const seen = new Set<number>([taxonId]);
    for (let p = parentOf.get(taxonId) ?? null; p !== null && !seen.has(p); p = parentOf.get(p) ?? null) {
        seen.add(p);
        chain.unshift(p);
    }
    return chain;
}

/**
 * Write `inaturalist_out_of_scope(id)` into the connection's in-memory catalog. The
 * connection must already be using the snapshot.
 */
export async function writeInaturalistOutOfScope(conn: DuckDBConnection): Promise<void> {
    const parentOf = new Map(
        ((await conn.runAndReadAll('SELECT id, parent_id FROM source_inaturalist_taxa')).getRows() as [number, number | null][]));
    await conn.run('CREATE OR REPLACE TABLE memory.main.inaturalist_out_of_scope (id BIGINT)');
    // Streamed, as the Maplify sightings are: there are tens of thousands.
    const result = await conn.stream(
        'SELECT id, location_lon, location_lat, taxon_id FROM source_inaturalist_observations');
    const out: bigint[] = [];
    for await (const rows of result.yieldRows() as AsyncIterable<[bigint, number, number, number][]>) {
        for (const [id, lon, lat, taxonId] of rows) {
            // isIngestable reads only these of an observation's fields.
            const o = {lon, lat, taxonId, ancestorIds: ancestry(taxonId, parentOf)} as unknown as NormalizedObservation;
            if (!isIngestable(o)) out.push(id);
        }
    }
    const appender = await conn.createAppender('inaturalist_out_of_scope', 'main', 'memory');
    try {
        for (const id of out) {
            appender.appendBigInt(id);
            appender.endRow();
        }
        appender.flushSync();
    } finally {
        appender.closeSync();
    }
}
