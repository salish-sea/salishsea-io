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

/** What the static files publish: the map and calendar (056), the profile pages (057). */
const PUBLISHED = [
    'public.animal_names',
    'public.designations',
    'public.ecotype_occurrences',
    'public.group_occurrences',
    'public.group_parents',
    'public.haulout_occurrences',
    'public.haulouts',
    'public.individual_occurrences',
    // Some columns only: `notes` is withheld, as no page renders it (rights policy D-21).
    'public.individuals',
    'public.matriline_members',
    // Some columns only: `story` is withheld, as it is from anon (rights policy D-21).
    'public.nicknames',
    'public.occurrences',
    'public.parties',
    'public.social_groups',
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

    // A grant is not the whole story: five of these tables have row-level security,
    // and a role no read policy names sees zero rows without any error. So check
    // what it actually sees, against anon, for every published relation. postgres
    // created read_path, so it may grant itself the role for one rolled-back
    // transaction; nothing persists.
    test('read_path sees every row anon sees', async () => {
        const count = async (role: string, rel: string) => {
            let n = -1;
            await sql.begin(async tx => {
                if (role === 'read_path') await tx`GRANT read_path TO postgres`;
                await tx.unsafe(`SET LOCAL ROLE ${role}`);
                [{n}] = await tx.unsafe(`SELECT count(*)::int AS n FROM ${rel}`) as [{n: number}];
                throw new RolledBack();
            }).catch(e => { if (!(e instanceof RolledBack)) throw e; });
            return n;
        };
        for (const rel of PUBLISHED)
            expect(await count('read_path', rel), rel).toBe(await count('anon', rel));
    }, 120_000);   // two counts of each link view; slow against a mirror of production

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

