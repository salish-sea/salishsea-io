/**
 * Snapshot what a logged-out visitor reads, from Postgres into a local DuckDB
 * file (salish-t3g.1; the Stelis side is st-ml9 in the stelis repo).
 *
 *   SUPABASE_DB_URL=… tsx scripts/read-path/snapshot.ts <snapshot.duckdb>
 *
 * This is the ingestion boundary of the read-path build: everything downstream
 * reads the snapshot, never the database, so a build's inputs hold still while
 * it runs and the same snapshot always builds the same files. Stelis runs this
 * on every build and content-addresses what it wrote; when nothing in Postgres
 * changed, the tables digest the same and nothing downstream reruns.
 *
 * Each row is serialized BY POSTGRES, with to_jsonb, rather than read column by
 * column. That is the serializer PostgREST uses, so the files carry exactly the
 * shape the frontend already parses — the composite columns (`location`,
 * `taxon`, `photos`) arrive as the same nested objects. DuckDB's Postgres reader
 * would otherwise have to map those composite types itself.
 *
 * Reads only. Never writes the DSN to stdout, stderr or the snapshot.
 */

import { DuckDBInstance } from '@duckdb/node-api';

/**
 * One relation per table the build reads. `query` runs inside Postgres, so it
 * is Postgres SQL; its result lands in DuckDB as `snapshot.<name>`.
 *
 * Every query also reports the session's TimeZone, as `tz`. to_jsonb renders a
 * timestamptz in that zone, so a snapshot's bytes would otherwise depend on how
 * the answering connection was configured. The database default is UTC, which
 * is also what PostgREST's output carries; the snapshot refuses anything else
 * rather than trying to pin it, since a SET on one pooled connection says
 * nothing about the next.
 */
const RELATIONS = [
    {
        name: 'occurrences',
        query: `
            select current_setting('TimeZone') as tz,
                   o.id, o.observed_at, to_jsonb(o)::text as doc
            from public.occurrences o
        `,
    },
] as const;

export async function main(): Promise<void> {
    const [out] = process.argv.slice(2);
    if (!out) {
        console.error('usage: snapshot.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }

    // Attached under a fixed name, as in occurrence-days.ts: opened directly, the
    // catalog would be named after the file and could collide with `snapshot`.
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`ATTACH '${out.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await conn.run('INSTALL postgres; LOAD postgres;');
        try {
            await conn.run(`ATTACH '${dsn.replaceAll("'", "''")}' AS pg (TYPE postgres, READ_ONLY)`);
        } catch {
            // DuckDB can echo the connection string in its error; never pass it on.
            throw new Error('Failed to attach Postgres (message withheld: it may contain the DSN)');
        }
        await conn.run('CREATE SCHEMA IF NOT EXISTS store.snapshot');

        // One transaction: a reader never sees some tables from this snapshot and
        // some from the last.
        await conn.run('BEGIN');
        for (const {name, query} of RELATIONS) {
            await conn.run(
                `CREATE OR REPLACE TABLE store.snapshot.${name} AS
                 SELECT * FROM postgres_query('pg', $q$${query}$q$)`,
            );
            const zones = await conn.runAndReadAll(
                `SELECT DISTINCT tz FROM store.snapshot.${name} WHERE tz <> 'UTC'`,
            );
            if (zones.getRows().length > 0) {
                const found = zones.getRows().map(r => r[0]).join(', ');
                throw new Error(`snapshot.${name}: rendered in TimeZone ${found}, not UTC`);
            }
            await conn.run(`ALTER TABLE store.snapshot.${name} DROP COLUMN tz`);
            const reader = await conn.runAndReadAll(`SELECT count(*) FROM store.snapshot.${name}`);
            console.log(`snapshot.${name}: ${reader.getRows()[0]![0]} rows`);
        }
        await conn.run('COMMIT');
        await conn.run('DETACH pg');
    } finally {
        conn.closeSync();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
