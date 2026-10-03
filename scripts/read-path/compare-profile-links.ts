/**
 * Do the build's profile links agree with Postgres's? (decision 061, salish-xv35.13)
 *
 *   node scripts/read-path/compare-profile-links.ts <snapshot.duckdb>
 *
 * Compares each relation derive-profile-links.ts writes, `build.<view>`, with
 * `snapshot.<view>`, Postgres's answer to the same view, read in the same transaction as
 * everything the build derived it from. The rows have no key (a sighting can link one
 * individual twice, once per code naming her), so each side is a multiset of documents,
 * and two documents are the same when the pages would read the same thing from them:
 * each is parsed and re-serialized, so Postgres's spacing doesn't count, but key order
 * and every value do.
 *
 * Exits 1 on any disagreement, after naming it: for each view, the documents only one
 * side has, the first few in full.
 */

import { DuckDBInstance } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';

const SHOWN = 5;

/** What derive-profile-links.ts writes under build., each the twin of the view named so. */
const RELATIONS = ['individual_occurrences', 'group_occurrences', 'ecotype_occurrences', 'haulout_occurrences'];

/**
 * How many more times each document occurs on Postgres's side than the build's, for the
 * documents where that isn't zero. Both sides are given as (text, count) pairs, and two
 * texts are the same document when they parse to the same JSON.
 */
export function unmatched(postgres: Iterable<[string, number]>, build: Iterable<[string, number]>): Map<string, number> {
    const surplus = new Map<string, number>();
    const add = (text: string, n: number) => {
        const canonical = JSON.stringify(JSON.parse(text));
        const total = (surplus.get(canonical) ?? 0) + n;
        if (total === 0) surplus.delete(canonical); else surplus.set(canonical, total);
    };
    for (const [text, n] of postgres) add(text, n);
    for (const [text, n] of build) add(text, -n);
    return surplus;
}

export async function compare(snapshot: string): Promise<boolean> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let agree = true;
    try {
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run('SET preserve_insertion_order = false');
        for (const relation of RELATIONS) {
            // Only documents whose counts might differ reach JavaScript: DuckDB minifies
            // Postgres's text first, so two documents with the same text certainly agree.
            // What's left is mostly a number rendered differently (48 against 48.0), which
            // JSON.parse decides.
            const residue = await conn.runAndReadAll(`
                WITH p AS (SELECT CAST(json(doc) AS VARCHAR) AS doc, count(*) AS n
                           FROM store.snapshot.${relation} GROUP BY ALL),
                     b AS (SELECT doc, count(*) AS n FROM store.build.${relation} GROUP BY ALL)
                SELECT p.doc, p.n, b.doc, b.n
                FROM p FULL JOIN b ON b.doc = p.doc
                WHERE p.n IS DISTINCT FROM b.n`);
            const rows = residue.getRows() as [string | null, bigint | null, string | null, bigint | null][];
            const surplus = unmatched(
                rows.filter(([doc]) => doc !== null).map(([doc, n]) => [doc!, Number(n)]),
                rows.filter(([, , doc]) => doc !== null).map(([, , doc, n]) => [doc!, Number(n)]),
            );
            const total = await conn.runAndReadAll(`SELECT count(*) FROM store.snapshot.${relation}`);
            const onlyPostgres = [...surplus].filter(([, n]) => n > 0).sort();
            const onlyBuild = [...surplus].filter(([, n]) => n < 0).sort();
            const count = (side: [string, number][]) => side.reduce((sum, [, n]) => sum + Math.abs(n), 0);
            console.log(`${relation}: ${total.getRows()[0]![0]} rows in Postgres's view`);
            if (onlyPostgres.length) console.log(`  only in Postgres: ${count(onlyPostgres)}`);
            for (const [doc] of onlyPostgres.slice(0, SHOWN)) console.log(`    ${doc}`);
            if (onlyBuild.length) console.log(`  only in the build: ${count(onlyBuild)}`);
            for (const [doc] of onlyBuild.slice(0, SHOWN)) console.log(`    ${doc}`);
            if (surplus.size > 0) agree = false;
        }
        console.log(agree ? 'the build agrees with Postgres on every profile link' : 'disagreement');
        return agree;
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: compare-profile-links.ts <snapshot.duckdb>');
        process.exit(2);
    }
    if (!await compare(snapshot)) process.exit(1);
}

if (import.meta.main) {
    await main();
}
