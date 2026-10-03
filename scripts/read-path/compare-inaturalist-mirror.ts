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
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import { isIngestable, type NormalizedObservation } from '../ingest/inaturalist.ts';
import { budget } from './duckdb-budget.ts';
import type { ObservationRow, PhotoRow } from './ingest-inaturalist.ts';

const SHOWN = 5;

const FIELDS = ['description', 'lon', 'lat', 'observed_ms', 'uri', 'login', 'taxon_id', 'public_positional_accuracy'] as const;
type Row = Record<(typeof FIELDS)[number] | 'id', unknown>;

const photoKey = (p: Pick<PhotoRow, 'id' | 'seq' | 'attribution' | 'hidden' | 'license' | 'url'>) =>
    JSON.stringify([Number(p.id), p.seq, p.attribution, Number(p.hidden), p.license, p.url]);

export async function compareMirror(snapshot: string, mirror: string): Promise<Record<string, unknown>> {
    const local = new DatabaseSync(mirror, {readOnly: true});
    let days: string[];
    let mirrored: ObservationRow[];
    const mirrorPhotos = new Map<number, string[]>();
    try {
        days = (local.prepare('SELECT day FROM covered_days ORDER BY day').all() as {day: string}[]).map(r => r.day);
        mirrored = local.prepare('SELECT * FROM observations').all() as unknown as ObservationRow[];
        for (const p of local.prepare('SELECT * FROM observation_photos').all() as unknown as PhotoRow[])
            mirrorPhotos.set(p.observation_id, [...(mirrorPhotos.get(p.observation_id) ?? []), photoKey(p)]);
    } finally {
        local.close();
    }
    const covered = new Set(days);
    const dayOf = (ms: unknown) => new Date(Number(ms)).toISOString().slice(0, 10);
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let postgres: Row[];
    const postgresPhotos = new Map<number, string[]>();
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        postgres = (await conn.runAndReadAll(`
            SELECT CAST(id AS BIGINT) AS id, description, location_lon AS lon, location_lat AS lat,
                   epoch_ms(observed_at) AS observed_ms, uri, username AS login, taxon_id, public_positional_accuracy
            FROM store.inaturalist.observations`)).getRowObjectsJS() as unknown as Row[];
        for (const p of (await conn.runAndReadAll(`
                SELECT CAST(id AS BIGINT) AS id, CAST(observation_id AS BIGINT) AS observation_id, seq, attribution,
                       hidden::INTEGER AS hidden, license, url
                FROM store.inaturalist.observation_photos`)).getRowObjectsJS() as unknown as PhotoRow[])
            postgresPhotos.set(Number(p.observation_id), [...(postgresPhotos.get(Number(p.observation_id)) ?? []), photoKey(p)]);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    const onCovered = mirrored.filter(r => covered.has(dayOf(r.observed_ms)));
    const inScope = onCovered.filter(r => isIngestable(
        {lon: r.lon, lat: r.lat, taxonId: r.taxon_id, ancestorIds: JSON.parse(r.ancestor_ids)} as unknown as NormalizedObservation));
    const theirs = new Map(postgres.filter(r => covered.has(dayOf(r.observed_ms))).map(r => [Number(r.id), r]));
    const ours = new Map(inScope.map(r => [r.id, r as unknown as Row]));
    const differences: Record<string, {count: number, examples: unknown[]}> = {};
    const note = (kind: string, example: unknown) => {
        differences[kind] ??= {count: 0, examples: []};
        differences[kind].count++;
        if (differences[kind].examples.length < SHOWN) differences[kind].examples.push(example);
    };
    const normal = (f: string, v: unknown) => f === 'observed_ms' ? Number(v) : v;
    for (const id of [...new Set([...theirs.keys(), ...ours.keys()])].sort((a, b) => a - b)) {
        const p = theirs.get(id);
        const m = ours.get(id);
        if (!m) { note('only in Postgres', {id, observed: new Date(Number(p!.observed_ms)).toISOString()}); continue; }
        if (!p) { note('only in the mirror', {id, observed: new Date(Number(m.observed_ms)).toISOString()}); continue; }
        const fields = FIELDS.filter(f => normal(f, p[f]) !== normal(f, m[f]));
        if (fields.length) note('differs', {id, fields: Object.fromEntries(fields.map(f => [f, {postgres: p[f], mirror: m[f]}]))});
        const pp = (postgresPhotos.get(id) ?? []).sort().join('\n');
        const mp = (mirrorPhotos.get(id) ?? []).sort().join('\n');
        if (pp !== mp) note('photos differ', {id, postgres: postgresPhotos.get(id)?.length ?? 0, mirror: mirrorPhotos.get(id)?.length ?? 0});
    }
    return {
        days: {covered: days.length, first: days[0] ?? null, last: days.at(-1) ?? null},
        observations: {postgres: theirs.size, mirror: ours.size, outOfScope: onCovered.length - inScope.length, differences},
        agree: Object.keys(differences).length === 0,
    };
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
