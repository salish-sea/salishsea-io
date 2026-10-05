/**
 * What the read-path build's role can reach, pinned (decision 056).
 *
 * The role exists so the build machine never holds credentials that reach more
 * than the files publish and what they are derived from (decision 061). That is
 * only true while nothing widens it by accident:
 * a grant to PUBLIC, a schema-wide default privilege, a view created later with a
 * grant that happens to include it. So this asserts the effective set across
 * every schema, the way Postgres answers at query time: a relation counts only if
 * the role can enter its schema AND holds the privilege, whether directly or
 * through PUBLIC.
 *
 * A migration that grants the role more updates this list in the same PR.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/**
 * What the build still reads from Postgres (decision 064, salish-9uu.2.5): what users
 * write — native sightings, their photos, contributors, the identifications people
 * assert — and Happywhale's frozen tables, which only the recovery of the volume's frozen
 * file re-exports (happywhale-export.ts). Everything else the build reads it fetches,
 * takes from checked-in files, or derives (061, 064). Each column read_path may select,
 * where it may select only some: the build machine holds nothing it doesn't use. `null`
 * is the whole table.
 */
const READS: Record<string, readonly string[] | null> = {
    'happywhale.encounters': [
        'id', 'individual_id', 'user_id', 'species_id', 'verbatim_location', 'comments', 'min_count',
        'location', 'accuracy', 'start_date', 'start_time', 'end_time', 'timezone', 'public',
        'source_url', 'provider_id', 'collection_id'],
    'happywhale.individuals': ['id', 'primary_id', 'sex'],
    'happywhale.media': ['id', 'encounter_id', 'user_id', 'mimetype', 'url', 'thumb_url', 'public', 'license_level'],
    'happywhale.species': ['id', 'scientific', 'name'],
    'happywhale.users': ['id', 'display_name'],
    // A contributor's name and nothing else of theirs.
    'public.contributors': ['id', 'name', 'orcid'],
    // Not who asserted one, when, how, or a machine's confidence: no link view reads them.
    'public.identifications': [
        'occurrence_id', 'individual_id', 'social_group_id', 'is_present', 'evidence', 'status', 'code',
        'certainty'],
    'public.observation_photos': ['id', 'observation_id', 'seq', 'href', 'license_code'],
    // Not user_uuid: which sign-in account wrote a sighting is not the build's business.
    'public.observations': [
        'id', 'url', 'body', 'count', 'direction', 'subject_location', 'observer_location',
        'observed_at', 'entity_id', 'contributor_id', 'provider_id', 'collection_id', 'source_url',
        'accuracy'],
};

/**
 * pg_net's request queue, which Supabase installs with every privilege granted to
 * PUBLIC by supabase_admin. Any login role can therefore queue an HTTP request
 * that the database sends; `ingest` can too. We don't own these objects, so we
 * can't revoke it — only keep the credential scarce. Pinned so that the platform
 * widening it, or us adding to it, fails here (salish-p3m2).
 */
const PLATFORM_QUEUE = [
    'net._http_response',
    'net.http_request_queue',
];

/**
 * PostGIS's catalogs, which it grants to PUBLIC: the EPSG coordinate systems, and two
 * views listing the geometry and geography columns of what the role can already
 * see. Reachable because the snapshot needs the gis schema to call st_x and st_y.
 */
const POSTGIS_CATALOGS = [
    'gis.geography_columns',
    'gis.geometry_columns',
    'gis.spatial_ref_sys',
];

describe.skipIf(!DSN)('read_path grants (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    const reachable = async (privilege: string) => {
        const rows = await sql<{rel: string}[]>`
            SELECT n.nspname || '.' || c.relname AS rel
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND has_schema_privilege('read_path', n.oid, 'USAGE')
              AND (has_table_privilege('read_path', c.oid, ${privilege})
                   -- A grant on some columns only, as feedback's INSERT is
                   -- (decision 039). Postgres has column privileges for these three.
                   OR (${privilege} IN ('SELECT', 'INSERT', 'UPDATE') AND EXISTS (
                       SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                         AND has_column_privilege('read_path', c.oid, a.attnum, ${privilege}))))
            ORDER BY (n.nspname || '.' || c.relname) COLLATE "C"`;
        return rows.map(r => r.rel);
    };

    test('read_path reads what the build reads, plus the platform queue', async () => {
        expect(await reachable('SELECT'))
            .toEqual([...Object.keys(READS), ...POSTGIS_CATALOGS, ...PLATFORM_QUEUE].sort());
    });

    test.each(Object.entries(READS))('read_path reads exactly these columns of %s', async (rel, columns) => {
        const rows = await sql<{column: string, readable: boolean}[]>`
            SELECT a.attname AS column,
                   has_column_privilege('read_path', ${rel}::regclass, a.attnum, 'SELECT') AS readable
            FROM pg_attribute a
            WHERE a.attrelid = ${rel}::regclass AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum`;
        const readable = rows.filter(r => r.readable).map(r => r.column);
        expect(readable.sort()).toEqual([...(columns ?? rows.map(r => r.column))].sort());
    });

    test('read_path writes nothing of ours', async () => {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
            expect(await reachable(privilege), privilege).toEqual(PLATFORM_QUEUE);
    });

    // A grant is not the whole story: many of these tables have row-level security,
    // and a role no read policy names sees zero rows without any error. So check
    // what it actually sees. postgres created read_path, so it may grant itself the
    // role for one rolled-back transaction; nothing persists.
    const count = async (role: string | null, rel: string) => {
        let n = -1;
        await sql.begin(async tx => {
            if (role === 'read_path') await tx`GRANT read_path TO postgres`;
            if (role) await tx.unsafe(`SET LOCAL ROLE ${role}`);
            [{n}] = await tx.unsafe(`SELECT count(*)::int AS n FROM ${rel}`) as [{n: number}];
            throw new RolledBack();
        }).catch(e => { if (!(e instanceof RolledBack)) throw e; });
        return n;
    };

    // The build derives the occurrences from these as their owner would see them: row-level
    // security must not hide any from read_path, or the files would silently lack them.
    test('read_path sees every row of what it reads', async () => {
        for (const rel of Object.keys(READS))
            expect(await count('read_path', rel), rel).toBe(await count(null, rel));
    }, 120_000);

    // Rights policy D-21 (decision 015): verbatim Bigg's-sheet text is on no page,
    // so the build that renders the pages never holds it.
    test.each([
        ['public.nicknames', 'story'],
        ['public.individuals', 'notes'],
    ])('%s.%s stays withheld', async (rel, column) => {
        const [row] = await sql<{ok: boolean}[]>`
            SELECT has_column_privilege('read_path', ${rel}, ${column}, 'SELECT') AS ok`;
        expect(row!.ok).toBe(false);
    });
});

class RolledBack extends Error {}

