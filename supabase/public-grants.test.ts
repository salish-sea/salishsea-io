/**
 * Who may write what in `public` (bd salish-6j6).
 *
 * Two opposite failures, and the suite has to hold both ends:
 *
 *   - **too many grants.** Supabase's ALTER DEFAULT PRIVILEGES hands anon and
 *     authenticated INSERT/UPDATE/DELETE on every new table in `public`. They
 *     are inert only for as long as no policy permits the write, so a
 *     reasonable-looking policy added later is on its own enough to make a
 *     table client-writable.
 *   - **too few.** Contribution runs as the signed-in person:
 *     `upsert_observation` is SECURITY INVOKER, and obs-summary deletes an
 *     observation directly. Revoke those and the sighting form breaks for
 *     contributors while every anonymous reader sees a perfectly good site —
 *     so nothing logged-out will notice, including the smoke tests.
 *
 * The second is not hypothetical: no migration had ever granted those writes.
 * Production had them by accident of the schema default and the local stack did
 * not have them at all, so the sighting form could never have worked locally.
 * 20260910040000 declares them; this pins them so they cannot quietly go again.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** The only relations a client may write, and the only privileges it may hold. */
const WRITABLE_BY_CONTRIBUTORS = ['observation_photos', 'observations'];
const CONTRIBUTOR_WRITES = ['DELETE', 'INSERT', 'UPDATE'];

/** feedback is written through a COLUMN-level grant, so it never appears in table_privileges. */
const FEEDBACK_COLUMNS = ['email', 'message', 'name', 'page_url', 'release', 'user_agent', 'user_uuid'];

describe.skipIf(!DSN)('public write grants (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    const writeGrants = async (role: string) => sql<{table_name: string; privilege_type: string}[]>`
        SELECT table_name, privilege_type
        FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND grantee = ${role}
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
        ORDER BY table_name, privilege_type`;

    /**
     * Which tables a role can write *any* column of.
     *
     * `column_privileges` rather than `table_privileges`, because the latter
     * does not report a column-level grant at all — so `GRANT UPDATE (x) ON
     * some_table TO anon` is invisible to it while being exactly the kind of
     * thing this file exists to catch. A table-level grant shows up here too,
     * as one row per column, so grouping by table gives one comparable answer
     * for both shapes.
     */
    const writableTables = async (role: string) => {
        const rows = await sql<{table_name: string}[]>`
            SELECT DISTINCT table_name FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND grantee = ${role}
              AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'REFERENCES')
            ORDER BY table_name`;
        return rows.map((r) => r.table_name);
    };

    test('anon may write no table but feedback, and only its seven columns', async () => {
        expect(await writableTables('anon')).toEqual(['feedback']);

        const columns = await sql<{column_name: string}[]>`
            SELECT column_name FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'feedback' AND grantee = 'anon'
            ORDER BY column_name`;
        // Not notified_at, and not github_issue: a client that can write either
        // can file a report that the notifier will never look at.
        expect(columns.map((c) => c.column_name)).toEqual(FEEDBACK_COLUMNS);
    });

    test('authenticated may write no table but feedback and the two sighting tables', async () => {
        expect(await writableTables('authenticated'))
            .toEqual(['feedback', ...WRITABLE_BY_CONTRIBUTORS].sort());
    });

    test('anon may not write anything, anywhere', async () => {
        // `feedback` is the one thing anon writes, and it does so through a
        // COLUMN-level grant, which is deliberately not a table privilege — so
        // this list being empty is the whole truth, not a near-miss.
        expect(await writeGrants('anon')).toEqual([]);
    });

    test('authenticated may write only the two tables the sighting form touches', async () => {
        const rows = await writeGrants('authenticated');
        const expected = WRITABLE_BY_CONTRIBUTORS.flatMap((table) =>
            CONTRIBUTOR_WRITES.map((privilege) => `${table} ${privilege}`));
        expect(rows.map((r) => `${r.table_name} ${r.privilege_type}`)).toEqual(expected);
    });

    test('a signed-in contributor can create, edit and delete a sighting, photos and all', async () => {
        // The half a logged-out smoke test cannot see. Rolled back.
        const [user] = await sql<{id: string}[]>`SELECT id FROM auth.users LIMIT 1`;
        // Loudly, not by skipping: a vanished fixture used to turn this into a
        // test that asserted nothing and still went green, which is the exact
        // failure shape this file is here to prevent.
        expect(user, 'no seeded auth.users row to act as a contributor').toBeDefined();

        class Rollback extends Error {}
        const id = '11111111-1111-1111-1111-111111111111';
        // license is NOT NULL on observation_photos, so a photo without one
        // never reaches the MERGE and the branch stays untested.
        const photo = (src: string) =>
            sql`ROW(NULL, 'image/jpeg', ${src}, NULL, 'cc-by')::public.occurrence_photo`;

        await sql.begin(async (tx) => {
            await tx`SET LOCAL ROLE authenticated`;
            await tx.unsafe(`SET LOCAL request.jwt.claims = '{"sub":"${user!.id}","role":"authenticated"}'`);

            const save = async (body: string, photos: unknown) => tx`
                SELECT public.upsert_observation(
                    ${id}::uuid, NULL, ${body}::varchar, 1::smallint, NULL, now(), NULL,
                    ${photos}, ROW(-123.0, 48.5)::public.lon_lat,
                    'Orcinus orca'::varchar, NULL)`;

            const photoCount = async () => {
                const [row] = await tx<{n: number}[]>`
                    SELECT count(*)::int AS n FROM public.observation_photos WHERE observation_id = ${id}::uuid`;
                return row!.n;
            };

            // Create WITH photos — an empty array never reaches the MERGE, so
            // the photo branch and its grants would go untested.
            await save('created by a test', sql`ARRAY[${photo('https://example.test/a.jpg')}]`);
            expect(await photoCount()).toBe(1);

            // Edit the photo set: one replaced by two exercises INSERT and UPDATE.
            await save('edited by a test', sql`ARRAY[${photo('https://example.test/b.jpg')}, ${photo('https://example.test/c.jpg')}]`);
            expect(await photoCount()).toBe(2);

            // And removing them exercises the DELETE arm of the MERGE.
            await save('photos removed', sql`ARRAY[]::public.occurrence_photo[]`);
            expect(await photoCount()).toBe(0);

            const deleted = await tx`DELETE FROM public.observations WHERE id = ${id}::uuid`;
            expect(deleted.count).toBe(1);

            throw new Rollback();
        }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    });

    test('contributor_email_addresses is readable by nobody, by any grant shape', async () => {
        // Column-level too: a `GRANT SELECT (address)` would not appear in
        // table_privileges, and one column of an email list is the whole point
        // of the list.
        const rows = await sql`
            SELECT privilege_type FROM information_schema.column_privileges
            WHERE table_schema = 'public' AND table_name = 'contributor_email_addresses'
              AND grantee IN ('anon', 'authenticated')`;
        expect(rows).toEqual([]);
    });
});
