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
 * It reads two kinds of relation. What the pages publish is serialized BY
 * POSTGRES, with to_jsonb, rather than read column by column. That is the
 * serializer PostgREST uses, so the files carry exactly the shape the frontend
 * already parses — the composite columns (`location`, `taxon`, `photos`) arrive
 * as the same nested objects. What the occurrences are derived from is read as
 * typed columns, for the build to derive them itself (decision 061).
 *
 * Everything is read in one Postgres transaction, and the snapshot checks that it
 * was: the derivation's port is compared row for row with the stored occurrences,
 * which is only fair if both come from the same moment.
 *
 * Reads only. Never writes the DSN to stdout, stderr or the snapshot.
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { budget } from './duckdb-budget.ts';

/**
 * What the pages publish: one relation per table, as documents. `query` runs
 * inside Postgres, so it is Postgres SQL; its result lands in DuckDB as
 * `snapshot.<name>`.
 */
const PUBLISHED: readonly {name: string, query: string}[] = [
    {
        name: 'occurrences',
        query: `select o.id, o.observed_at, to_jsonb(o)::text as doc from public.occurrences o`,
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
 * What the occurrences are derived from (decision 061): every table the five
 * views behind derived.occurrences read, the tables the functions they call read,
 * and the Maplify resolvers' inputs; and what the profile pages' links to them are
 * derived from besides (salish-xv35.13), the identifications our users assert. Each lands in DuckDB under its Postgres name,
 * so the port's SQL reads like the views it ports, and a source's own mirror,
 * attached later under that source's name, is read by the same SQL.
 *
 * Typed columns, only those the derivation reads; read_path is granted exactly
 * these (supabase/read-path-grants.test.ts). A geography becomes `<column>_lon`
 * and `<column>_lat`. An enum becomes its label, with its declared order in
 * `types.enums`, since two derivations compare by it.
 */
const DERIVED_FROM: readonly {table: string, columns: readonly string[]}[] = [
    {table: 'maplify.sightings', columns: [
        'id', 'name', 'scientific_name', ...lonLat('location'), 'number_sighted', 'created_at',
        'photo_url', 'comments', 'is_test', 'source', 'usernm', 'provider_id', 'collection_id',
        'source_url', 'entity_id']},
    {table: 'maplify.collection_rule', columns: ['id', 'match_kind', 'match_value', 'collection_id']},
    {table: 'inaturalist.observations', columns: [
        'id', 'description', ...lonLat('location'), 'observed_at', 'uri', 'username', 'taxon_id',
        'public_positional_accuracy', 'provider_id', 'collection_id', 'source_url']},
    {table: 'inaturalist.observation_photos', columns: [
        'id', 'observation_id', 'seq', 'attribution', 'hidden', 'license::text as license', 'url']},
    {table: 'inaturalist.taxa', columns: [
        'id', 'parent_id', 'scientific_name', 'vernacular_name', 'rank::text as rank', 'current_taxon_id']},
    {table: 'happywhale.encounters', columns: [
        'id', 'individual_id', 'user_id', 'species_id', 'verbatim_location', 'comments', 'min_count',
        ...lonLat('location'), 'accuracy::text as accuracy', 'start_date', 'start_time', 'end_time',
        'timezone', 'public', 'source_url', 'provider_id', 'collection_id']},
    {table: 'happywhale.users', columns: ['id', 'display_name']},
    {table: 'happywhale.individuals', columns: ['id', 'primary_id', 'sex::text as sex']},
    {table: 'happywhale.species', columns: ['id', 'scientific', 'name']},
    {table: 'happywhale.media', columns: [
        'id', 'encounter_id', 'user_id', 'mimetype', 'url', 'thumb_url', 'public', 'license_level']},
    {table: 'public.observations', columns: [
        'id', 'url', 'body', 'count', 'direction::text as direction', ...lonLat('subject_location'),
        ...lonLat('observer_location'), 'observed_at', 'entity_id', 'contributor_id', 'provider_id',
        'collection_id', 'source_url']},
    {table: 'public.observation_photos', columns: ['id', 'observation_id', 'seq', 'href', 'license_code']},
    {table: 'public.contributors', columns: ['id', 'name']},
    {table: 'public.acoustic_bouts', columns: [
        'id', 'feed_name', 'title', ...lonLat('location'), 'started_at', 'ended_at', 'provider_id',
        'collection_id']},
    {table: 'public.acoustic_bout_entities', columns: ['bout_id', 'entity_id', 'certainty::text as certainty']},
    // What a person asserted an occurrence shows, which overrides what the text and the
    // bouts suggest. Not who asserted it, or when: no link view reads either.
    {table: 'public.identifications', columns: [
        'occurrence_id', 'individual_id', 'social_group_id', 'is_present', 'evidence::text as evidence',
        'status::text as status', 'code', 'certainty::text as certainty']},
    {table: 'public.providers', columns: ['id', 'slug', 'name']},
    {table: 'public.collections', columns: ['id', 'name', 'organization_id']},
    {table: 'public.organizations', columns: ['id', 'name', 'url']},
    {table: 'register.entities', columns: ['entity_id', 'kind', 'label']},
    {table: 'register.names', columns: ['entity_id', 'name', 'type', 'language']},
    {table: 'register.mappings', columns: ['subject_id', 'predicate_id', 'object_id']},
    {table: 'register.ancestor', columns: ['entity_id', 'ancestor_id', 'depth', 'ancestor_kind']},
    {table: 'register.deprecations', columns: ['entity_id', 'replaced_by']},
    // What the port of derived.identifier_candidates is checked against.
    {table: 'derived.occurrence_identifier_candidates', columns: [
        'occurrence_id', 'code', 'individual_id', 'social_group_id', 'observed_at',
        '(location).lon as location_lon', '(location).lat as location_lat']},
];

/**
 * The enums the derivation reads, each label with its position in the type's
 * declared order: inaturalist.species_id compares ranks by it, and an Orcasound
 * occurrence takes the strongest certainty by it. The others are here because a
 * view casts text to them, which fails on a label the type doesn't have.
 */
const ENUMS = [
    'inaturalist.rank', 'public.identification_certainty', 'public.travel_direction',
    'public.license', 'public.sex', 'happywhale.accuracy',
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
        for (const schema of new Set(['snapshot', 'types', ...DERIVED_FROM.map(r => r.table.split('.')[0]!)]))
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
        for (const {name, query} of PUBLISHED)
            await read(conn, `snapshot.${name}`, query);
        for (const {table, columns} of DERIVED_FROM)
            await read(conn, table, `select ${columns.join(', ')} from ${table}`);
        await read(conn, 'types.enums', `
            select n.nspname || '.' || t.typname as type, e.enumlabel as label,
                   row_number() over (partition by t.oid order by e.enumsortorder)::int as position
            from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            join pg_namespace n on n.oid = t.typnamespace
            where n.nspname || '.' || t.typname in (${ENUMS.map(e => `'${e}'`).join(', ')})
        `);
        const found = await conn.runAndReadAll('SELECT count(DISTINCT type) FROM store.types.enums');
        if (Number(found.getRows()[0]![0]) !== ENUMS.length)
            throw new Error(`types.enums: expected ${ENUMS.length} enum types, found ${found.getRows()[0]![0]}`);
        await conn.run('COMMIT');
        await conn.run('DETACH pg');
    } finally {
        conn.closeSync();
    }
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

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
