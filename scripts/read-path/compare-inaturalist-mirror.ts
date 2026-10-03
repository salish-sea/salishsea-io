/**
 * How the build's iNaturalist mirror compares with Postgres's copy, while both are
 * ingested (decision 061, salish-xv35.8).
 *
 *   node scripts/read-path/compare-inaturalist-mirror.ts <snapshot.duckdb> <inaturalist.sqlite> <report.json>
 *
 * A report, not a gate, as for Maplify and Orcasound (compare-maplify-mirror.ts): the two
 * fetch at different moments, and the mirror also reaches what Postgres's ten-day window
 * never sees (late uploads), so they are expected to differ. Whether the build stores a
 * response the way Postgres does is CI's question (ingest-inaturalist.test.ts). Any
 * difference still exits 0; only being unable to compare fails.
 *
 * Postgres keeps only what is in scope, so the mirror's side is filtered by the ingest's
 * isIngestable first, over the ancestry iNaturalist sent; how many it left out is
 * reported too. Only observations on days the mirror has reconciled (covered_days, by UTC
 * day) are compared. The fields are those the snapshot holds of an observation, and each
 * observation's photos.
 *
 * The mirror holds the whole fetch box since 1900, ~90,000 observations: it is streamed
 * once to decide scope, and every comparison runs in DuckDB, never as rows in node. Read
 * whole into node, it peaked at 615 MB.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { isIngestable, type NormalizedObservation } from '../ingest/inaturalist.ts';
import { budget } from './duckdb-budget.ts';

const SHOWN = 5;

/** The observation fields compared, as both sides are read below. */
const FIELDS = ['description', 'lon', 'lat', 'observed_ms', 'uri', 'login', 'taxon_id', 'public_positional_accuracy'] as const;

const DAY_MS = 86_400_000;

/** An observation's photos, for observations both sides hold, as comparable rows. */
const photoRows = (table: string) => `
    SELECT CAST(observation_id AS BIGINT) AS oid, CAST(id AS BIGINT) AS id, seq, attribution,
           CAST(hidden AS INTEGER) AS hidden, license, url
    FROM ${table} WHERE CAST(observation_id AS BIGINT) IN (SELECT id FROM both_sides)`;

export async function compareMirror(snapshot: string, mirror: string): Promise<Record<string, unknown>> {
    // The days reconciled, and which observations on them are in scope, in one pass.
    const local = new DatabaseSync(mirror, {readOnly: true});
    const days: string[] = [];
    const inScope: number[] = [];
    let outOfScope = 0;
    try {
        for (const r of local.prepare('SELECT day FROM covered_days ORDER BY day').iterate() as Iterable<{day: string}>)
            days.push(r.day);
        const covered = new Set(days.map(d => Date.parse(`${d}T00:00:00Z`) / DAY_MS));
        const rows = local.prepare('SELECT id, lon, lat, taxon_id, ancestor_ids, observed_ms FROM observations').iterate() as
            Iterable<{id: number, lon: number, lat: number, taxon_id: number, ancestor_ids: string, observed_ms: number}>;
        for (const r of rows) {
            if (!covered.has(Math.floor(r.observed_ms / DAY_MS))) continue;
            const o = {lon: r.lon, lat: r.lat, taxonId: r.taxon_id, ancestorIds: JSON.parse(r.ancestor_ids)} as unknown as NormalizedObservation;
            if (isIngestable(o)) inScope.push(r.id); else outOfScope++;
        }
    } finally {
        local.close();
    }

    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        // The photo lists (~150,000 photos) are what need it: at 64 MB DuckDB runs out.
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run(`ATTACH '${mirror.replaceAll("'", "''")}' AS m (TYPE sqlite, READ_ONLY)`);
        await conn.run('CREATE TEMP TABLE scope (id BIGINT)');
        await conn.run('CREATE TEMP TABLE covered (n BIGINT)');
        const scope = await conn.createAppender('scope', 'main', 'temp');
        for (const id of inScope) { scope.appendBigInt(BigInt(id)); scope.endRow(); }
        scope.flushSync();
        scope.closeSync();
        const covered = await conn.createAppender('covered', 'main', 'temp');
        for (const d of days) { covered.appendBigInt(BigInt(Date.parse(`${d}T00:00:00Z`) / DAY_MS)); covered.endRow(); }
        covered.flushSync();
        covered.closeSync();
        await conn.run(`
            CREATE TEMP TABLE pair AS
            WITH p AS (
                SELECT CAST(id AS BIGINT) AS id, description, location_lon AS lon, location_lat AS lat,
                       epoch_ms(observed_at) AS observed_ms, uri, username AS login, taxon_id, public_positional_accuracy
                FROM store.inaturalist.observations
                WHERE epoch_ms(observed_at) // ${DAY_MS} IN (SELECT n FROM covered)
            ),
            o AS (
                SELECT CAST(id AS BIGINT) AS id, description, lon, lat, CAST(observed_ms AS BIGINT) AS observed_ms,
                       uri, login, taxon_id, public_positional_accuracy
                FROM m.observations WHERE CAST(id AS BIGINT) IN (SELECT id FROM scope)
            )
            SELECT coalesce(p.id, o.id) AS id, p.id IS NOT NULL AS in_postgres, o.id IS NOT NULL AS in_mirror,
                   ${FIELDS.map(f => `p.${f} AS p_${f}, o.${f} AS m_${f}`).join(', ')}
            FROM p FULL JOIN o ON o.id = p.id`);
        // Photos compared as rows, both ways, which DuckDB can spill; gathering each
        // observation's photos into one string first ran a 128 MB budget out.
        await conn.run('CREATE TEMP TABLE both_sides AS SELECT id FROM pair WHERE in_postgres AND in_mirror');
        await conn.run(`
            CREATE TEMP TABLE photo_diff AS
            SELECT DISTINCT oid AS id FROM (
                (${photoRows('store.inaturalist.observation_photos')} EXCEPT ${photoRows('m.observation_photos')})
                UNION ALL
                (${photoRows('m.observation_photos')} EXCEPT ${photoRows('store.inaturalist.observation_photos')})
            )`);
        const kind = async (name: string, table: string, where: string, select: string) => {
            const count = Number((await conn.runAndReadAll(`SELECT count(*) FROM ${table} WHERE ${where}`)).getRows()[0]![0]);
            if (!count) return {};
            const examples = (await conn.runAndReadAll(
                `SELECT ${select} FROM ${table} WHERE ${where} ORDER BY id LIMIT ${SHOWN}`)).getRowObjectsJson();
            return {[name]: {count, examples}};
        };
        const differing = FIELDS.map(f => `CASE WHEN p_${f} IS DISTINCT FROM m_${f} THEN '${f}' END`).join(', ');
        const differences = {
            ...await kind('only in Postgres', 'pair', 'NOT in_mirror', 'id, p_observed_ms AS observed_ms'),
            ...await kind('only in the mirror', 'pair', 'NOT in_postgres', 'id, m_observed_ms AS observed_ms'),
            ...await kind('differs', 'pair', `in_postgres AND in_mirror AND (${FIELDS.map(f => `p_${f} IS DISTINCT FROM m_${f}`).join(' OR ')})`,
                          `id, list_filter([${differing}], x -> x IS NOT NULL) AS fields`),
            ...await kind('photos differ', 'photo_diff', 'true', 'id'),
        };
        const [postgres, mirrored] = (await conn.runAndReadAll(
            'SELECT count(*) FILTER (WHERE in_postgres), count(*) FILTER (WHERE in_mirror) FROM pair')).getRows()[0]!.map(Number);
        return {
            days: {covered: days.length, first: days[0] ?? null, last: days.at(-1) ?? null},
            observations: {postgres, mirror: mirrored, outOfScope, differences},
            agree: Object.keys(differences).length === 0,
        };
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot, mirror, report] = process.argv.slice(2);
    if (!snapshot || !mirror || !report) {
        console.error('usage: compare-inaturalist-mirror.ts <snapshot.duckdb> <inaturalist.sqlite> <report.json>');
        process.exit(2);
    }
    const result = await compareMirror(snapshot, mirror);
    await writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
    const {postgres, mirror: mirrored, outOfScope, differences} = result['observations'] as Record<string, unknown>;
    console.log(`inaturalist over ${JSON.stringify(result['days'])}: Postgres ${postgres}, mirror ${mirrored} in scope `
        + `(${outOfScope} out); ${result['agree'] ? 'they agree' : `differences: ${JSON.stringify(
            Object.fromEntries(Object.entries(differences as Record<string, {count: number}>).map(([k, v]) => [k, v.count])))}`}`);
}

if (import.meta.main) {
    await main();
}
