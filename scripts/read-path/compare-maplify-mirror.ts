/**
 * How the build's Maplify mirror compares with Postgres's copy, while both are ingested
 * (decision 061, salish-xv35.7).
 *
 *   node scripts/read-path/compare-maplify-mirror.ts <snapshot.duckdb> <maplify.sqlite> <report.json>
 *
 * A report, not a gate, for the reason compare-orcasound-mirror.ts gives: the two fetch
 * minutes apart, so a sighting added or edited in between differs for a while. Whether
 * the build stores a window the way Postgres does is CI's question
 * (ingest-maplify.test.ts). Any difference still exits 0; only being unable to compare
 * fails.
 *
 * Postgres keeps only what is in scope, and the mirror keeps everything, so the mirror's
 * side is filtered by the ingest's own isIngestable over the snapshot's register before
 * comparing; how many it left out is reported too. Only the days the mirror has fetched
 * (covered_days) are compared, since before its first fetch or backfill it speaks for
 * nothing. Every field Postgres stores from Maplify is compared.
 *
 * Writes the report as JSON: the differing sightings by kind, with a few examples.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { isIngestable, type NormalizedSighting } from '../ingest/maplify.ts';
import { buildNameIndex, NAME_INDEX_SQL, type RegisterName } from '../register/name-index.ts';
import { budget } from './duckdb-budget.ts';
import type { MirrorRow } from './ingest-maplify.ts';

const SHOWN = 5;

/**
 * The fields compared: every one Postgres stores from Maplify that the snapshot holds. It
 * doesn't hold the five no derivation reads (project_id, trip_id, in_ocean, moderated,
 * trusted); CI compares those.
 */
const FIELDS = [
    'name', 'scientific_name', 'lon', 'lat', 'number_sighted', 'created_at', 'photo_url', 'comments',
    'is_test', 'source', 'usernm',
] as const;
type Row = Record<(typeof FIELDS)[number] | 'id', unknown>;

export async function compareMirror(snapshot: string, mirror: string): Promise<Record<string, unknown>> {
    const local = new DatabaseSync(mirror, {readOnly: true});
    let days: string[];
    let mirrored: MirrorRow[];
    try {
        days = (local.prepare('SELECT day FROM covered_days ORDER BY day').all() as {day: string}[]).map(r => r.day);
        mirrored = local.prepare('SELECT * FROM sightings').all() as unknown as MirrorRow[];
    } finally {
        local.close();
    }
    const covered = new Set(days);
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let postgres: Row[];
    let index: ReturnType<typeof buildNameIndex>;
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run('USE store');
        index = buildNameIndex((await conn.runAndReadAll(NAME_INDEX_SQL)).getRowObjectsJS() as unknown as RegisterName[]);
        postgres = (await conn.runAndReadAll(`
            SELECT id, name, scientific_name, location_lon AS lon, location_lat AS lat, number_sighted,
                   strftime(created_at, '%Y-%m-%d %H:%M:%S') AS created_at, photo_url, comments,
                   is_test::INTEGER AS is_test, source, usernm
            FROM maplify.sightings`)).getRowObjectsJS() as unknown as Row[];
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    const day = (r: {created_at: unknown}) => String(r['created_at']).slice(0, 10);
    const inScope = mirrored.filter(r => covered.has(day(r)) && isIngestable(
        {name: r.name, scientificName: r.scientific_name, lon: r.lon, lat: r.lat, source: r.source} as NormalizedSighting, index));
    const outOfScope = mirrored.filter(r => covered.has(day(r))).length - inScope.length;
    const theirs = new Map(postgres.filter(r => covered.has(day(r))).map(r => [Number(r.id), r]));
    const ours = new Map(inScope.map(r => [r.id, r as unknown as Row]));
    const differences: Record<string, {count: number, examples: unknown[]}> = {};
    const note = (kind: string, example: unknown) => {
        differences[kind] ??= {count: 0, examples: []};
        differences[kind].count++;
        if (differences[kind].examples.length < SHOWN) differences[kind].examples.push(example);
    };
    for (const id of [...new Set([...theirs.keys(), ...ours.keys()])].sort((a, b) => a - b)) {
        const p = theirs.get(id);
        const m = ours.get(id);
        if (!m) { note('only in Postgres', {id, created_at: p!.created_at}); continue; }
        if (!p) { note('only in the mirror', {id, created_at: m.created_at}); continue; }
        const fields = FIELDS.filter(f => p[f] !== m[f]);
        if (fields.length) note('differs', {id, fields: Object.fromEntries(fields.map(f => [f, {postgres: p[f], mirror: m[f]}]))});
    }
    return {
        days: {covered: days.length, first: days[0] ?? null, last: days.at(-1) ?? null},
        sightings: {postgres: theirs.size, mirror: ours.size, outOfScope, differences},
        agree: Object.keys(differences).length === 0,
    };
}

export async function main(): Promise<void> {
    const [snapshot, mirror, report] = process.argv.slice(2);
    if (!snapshot || !mirror || !report) {
        console.error('usage: compare-maplify-mirror.ts <snapshot.duckdb> <maplify.sqlite> <report.json>');
        process.exit(2);
    }
    const result = await compareMirror(snapshot, mirror);
    await writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
    console.log(result['agree']
        ? `the mirror and Postgres hold the same Maplify sightings over ${JSON.stringify(result['days'])}`
        : `the mirror and Postgres differ (timing, until shown otherwise): ${JSON.stringify(result)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
