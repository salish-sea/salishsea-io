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
        test(`${role} holds INSERT on the client's own columns and no other privilege at all`, async () => {
            // Every column privilege, not just the INSERT ones. `GRANT UPDATE
            // (notified_at) TO anon` would not appear in table_privileges and
            // would be filtered out of an INSERT-only query — while reopening
            // exactly the hole this table was fixed for, since a client that can
            // set notified_at can make its own report invisible to the notifier.
            const rows = await sql<{privilege_type: string; column_name: string}[]>`
                SELECT privilege_type, column_name FROM information_schema.column_privileges
                WHERE table_schema = 'public' AND table_name = 'feedback' AND grantee = ${role}
                ORDER BY privilege_type, column_name`;
            expect(rows.map((r) => `${r.privilege_type} ${r.column_name}`))
                .toEqual(WRITABLE.map((column) => `INSERT ${column}`));
        });

        test(`${role} may not read, update or delete feedback`, async () => {
            const rows = await sql<{privilege_type: string}[]>`
                SELECT privilege_type FROM information_schema.table_privileges
                WHERE table_schema = 'public' AND table_name = 'feedback'
                  AND grantee = ${role}
                  AND privilege_type IN ('SELECT', 'UPDATE', 'DELETE')`;
            expect(rows.map((r) => r.privilege_type)).toEqual([]);
        });
    }

    test('row-level security is on', async () => {
        const [table] = await sql<{relrowsecurity: boolean}[]>`
            SELECT relrowsecurity FROM pg_class WHERE oid = 'public.feedback'::regclass`;
        expect(table!.relrowsecurity).toBe(true);
    });

    // The grants and the policy are two halves of one contract, and each looks
    // fine while the other is broken: RLS enabled with no INSERT policy rejects
    // every submission, and a policy with no grant is a silent zero. Only doing
    // it settles both. Always rolled back, so nothing is left behind even if
    // SUPABASE_DB_URL points somewhere real.
    //
    // Two transactions, not one: a rejected statement aborts its transaction in
    // Postgres, so the refusal below cannot share with the submission above.
    class Rollback extends Error {}
    const rolledBack = async (fn: (tx: Sql) => Promise<void>) => {
        await sql.begin(async (tx) => { await fn(tx as unknown as Sql); throw new Rollback(); })
            .catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    };

    test('anon can actually submit — grant and policy together', async () => {
        await rolledBack(async (tx) => {
            await tx`SET LOCAL ROLE anon`;
            await tx`SELECT public.submit_feedback('A visitor', null, 'the site is broken', null, null, null)`;
            await tx`RESET ROLE`;

            const [row] = await tx<{name: string; notified_at: string | null; user_uuid: string | null}[]>`
                SELECT name, notified_at, user_uuid FROM public.feedback ORDER BY id DESC LIMIT 1`;
            expect(row!.name).toBe('A visitor');
            // Unfiled and unattributed, which is exactly what the notifier looks for.
            expect(row!.notified_at).toBeNull();
            expect(row!.user_uuid).toBeNull();
        });
    });

    test('anon cannot submit a report pre-marked as handled', async () => {
        // The production hole of 2026-09-10: the notifier skips rows whose
        // notified_at is set, so a client that can write it can file a report
        // guaranteed never to be seen.
        await rolledBack(async (tx) => {
            await tx`SET LOCAL ROLE anon`;
            await expect(
                tx`INSERT INTO public.feedback (name, message, notified_at) VALUES ('probe', 'x', now())`,
            ).rejects.toThrow(/permission denied/);
        });
    });
});
