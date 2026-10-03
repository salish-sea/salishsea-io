/**
 * Does the build's derivation agree with Postgres's? (decision 061, salish-xv35.2)
 *
 *   node scripts/read-path/compare-occurrences.ts <snapshot.duckdb>
 *
 * Compares `build.occurrences` (derive-occurrences.ts) with `snapshot.occurrences`
 * (Postgres's derived.occurrences, read in the same transaction as everything the
 * derivation read, so the two answer the same question). Two documents agree when
 * the files would hold the same bytes: each is parsed and re-serialized as the day
 * files are, so Postgres's spacing doesn't count, but key order, every value and
 * every timestamp string do.
 *
 * Exits 1 on any disagreement, after naming it: ids only one side has, and for ids
 * both have, which fields differ, by source, with the first few in full.
 */

import { DuckDBInstance } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';

const SHOWN = 5;

type Doc = Record<string, unknown>;

/** Where two documents differ: top-level keys whose values differ, and whether the key order does. */
export function differences(postgres: Doc, build: Doc): string[] {
    const fields = new Set([...Object.keys(postgres), ...Object.keys(build)]);
    const differing = [...fields].filter(k => JSON.stringify(postgres[k]) !== JSON.stringify(build[k]));
    if (differing.length === 0 && JSON.stringify(Object.keys(postgres)) !== JSON.stringify(Object.keys(build)))
        differing.push('(key order)');
    return differing;
}

/** Which source an occurrence id came from; native sightings are bare uuids. */
export function sourceOf(id: string): string {
    const colon = id.indexOf(':');
    return colon < 0 ? 'native' : id.slice(0, colon);
}

export async function compare(snapshot: string): Promise<boolean> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        // Measured on 63,720 occurrences: 262 MB peak RSS; at 96 MB DuckDB
        // runs out instead, which fails this task rather than the machine.
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        // Only pairs that might differ reach JavaScript. Postgres's text is spaced and
        // the build's isn't, so DuckDB minifies Postgres's first: two documents with the
        // same minified text certainly agree, and of 63,720 only a few dozen don't,
        // mostly a whole number rendered with or without its ".0". JSON.parse decides
        // those. Streamed in no particular order, because sorting ~60k documents is what
        // made DuckDB hold them all at once; the report sorts its examples instead.
        await conn.run('SET preserve_insertion_order = false');
        const result = await conn.stream(`
            SELECT coalesce(p.id, b.id) AS id, p.doc AS postgres, b.doc AS build
            FROM store.snapshot.occurrences p
            FULL JOIN store.build.occurrences b ON b.id = p.id
            WHERE CAST(json(p.doc) AS VARCHAR) IS DISTINCT FROM b.doc
        `);
        const onlyPostgres: string[] = [];
        const onlyBuild: string[] = [];
        // source -> field -> count; and the first few disagreements per source and field
        const tally = new Map<string, Map<string, number>>();
        const examples = new Map<string, {id: string, postgres: unknown, build: unknown}[]>();
        for await (const rows of result.yieldRows() as AsyncIterable<[string, string | null, string | null][]>) {
            for (const [id, postgresDoc, buildDoc] of rows) {
                if (buildDoc === null) { onlyPostgres.push(id); continue; }
                if (postgresDoc === null) { onlyBuild.push(id); continue; }
                const postgres = JSON.parse(postgresDoc) as Doc;
                const build = JSON.parse(buildDoc) as Doc;
                const differing = differences(postgres, build);
                if (differing.length === 0) continue;
                const source = sourceOf(id);
                const fields = tally.get(source) ?? new Map<string, number>();
                tally.set(source, fields);
                for (const field of differing) {
                    fields.set(field, (fields.get(field) ?? 0) + 1);
                    const key = `${source} ${field}`;
                    const shown = examples.get(key) ?? [];
                    examples.set(key, shown);
                    shown.push(field === '(key order)'
                        ? {id, postgres: Object.keys(postgres), build: Object.keys(build)}
                        : {id, postgres: postgres[field], build: build[field]});
                    // The smallest ids, so a report is the same whatever order rows arrive in.
                    if (shown.length > SHOWN) shown.sort((a, b) => a.id < b.id ? -1 : 1).pop();
                }
            }
        }
        const total = await conn.runAndReadAll(`SELECT count(*) FROM store.snapshot.occurrences`);
        const disagreeing = [...tally.values()].reduce((n, f) => n + Math.max(...f.values()), 0);
        console.log(`${total.getRows()[0]![0]} occurrences in Postgres's store`);
        onlyPostgres.sort();
        onlyBuild.sort();
        if (onlyPostgres.length) console.log(`only in Postgres: ${onlyPostgres.length}, e.g. ${onlyPostgres.slice(0, SHOWN).join(', ')}`);
        if (onlyBuild.length) console.log(`only in the build: ${onlyBuild.length}, e.g. ${onlyBuild.slice(0, SHOWN).join(', ')}`);
        for (const [source, fields] of tally) {
            for (const [field, n] of fields) {
                console.log(`${source}: ${n} differ in ${field}`);
                for (const {id, postgres, build} of examples.get(`${source} ${field}`)!.sort((a, b) => a.id < b.id ? -1 : 1))
                    console.log(`  ${id}\n    postgres: ${JSON.stringify(postgres)}\n    build:    ${JSON.stringify(build)}`);
            }
        }
        const agree = onlyPostgres.length === 0 && onlyBuild.length === 0 && tally.size === 0;
        console.log(agree
            ? 'the build agrees with Postgres on every occurrence'
            : `disagreement: ${onlyPostgres.length + onlyBuild.length} unmatched, at least ${disagreeing} differing`);
        return agree;
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: compare-occurrences.ts <snapshot.duckdb>');
        process.exit(2);
    }
    if (!await compare(snapshot)) process.exit(1);
}

if (import.meta.main) {
    await main();
}
