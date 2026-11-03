/**
 * What each occurrence's text says, read in the build by the same module the browser runs,
 * src/sighting-text.ts (decision 105, replacing the regex macros the build ran as twins of
 * Postgres's). Written into the connection's in-memory catalog as occurrence_place and
 * maplify_entity are, and joined by the three views in derive/occurrences.sql that read
 * text: Maplify's comments, iNaturalist's descriptions and our own sightings' bodies.
 * Orcasound's bouts carry their identifiers as tags, not text, so they have no reading.
 *
 * `reading(id, direction, claims, pods)`, keyed by the occurrence's id as its view spells
 * it. `claims` is every code the text names with whether it says the animal was present or
 * absent and how sure the reporter was; the views take the present codes as the
 * occurrence's identifiers, and presence and certainty wait for salish-uh38 to be stored.
 * A text that names nothing has no row.
 *
 * `remark_claims(id, origin, origin_id, claims, pods)`: the same reading of what people
 * wrote on an iNaturalist observation besides its description, each comment and each
 * identification's remark read alone (salish-4s42, decision 106). The codes and pods it
 * names join the occurrence's own; its direction is not read, since a direction is the
 * observer's (a commenter's "heading north" may be about another moment). Kept apart from
 * `reading` so each code keeps where it was read.
 */

import type { DuckDBConnection } from '@duckdb/node-api';

import { readSighting, readText, type Reading } from '../../../src/sighting-text.ts';

/** Each source's texts, by the id its occurrence view gives it. */
export const TEXTS = {
    maplify: `SELECT 'maplify:' || id, comments FROM source_maplify_sightings WHERE comments IS NOT NULL AND comments <> ''`,
    inaturalist: `SELECT 'inaturalist:' || id, description FROM source_inaturalist_observations WHERE description IS NOT NULL AND description <> ''`,
    native: `SELECT CAST(id AS VARCHAR), body FROM public.observations WHERE body IS NOT NULL AND body <> ''`,
} as const;
export type TextSource = keyof typeof TEXTS;
export const readsText = (source: string): source is TextSource => source in TEXTS;

const READING_SHAPE = JSON.stringify({direction: 'VARCHAR', claims: [{code: 'VARCHAR', presence: 'VARCHAR', certainty: 'VARCHAR'}], pods: ['VARCHAR']});

export const CREATE_READING = `CREATE OR REPLACE TABLE memory.main.reading (
    id VARCHAR, direction VARCHAR,
    claims STRUCT(code VARCHAR, presence VARCHAR, certainty VARCHAR)[], pods VARCHAR[])`;

/**
 * What people wrote on an iNaturalist observation besides its description, as
 * derive/sources.sql's source_inaturalist_remarks gives it, keyed as `reading` is.
 */
export const REMARKS = `SELECT 'inaturalist:' || observation_id, origin, origin_id, body FROM source_inaturalist_remarks`;

const REMARK_SHAPE = JSON.stringify({claims: [{code: 'VARCHAR', presence: 'VARCHAR', certainty: 'VARCHAR'}], pods: ['VARCHAR']});

export const CREATE_REMARK_CLAIMS = `CREATE OR REPLACE TABLE memory.main.remark_claims (
    id VARCHAR, origin VARCHAR, origin_id BIGINT,
    claims STRUCT(code VARCHAR, presence VARCHAR, certainty VARCHAR)[], pods VARCHAR[])`;

/**
 * Append the claims and pods of each remark that names an animal or a pod to memory.main.remark_claims,
 * which CREATE_REMARK_CLAIMS made, as writeReadings does. A remark is read exactly as
 * written (readText): it has neither the collection tag nor the "Submitted by" tail that
 * readSighting strips from a report.
 */
export async function writeRemarkClaims(conn: DuckDBConnection): Promise<number> {
    const result = await conn.stream(REMARKS);
    const found: [string, string, bigint, Pick<Reading, 'claims' | 'pods'>][] = [];
    for await (const rows of result.yieldRows() as AsyncIterable<[string, string, bigint, string][]>) {
        for (const [id, origin, originId, body] of rows) {
            const {claims, pods} = readText(body);
            if (claims.length || pods.length) found.push([id, origin, originId, {claims, pods}]);
        }
    }
    await conn.run('CREATE OR REPLACE TABLE memory.main.remark_text (id VARCHAR, origin VARCHAR, origin_id BIGINT, reading VARCHAR)');
    const appender = await conn.createAppender('remark_text', 'main', 'memory');
    try {
        for (const [id, origin, originId, reading] of found) {
            appender.appendVarchar(id);
            appender.appendVarchar(origin);
            appender.appendBigInt(originId);
            appender.appendVarchar(JSON.stringify(reading));
            appender.endRow();
        }
        appender.flushSync();
    } finally {
        appender.closeSync();
    }
    await conn.run(`INSERT INTO memory.main.remark_claims
        SELECT id, origin, origin_id, r.claims, r.pods
        FROM (SELECT id, origin, origin_id, from_json(reading, '${REMARK_SHAPE}') AS r FROM memory.main.remark_text)`);
    await conn.run('DROP TABLE memory.main.remark_text');
    return found.length;
}

/**
 * Append one source's readings to memory.main.reading, which CREATE_READING made. The
 * texts are streamed out of DuckDB and only the readings that found something are kept,
 * since an appender can't write on the connection while its stream is open. Each reading
 * goes in as JSON text, which DuckDB then parses: appending the claims as lists of
 * structs through the Node API cost 110 MB and 0.3 s more for Maplify's 21,000 readings
 * (2026-11-02).
 */
export async function writeReadings(conn: DuckDBConnection, source: TextSource): Promise<number> {
    const result = await conn.stream(TEXTS[source]);
    const found: [string, Reading][] = [];
    for await (const rows of result.yieldRows() as AsyncIterable<[string, string][]>) {
        for (const [id, body] of rows) {
            const reading = readSighting(body);
            if (reading.claims.length || reading.pods.length || reading.direction !== null) found.push([id, reading]);
        }
    }
    await conn.run('CREATE OR REPLACE TABLE memory.main.reading_text (id VARCHAR, reading VARCHAR)');
    const appender = await conn.createAppender('reading_text', 'main', 'memory');
    try {
        for (const [id, reading] of found) {
            appender.appendVarchar(id);
            appender.appendVarchar(JSON.stringify(reading));
            appender.endRow();
        }
        appender.flushSync();
    } finally {
        appender.closeSync();
    }
    await conn.run(`INSERT INTO memory.main.reading
        SELECT id, r.direction, r.claims, r.pods
        FROM (SELECT id, from_json(reading, '${READING_SHAPE}') AS r FROM memory.main.reading_text)`);
    await conn.run('DROP TABLE memory.main.reading_text');
    return found.length;
}
