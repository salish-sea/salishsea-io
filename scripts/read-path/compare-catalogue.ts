/**
 * Does the build's catalogue agree with Postgres's? (decision 064, salish-9uu.2.3)
 *
 *   node scripts/read-path/compare-catalogue.ts <snapshot.duckdb>
 *
 * Compares each view derive-catalogue.ts writes, `snapshot.<view>`, with Postgres's
 * answer, `snapshot.<view>_answer`, which the twin fixture holds (twin-fixture.ts). As
 * compare-profile-links.ts does: each side a multiset of documents, two documents the
 * same when they parse to the same JSON with the same key order.
 */

import { DuckDBInstance } from '@duckdb/node-api';

import { unmatched } from './compare-profile-links.ts';
import { CATALOGUE_VIEWS } from './derive-catalogue.ts';
import { budget } from './duckdb-budget.ts';

const SHOWN = 5;

export async function compare(snapshot: string): Promise<boolean> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let agree = true;
    try {
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        for (const view of CATALOGUE_VIEWS) {
            const side = async (table: string) => (await conn.runAndReadAll(
                `SELECT doc, count(*) FROM store.snapshot.${table} GROUP BY ALL`,
            )).getRows().map(([doc, n]) => [String(doc), Number(n)] as [string, number]);
            const surplus = unmatched(await side(`${view}_answer`), await side(view));
            const onlyPostgres = [...surplus].filter(([, n]) => n > 0).sort();
            const onlyBuild = [...surplus].filter(([, n]) => n < 0).sort();
            console.log(`${view}: ${onlyPostgres.length} only in Postgres, ${onlyBuild.length} only in the build`);
            for (const [doc] of onlyPostgres.slice(0, SHOWN)) console.log(`  Postgres: ${doc}`);
            for (const [doc] of onlyBuild.slice(0, SHOWN)) console.log(`  build:    ${doc}`);
            if (surplus.size > 0) agree = false;
        }
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    console.log(agree ? 'the build agrees with Postgres on the catalogue' : 'disagreement');
    return agree;
}

if (import.meta.main) {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: compare-catalogue.ts <snapshot.duckdb>');
        process.exit(2);
    }
    process.exit(await compare(snapshot) ? 0 : 1);
}
