/**
 * How the build's Orcasound mirror compares with Postgres's copy, while both are ingested
 * (decision 061, salish-xv35.6).
 *
 *   node scripts/read-path/compare-orcasound-mirror.ts <snapshot.duckdb> <orcasound.sqlite> <report.json>
 *
 * A report, not a gate: the two are fetched minutes apart, so a bout created, retagged or
 * deleted in between differs for a while, and that is timing, not a defect. Whether the
 * build stores a corpus the way Postgres does is a deterministic question, and CI answers
 * it (ingest-orcasound.test.ts). This says what differs live, for a person to read: any
 * difference it finds still exits 0. It fails only when it can't compare at all (a mirror
 * or snapshot it can't read), which is a fault worth a red build.
 *
 * Every field the derivation reads is compared. feed_id isn't: no derivation reads it, so
 * the snapshot doesn't hold Postgres's, and the CI equivalence test compares it instead.
 *
 * Writes the report as JSON, the differing bouts and claims by kind with a few examples.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { writeFile } from 'node:fs/promises';

import { budget } from './duckdb-budget.ts';

const SHOWN = 5;

export async function compareMirror(snapshot: string, mirror: string): Promise<Record<string, unknown>> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run(`ATTACH '${mirror.replaceAll("'", "''")}' AS mirror (TYPE sqlite, READ_ONLY)`);
        const query = async (sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson();
        const bouts = await query(`
            WITH p AS (SELECT id, feed_name, title, location_lon AS lon, location_lat AS lat, started_at, ended_at
                       FROM store.public.acoustic_bouts),
                 m AS (SELECT id, feed_name, title, lon, lat,
                              CAST(started_at AS TIMESTAMPTZ) AS started_at, CAST(ended_at AS TIMESTAMPTZ) AS ended_at
                       FROM mirror.bouts)
            SELECT coalesce(p.id, m.id) AS id,
                   CASE WHEN m.id IS NULL THEN 'only in Postgres' WHEN p.id IS NULL THEN 'only in the mirror'
                        ELSE 'differs' END AS kind
            FROM p FULL JOIN m ON m.id = p.id
            WHERE p.id IS NULL OR m.id IS NULL
               OR (p.feed_name, p.title, p.lon, p.lat, p.started_at, p.ended_at)
                  IS DISTINCT FROM (m.feed_name, m.title, m.lon, m.lat, m.started_at, m.ended_at)
            ORDER BY 2, 1`);
        const claims = await query(`
            SELECT coalesce(p.bout_id, m.bout_id) AS bout_id, coalesce(p.entity_id, m.entity_id) AS entity_id,
                   CASE WHEN m.bout_id IS NULL THEN 'only in Postgres' WHEN p.bout_id IS NULL THEN 'only in the mirror'
                        ELSE 'certainty differs' END AS kind
            FROM store.public.acoustic_bout_entities p
            FULL JOIN mirror.bout_entities m ON m.bout_id = p.bout_id AND m.entity_id = p.entity_id
            WHERE p.bout_id IS NULL OR m.bout_id IS NULL OR p.certainty IS DISTINCT FROM m.certainty
            ORDER BY 3, 1, 2`);
        const [{postgres, mirrored}] = await query(`
            SELECT (SELECT count(*) FROM store.public.acoustic_bouts) AS postgres,
                   (SELECT count(*) FROM mirror.bouts) AS mirrored`) as [{postgres: string, mirrored: string}];
        const byKind = (rows: Record<string, unknown>[]) => {
            const out: Record<string, {count: number, examples: unknown[]}> = {};
            for (const row of rows) {
                const kind = row['kind'] as string;
                out[kind] ??= {count: 0, examples: []};
                out[kind].count++;
                if (out[kind].examples.length < SHOWN) out[kind].examples.push(row);
            }
            return out;
        };
        return {bouts: {postgres: Number(postgres), mirror: Number(mirrored), differences: byKind(bouts)},
                claims: {differences: byKind(claims)},
                agree: bouts.length === 0 && claims.length === 0};
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot, mirror, report] = process.argv.slice(2);
    if (!snapshot || !mirror || !report) {
        console.error('usage: compare-orcasound-mirror.ts <snapshot.duckdb> <orcasound.sqlite> <report.json>');
        process.exit(2);
    }
    const result = await compareMirror(snapshot, mirror);
    await writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
    console.log(result['agree']
        ? 'the mirror and Postgres hold the same Orcasound corpus'
        : `the mirror and Postgres differ (timing, until shown otherwise): ${JSON.stringify(result)}`);
}

if (import.meta.main) {
    await main();
}
