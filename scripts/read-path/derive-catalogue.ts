/**
 * Derive the catalogue's three views over the register in the build (decision 064,
 * salish-9uu.2.3): which group each group sits inside, every matriline each individual is
 * in, and the names the register gives each entity.
 *
 *   node scripts/read-path/derive-catalogue.ts <snapshot.duckdb> <inaturalist.sqlite>
 *
 * Postgres computes public.group_parents, public.matriline_members and public.animal_names
 * over its copy of the register; the build now holds its own (ingest-register.ts), so it
 * computes them too, over that and the catalogue's rows, writing each under the name the
 * snapshot gave Postgres's view (`snapshot.group_parents` and the others), in the same
 * shape: one document per row. The SQL is derive/catalogue.sql, after the lookups the
 * occurrences use; of the sources it reads only iNaturalist's taxa, from the build's mirror. compare-catalogue.ts
 * checks the result against Postgres's answer.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

import { attachTaxa } from './derive/sources.ts';
import { budget } from './duckdb-budget.ts';

export const CATALOGUE_VIEWS = ['group_parents', 'matriline_members', 'animal_names'] as const;

export async function deriveCatalogue(snapshot: string, inaturalist: string): Promise<Record<string, number>> {
    const sql = async (file: string) => readFile(new URL(`./derive/${file}`, import.meta.url), 'utf8');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '128MB');
        await conn.run(`INSTALL icu; LOAD icu; SET TimeZone = 'UTC'`);
        await conn.run('SET preserve_insertion_order = false');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await attachTaxa(conn, inaturalist);
        await conn.run(await sql('shared.sql'));
        await conn.run(await sql('lookups.sql'));
        await conn.run(await sql('catalogue.sql'));
        const counts: Record<string, number> = {};
        for (const view of CATALOGUE_VIEWS) {
            const reader = await conn.runAndReadAll(`SELECT count(*) FROM snapshot.${view}`);
            counts[view] = Number(reader.getRows()[0]![0]);
        }
        return counts;
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot, inaturalist] = process.argv.slice(2);
    if (!snapshot || !inaturalist) {
        console.error('usage: derive-catalogue.ts <snapshot.duckdb> <inaturalist.sqlite>');
        process.exit(2);
    }
    for (const [view, n] of Object.entries(await deriveCatalogue(snapshot, inaturalist)))
        console.log(`snapshot.${view}: ${n} rows`);
}

if (import.meta.main) {
    await main();
}
