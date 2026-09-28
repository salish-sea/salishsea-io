/**
 * What the read-path build's role can reach, pinned (decision 056).
 *
 * The role exists so the build machine never holds credentials that reach more
 * than the files publish. That is only true while nothing widens it by accident:
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

/** What the static files publish. */
const PUBLISHED = [
    'public.occurrences',
];

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

    test('read_path reads what the files publish, plus the platform queue', async () => {
        expect(await reachable('SELECT')).toEqual([...PUBLISHED, ...PLATFORM_QUEUE].sort());
    });

    test('read_path writes nothing of ours', async () => {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
            expect(await reachable(privilege), privilege).toEqual(PLATFORM_QUEUE);
    });
});
