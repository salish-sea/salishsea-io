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
 * It reads two kinds of relation. What the occurrences are derived from is read as
 * typed columns, for the build to derive them itself (decision 061). The catalogue,
 * read only for the twin test now, is serialized BY POSTGRES, with to_jsonb, rather
 * than read column by column: the serializer PostgREST uses, which the shape the
 * pages parse came from, and which catalogue.ts reproduces from the checked-in files.
 *
 * Everything is read in one Postgres transaction, and the snapshot checks that it
 * was. Maplify, iNaturalist and Orcasound come from the build's own mirrors
 * (salish-xv35.9), the reference tables from checked-in files (reference.ts,
 * decision 064), the register from its own release (ingest-register.ts), and the
 * catalogue from checked-in files (catalogue.ts); Postgres's copies of all of those are
 * read only with --answers, which also reads Postgres's own derived occurrences, for
 * checking the derivation's twins against them, which is only fair if both come from the
 * same moment, and Happywhale's frozen tables, which the build reads from a file
 * (happywhale.ts). Without it, what is left is what users write (decision 064).
 *
 * From the cutover (decision 065, salish-9uu.3.5), what users write comes from the
 * write API's SQLite store instead: with READ_PATH_STORE naming it, the snapshot reads
 * the same four tables from a consistent copy of the store, typed as Postgres's arrive,
 * and Postgres is not read at all. Unset, Postgres is read as before, which is the way
 * back for as long as Postgres is kept.
 *
 *   READ_PATH_STORE=/data/store/salishsea.db node scripts/read-path/snapshot.ts <snapshot.duckdb>
 *
 * Reads only. Never writes the DSN to stdout, stderr or the snapshot.
 */

import { rmSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';
import { DAY_ZONE } from './pacific-day.ts';

/**
 * The catalogue as Postgres holds it: one relation per table, as documents. `query`
 * runs inside Postgres, so it is Postgres SQL; its result lands in DuckDB as
 * `snapshot.<name>`. Read only with --answers since salish-9uu.2.3: the build's
 * catalogue is checked-in data (catalogue.ts) and its views over the register are
 * derived (derive-catalogue.ts), but the twin test derives from this database's own
 * catalogue, which a local or CI database seeds differently from production's.
 */
const PUBLISHED: readonly {name: string, query: string}[] = [
    // What the profile pages show of the catalogue (decision 057). One document per
    // row, in the shape Postgres serializes it; the render joins them. The links from
    // a subject to its sightings are the build's (salish-xv35.13).
    ...[
        'designations', 'parties', 'social_groups', 'haulouts',
    ].map(name => ({
        name,
        query: `select to_jsonb(t)::text as doc from public.${name} t`,
    })),
    {
        // Every column but `notes`: verbatim Bigg's-sheet text that rights policy
        // D-21 keeps off every page (decision 015), so the build never holds it.
        // read_path is granted exactly these.
        name: 'individuals',
        query: `
            select to_jsonb(t)::text as doc
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
            select to_jsonb(t)::text as doc
            from (select id, individual_id, name, named_year, namer_id, social_group_id, status, theme
                  from public.nicknames) t
        `,
    },
];

/** A geography column as two doubles, computed as the views compute them, so the port's floats are the store's. */
const lonLat = (column: string) => [
    `gis.st_x(${column}::gis.geometry) as ${column}_lon`,
    `gis.st_y(${column}::gis.geometry) as ${column}_lat`,
];

/**
 * Happywhale's tables, frozen: nothing has written them since their in-database loader
 * stopped being called (decision 061). The build reads them from one file on the volume
 * (happywhale.ts, decision 064, salish-9uu.2.4), exported once from Postgres with these
 * columns (happywhale-export.ts); the snapshot reads them only with --answers, for the
 * twin test, whose database seeds its own.
 */
export const HAPPYWHALE_TABLES: readonly {table: string, columns: readonly string[]}[] = [
    {table: 'happywhale.encounters', columns: [
        'id', 'individual_id', 'user_id', 'species_id', 'verbatim_location', 'comments', 'min_count',
        ...lonLat('location'), 'accuracy::text as accuracy', 'start_date', 'start_time', 'end_time',
        'timezone', 'public', 'source_url', 'provider_id', 'collection_id']},
    {table: 'happywhale.users', columns: ['id', 'display_name']},
    {table: 'happywhale.individuals', columns: ['id', 'primary_id', 'sex::text as sex']},
    {table: 'happywhale.species', columns: ['id', 'scientific', 'name']},
    {table: 'happywhale.media', columns: [
        'id', 'encounter_id', 'user_id', 'mimetype', 'url', 'thumb_url', 'public', 'license_level']},
];

/**
 * What the occurrences are derived from (decision 061): every table the five
 * views behind derived.occurrences read, the tables the functions they call read,
 * and the Maplify resolvers' inputs; and what the profile pages' links to them are
 * derived from besides (salish-xv35.13), the identifications our users assert. Each lands in DuckDB under its Postgres name,
 * so the port's SQL reads like the views it ports, and a source's own mirror,
 * attached later under that source's name, is read by the same SQL.
 *
 * Typed columns, only those the derivation reads; read_path is granted exactly
 * these (supabase/read-path-grants.test.ts). A geography becomes `<column>_lon`
 * and `<column>_lat`. An enum becomes its label; its declared order is checked-in
 * data now (reference.ts), as are the providers, organizations, collections and
 * Maplify's collection rules (decision 064).
 */
const DERIVED_FROM: readonly {table: string, columns: readonly string[]}[] = [
    // maplify.sightings is read only under --answers now (salish-xv35.9): the build's
    // mirror is the source, and Postgres's copy is frozen.
    {table: 'public.observations', columns: [
        'id', 'url', 'body', 'count', 'direction::text as direction', ...lonLat('subject_location'),
        ...lonLat('observer_location'), 'observed_at', 'entity_id', 'contributor_id', 'provider_id',
        'collection_id', 'source_url', 'accuracy']},
    {table: 'public.observation_photos', columns: ['id', 'observation_id', 'seq', 'href', 'license_code']},
    {table: 'public.contributors', columns: ['id', 'name', 'orcid']},
    // What a person asserted an occurrence shows, which overrides what the text and the
    // bouts suggest. Not who asserted it, or when: no link view reads either.
    {table: 'public.identifications', columns: [
        'occurrence_id', 'individual_id', 'social_group_id', 'is_present', 'evidence::text as evidence',
        'status::text as status', 'code', 'certainty::text as certainty']},
];

/**
 * DERIVED_FROM, read from the store (decision 065): the same tables, columns and DuckDB
 * types as the Postgres read gives them, so the derivation can't tell the two apart. The
 * store keeps a location as two doubles and a time as ISO 8601 text in UTC; a uuid, an
 * enum and a smallint are text and integers there. Its contributors are only those who
 * sign in or own a native sighting, where Postgres also held every iNaturalist login it
 * minted; the build reads a contributor only through a sighting, so nothing it derives
 * differs (salish-9uu.3.5 compared the two on production's rows).
 */
export const FROM_STORE: readonly {table: string, query: string}[] = [
    {table: 'public.observations', query: `
        SELECT CAST(id AS UUID) AS id, url, body, CAST(count AS SMALLINT) AS count, direction,
               subject_lon AS subject_location_lon, subject_lat AS subject_location_lat,
               observer_lon AS observer_location_lon, observer_lat AS observer_location_lat,
               CAST(observed_at AS TIMESTAMPTZ) AS observed_at, entity_id,
               CAST(contributor_id AS INTEGER) AS contributor_id, CAST(provider_id AS INTEGER) AS provider_id,
               CAST(collection_id AS INTEGER) AS collection_id, source_url, CAST(accuracy AS INTEGER) AS accuracy
        FROM copy.observations`},
    {table: 'public.observation_photos', query: `
        SELECT CAST(id AS INTEGER) AS id, CAST(observation_id AS UUID) AS observation_id,
               CAST(seq AS SMALLINT) AS seq, href, license_code
        FROM copy.observation_photos`},
    {table: 'public.contributors', query: `
        SELECT CAST(id AS INTEGER) AS id, name, orcid FROM copy.contributors`},
    {table: 'public.identifications', query: `
        SELECT occurrence_id, CAST(individual_id AS INTEGER) AS individual_id,
               CAST(social_group_id AS INTEGER) AS social_group_id, is_present = 1 AS is_present,
               evidence, status, code, certainty
        FROM copy.identifications`},
];

/**
 * Postgres's own answers to what the build derives: the occurrences, their identifier
 * candidates and the profile pages' link views. The build derives these itself
 * (decision 061) and no longer reads them; with `--answers`, the snapshot holds them
 * too, read in the same transaction as their inputs, so the twins of Postgres's views
 * can be checked against it (derive-occurrences.test.ts).
 */
const ANSWERS: readonly {name: string, query: string}[] = [
    // The catalogue's three views over the register, which the build derives itself now
    // (derive-catalogue.ts, salish-9uu.2.3), each beside the build's under `<view>_answer`
    // for compare-catalogue.ts.
    ...['group_parents', 'matriline_members', 'animal_names'].map(name => ({
        name: `${name}_answer`,
        query: `select to_jsonb(t)::text as doc from public.${name} t`,
    })),
    {
        name: 'occurrences',
        query: `select o.id, o.observed_at, to_jsonb(o)::text as doc from public.occurrences o`,
    },
    ...['individual_occurrences', 'group_occurrences', 'ecotype_occurrences', 'haulout_occurrences'].map(name => ({
        name,
        query: `select to_jsonb(t)::text as doc from public.${name} t`,
    })),
];
const ANSWER_TABLES: readonly {table: string, columns: readonly string[]}[] = [
    // The register as Postgres holds it (salish-9uu.2.2, decision 064): the build fetches
    // its own copy (ingest-register.ts), and the twin test, which has no release to fetch,
    // takes Postgres's — the edition the workflow loaded, which the twins were written over.
    {table: 'register.entities', columns: ['entity_id', 'kind', 'label']},
    {table: 'register.names', columns: ['entity_id', 'name', 'type', 'language']},
    {table: 'register.mappings', columns: ['subject_id', 'predicate_id', 'object_id']},
    {table: 'register.ancestor', columns: ['entity_id', 'ancestor_id', 'depth', 'ancestor_kind']},
    {table: 'register.deprecations', columns: ['entity_id', 'replaced_by']},
    // The register's lineage for each taxon, which the Darwin Core archive's classification
    // reads (dwc.taxa_classification, salish-xv35.9).
    {table: 'register.classification', columns: [
        'entity_id', 'label', 'taxon_id', 'scientific_name', 'taxon_rank', 'kingdom', 'phylum', 'class',
        '"order"', 'family', 'genus']},
    // Postgres's own copies of iNaturalist and Orcasound, which it stopped ingesting on
    // 2026-10-04 (salish-xv35.9): the build reads its own mirrors, and the twin test
    // writes mirrors from these to check the twins against Postgres's answer.
    {table: 'inaturalist.observations', columns: [
        'id', 'description', ...lonLat('location'), 'observed_at', 'uri', 'username', 'taxon_id',
        'public_positional_accuracy', 'provider_id', 'collection_id', 'source_url']},
    {table: 'inaturalist.observation_photos', columns: [
        'id', 'observation_id', 'seq', 'attribution', 'hidden', 'license::text as license', 'url']},
    // and its taxa, which the build read beside its own until the mirror held every taxon
    // the register names (salish-xv35.9.3)
    {table: 'inaturalist.taxa', columns: [
        'id', 'parent_id', 'scientific_name', 'vernacular_name', 'rank::text as rank', 'current_taxon_id']},
    {table: 'public.acoustic_bouts', columns: [
        'id', 'feed_name', 'title', ...lonLat('location'), 'started_at', 'ended_at', 'provider_id',
        'collection_id']},
    {table: 'public.acoustic_bout_entities', columns: ['bout_id', 'entity_id', 'certainty::text as certainty']},
    // Postgres's Maplify sightings again, with the trusted flag the archive filters on,
    // for the twin test to write a mirror from; the build reads it from its own mirror.
    {table: 'maplify.sightings', columns: [
        'id', 'name', 'scientific_name', ...lonLat('location'), 'number_sighted', 'created_at',
        'photo_url', 'comments', 'is_test', 'source', 'usernm', 'provider_id', 'collection_id',
        'source_url', 'entity_id', 'trusted']},
    // Postgres's Darwin Core views, the answer the archive's twins are checked against.
    {table: 'dwc.occurrences', columns: ['*']},
    {table: 'dwc.multimedia', columns: ['*']},
    {table: 'dwc.export_coverage', columns: ['*']},
    // Postgres's identifier candidates, the answer the candidates' twin is checked against.
    {table: 'derived.occurrence_identifier_candidates', columns: [
        'occurrence_id', 'code', 'individual_id', 'social_group_id', 'observed_at',
        '(location).lon as location_lon', '(location).lat as location_lat']},
];

export async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const answers = args[0] === '--answers';
    const [out] = answers ? args.slice(1) : args;
    if (!out) {
        console.error('usage: snapshot.ts [--answers] <snapshot.duckdb>');
        process.exit(2);
    }
    const store = process.env['READ_PATH_STORE'];
    if (store && !answers) return snapshotStore(out, store);
    const published = answers ? [...PUBLISHED, ...ANSWERS] : [];
    const derivedFrom = answers ? [...DERIVED_FROM, ...HAPPYWHALE_TABLES, ...ANSWER_TABLES] : DERIVED_FROM;
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
        // DuckDB keeps what a transaction hasn't committed in memory, and the whole
        // snapshot is one transaction (below), so by default every table it writes
        // stays resident until COMMIT: 320 MB peak on the 1 GB Fly machine once the
        // occurrences' inputs joined the published relations. Capped, it spills to a
        // directory beside the snapshot instead, which it removes when done. Measured
        // there: 240 MB peak and a 50 MB spill, about 20 s slower. The rest is node
        // and the Postgres client holding each query's result.
        await budget(conn, out, '64MB');
        await conn.run(`ATTACH '${out.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await conn.run('INSTALL postgres; LOAD postgres;');
        try {
            await conn.run(`ATTACH '${dsn.replaceAll("'", "''")}' AS pg (TYPE postgres, READ_ONLY)`);
        } catch {
            // DuckDB can echo the connection string in its error; never pass it on.
            throw new Error('Failed to attach Postgres (message withheld: it may contain the DSN)');
        }
        for (const schema of new Set(['snapshot', ...derivedFrom.map(r => r.table.split('.')[0]!)]))
            await conn.run(`CREATE SCHEMA IF NOT EXISTS store.${schema}`);

        // One transaction: a reader never sees some tables from this snapshot and
        // some from the last. Postgres's side is one transaction too, because every
        // postgres_query in one DuckDB transaction runs in the same repeatable-read
        // Postgres transaction; `read` checks that of every relation.
        await conn.run('BEGIN');
        // Which Postgres transaction that is, asked first.
        await conn.run(
            `CREATE TEMP TABLE txn AS
             SELECT * FROM postgres_query('pg', 'select pg_backend_pid() as pid, now() as at')`,
        );
        // When the snapshot was taken: the transaction's start, so everything
        // committed by then is in the tables below, and the manifest can say the
        // files cover every day up to this moment without overclaiming. Its own
        // relation, so that it moving every build does not move the occurrences'
        // digest and defeat Stelis's early cutoff.
        await read(conn, 'snapshot.meta', 'select now() as taken_at');
        // The Pacific year it was taken in, which is all a profile page reads of when:
        // the newest year its presence table shows. Its own relation for the same reason
        // as meta (salish-xv35.12): taken_at moves every build and the year once a year,
        // so the pages, reading only this, skip a build that changed nothing they show.
        // And the UTC day, which the Darwin Core archive is dated by, as Postgres's
        // CURRENT_DATE dated it: its own relation, so the archive reruns once a day rather
        // than every build.
        await whenTaken(conn);
        for (const {name, query} of published)
            await read(conn, `snapshot.${name}`, query);
        for (const {table, columns} of derivedFrom)
            await read(conn, table, `select ${columns.join(', ')} from ${table}`);
        // Postgres's register, read only here, is not the release `register.edition`
        // names, so that marker goes, and a later ingest-register adopts afresh.
        if (answers) await conn.run('DROP TABLE IF EXISTS store.register.edition');
        await conn.run('COMMIT');
        await conn.run('DETACH pg');
    } finally {
        conn.closeSync();
    }
}

/**
 * The snapshot from the store (decision 065): DERIVED_FROM as FROM_STORE reads it, and
 * when it was taken. The store is copied first, with SQLite's backup, so the four tables
 * agree with each other however the API writes meanwhile; the copy sits beside the
 * snapshot and is removed when done. The moment is the clock's as the copy begins, so
 * everything saved by then is in it, as Postgres's transaction start was.
 */
export async function snapshotStore(out: string, store: string): Promise<void> {
    const copy = `${out}.store-copy`;
    rmSync(copy, {force: true});
    const source = new DatabaseSync(store, {readOnly: true});
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`CREATE TEMP TABLE taken AS SELECT now() AS taken_at`);
        await backup(source, copy);
        await budget(conn, out, '64MB');
        await conn.run(`ATTACH '${out.replaceAll("'", "''")}' AS store`);
        await conn.run('INSTALL sqlite; LOAD sqlite;');
        await conn.run(`ATTACH '${copy.replaceAll("'", "''")}' AS copy (TYPE sqlite, READ_ONLY)`);
        for (const schema of ['snapshot', 'public']) await conn.run(`CREATE SCHEMA IF NOT EXISTS store.${schema}`);
        await conn.run('BEGIN');
        await conn.run('CREATE OR REPLACE TABLE store.snapshot.meta AS SELECT taken_at FROM temp.main.taken');
        await whenTaken(conn);
        for (const {table, query} of FROM_STORE) {
            await conn.run(`CREATE OR REPLACE TABLE store.${table} AS ${query}`);
            const rows = (await conn.runAndReadAll(`SELECT count(*) FROM store.${table}`)).getRows()[0]![0];
            console.log(`${table}: ${rows} rows (from the store)`);
        }
        await conn.run('COMMIT');
        await conn.run('DETACH copy');
    } finally {
        conn.closeSync();
        db.closeSync();
        source.close();
        rmSync(copy, {force: true});
    }
}

/** snapshot.year and snapshot.day, from snapshot.meta: see main() for why each is its own. */
async function whenTaken(conn: DuckDBConnection): Promise<void> {
    await conn.run(
        `CREATE OR REPLACE TABLE store.snapshot.year AS
         SELECT year(timezone('${DAY_ZONE}', taken_at))::INTEGER AS year FROM store.snapshot.meta`,
    );
    await conn.run(
        `CREATE OR REPLACE TABLE store.snapshot.day AS
         SELECT strftime(timezone('UTC', taken_at), '%Y-%m-%d') AS day FROM store.snapshot.meta`,
    );
}

/**
 * Copy one query's result into `store.<target>`, checking that Postgres answered it
 * in the snapshot's transaction and in UTC.
 *
 * The query is wrapped to report both. The TimeZone matters to the documents:
 * to_jsonb renders a timestamptz in the session's zone, so a snapshot's bytes
 * would otherwise depend on how the answering connection was configured. The
 * database default is UTC, which is also what PostgREST's output carries; the
 * snapshot refuses anything else rather than trying to pin it, since a SET on one
 * pooled connection says nothing about the next. The transaction is identified
 * by its backend and its start time.
 */
async function read(conn: DuckDBConnection, target: string, query: string): Promise<void> {
    const wrapped = `
        select current_setting('TimeZone') as _tz, pg_backend_pid() as _pid, now() as _txn, q.*
        from (${query}) q`;
    await conn.run(
        `CREATE OR REPLACE TABLE store.${target} AS
         SELECT * FROM postgres_query('pg', $q$${wrapped}$q$)`,
    );
    const zones = await conn.runAndReadAll(
        `SELECT DISTINCT _tz FROM store.${target} WHERE _tz <> 'UTC'`,
    );
    if (zones.getRows().length > 0) {
        const found = zones.getRows().map(r => r[0]).join(', ');
        throw new Error(`${target}: rendered in TimeZone ${found}, not UTC`);
    }
    const strays = await conn.runAndReadAll(
        `SELECT count(*) FROM store.${target} r, temp.main.txn t WHERE r._pid <> t.pid OR r._txn <> t.at`,
    );
    if (Number(strays.getRows()[0]![0]) > 0)
        throw new Error(`${target}: read outside the snapshot's Postgres transaction`);
    for (const column of ['_tz', '_pid', '_txn'])
        await conn.run(`ALTER TABLE store.${target} DROP COLUMN ${column}`);
    const reader = await conn.runAndReadAll(`SELECT count(*) FROM store.${target}`);
    console.log(`${target}: ${reader.getRows()[0]![0]} rows`);
}

if (import.meta.main) {
    await main();
}
