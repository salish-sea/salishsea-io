/**
 * Who may write to public.feedback, and what (bd salish-5of, decision 039).
 *
 * Both of these, if they broke, would silently swallow a report — the failure
 * the feedback table exists to end:
 *
 *   - a client that can set `notified_at` can submit a report pre-marked as
 *     handled, and the notifier skips exactly those rows;
 *   - a client that can SELECT can read a stranger's name, email and words.
 *
 * A caveat worth stating, because it is the reason this file exists at all: on
 * 2026-09-10 the grant was wrong in production and right locally, and no local
 * test could tell. Supabase's ALTER DEFAULT PRIVILEGES granted anon full
 * read/write on every new table in `public`, and prod still carried that
 * default while the local stack had had it narrowed. A column-level GRANT on
 * top of a table-wide one changes nothing. So this test pins the intent and
 * catches a later migration re-granting — it does NOT catch the environment
 * drifting, which is what actually happened. That wants the sweep in
 * salish-6j6, and checking prod rather than a laptop.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** What a client legitimately writes: what a person typed, and what their browser reported. */
const WRITABLE = ['email', 'message', 'name', 'page_url', 'release', 'user_agent', 'user_uuid'];

describe.skipIf(!DSN)('public.feedback grants (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    for (const role of ['anon', 'authenticated']) {
        test(`${role} may INSERT only the columns a client owns`, async () => {
            const rows = await sql<{column_name: string}[]>`
                SELECT column_name FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = 'feedback'
                  AND grantee = ${role} AND privilege_type = 'INSERT'
                ORDER BY column_name`;
            // Notably absent: notified_at and github_issue, which belong to the
            // notifier, and id/created_at, which take their defaults.
            expect(rows.map((r) => r.column_name)).toEqual(WRITABLE);
        });

        test(`${role} may not read feedback at all`, async () => {
            const rows = await sql<{privilege_type: string}[]>`
                SELECT privilege_type FROM information_schema.table_privileges
                WHERE table_schema = 'public' AND table_name = 'feedback'
                  AND grantee = ${role}
                  AND privilege_type IN ('SELECT', 'UPDATE', 'DELETE')`;
            expect(rows.map((r) => r.privilege_type)).toEqual([]);
        });
    }

    test('row-level security is on, so a policy is required as well as a grant', async () => {
        const [table] = await sql<{relrowsecurity: boolean}[]>`
            SELECT relrowsecurity FROM pg_class WHERE oid = 'public.feedback'::regclass`;
        expect(table!.relrowsecurity).toBe(true);
    });
});
