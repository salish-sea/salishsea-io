/**
 * Snapshot what a logged-out visitor reads, from Postgres into a local DuckDB
 * file (salish-t3g.1; the Stelis side is st-ml9 in the stelis repo).
 *
 *   SUPABASE_DB_URL=… node scripts/read-path/snapshot.ts <snapshot.duckdb>
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
const RELATIONS: readonly {name: string, query: string}[] = [
    {
        name: 'occurrences',
        query: `
            select current_setting('TimeZone') as tz,
                   o.id, o.observed_at, to_jsonb(o)::text as doc
            from public.occurrences o
        `,
    },
    // What the profile pages show (decision 057): the catalogue, and the four
    // views linking a subject to its sightings. One document per row, in the
    // shape Postgres serializes it; the render joins them.
    ...[
        'designations', 'parties', 'social_groups', 'group_parents',
        'matriline_members', 'animal_names', 'haulouts',
        'individual_occurrences', 'group_occurrences', 'ecotype_occurrences', 'haulout_occurrences',
    ].map(name => ({
        name,
        query: `select current_setting('TimeZone') as tz, to_jsonb(t)::text as doc from public.${name} t`,
    })),
    {
        // Every column but `notes`: verbatim Bigg's-sheet text that rights policy
        // D-21 keeps off every page (decision 015), so the build never holds it.
        // read_path is granted exactly these.
        name: 'individuals',
        query: `
            select current_setting('TimeZone') as tz, to_jsonb(t)::text as doc
            from (select id, entity_id, primary_designation, sex, born_earliest, born_latest,
                         life_status, mother_id, maternity_certainty, father_id, paternity_certainty
                  from public.individuals) t
        `,
    },
    {
        // The columns anon reads: `story` is withheld (rights policy D-21), and
        // read_path is granted exactly these.
        name: 'nicknames',
        query: `
            select current_setting('TimeZone') as tz, to_jsonb(t)::text as doc
            from (select id, individual_id, name, named_year, namer_id, social_group_id, status, theme
                  from public.nicknames) t
        `,
    },
];

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
        // When the snapshot was taken, asked of Postgres BEFORE anything is read:
        // everything committed by then is in the tables below, so the manifest can
        // say the files cover every day up to this moment without overclaiming. A
        // row committed while the read runs may be included too; that is extra,
        // never missing. Its own relation, so that it moving every build does not
        // move the occurrences' digest and defeat Stelis's early cutoff.
        await conn.run(
            `CREATE OR REPLACE TABLE store.snapshot.meta AS
             SELECT * FROM postgres_query('pg', 'select now() as taken_at')`,
        );
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
