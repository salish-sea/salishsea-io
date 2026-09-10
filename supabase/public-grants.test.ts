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
     * What a role can *effectively* do — the only question that matters.
     *
     * `has_table_privilege` / `has_column_privilege` answer it the way Postgres
     * does at query time: they account for a grant to PUBLIC, for privileges
     * inherited through role membership, and for a column-level grant standing
     * in for a table-level one. The catalogue views do none of that.
     * `information_schema.table_privileges` misses column grants entirely, and
     * both it and `column_privileges` record a grant to PUBLIC under the
     * grantee 'PUBLIC' — so a `GRANT UPDATE ON t TO PUBLIC` is invisible to a
     * query filtering on 'anon' while being fully effective for anon.
     */
    const effectiveTableWrites = async (role: string) => {
        const rows = await sql<{relname: string; priv: string}[]>`
            SELECT c.relname, p.priv
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
            WHERE c.relkind IN ('r','p','v','m')
              AND has_table_privilege(${role}, c.oid, p.priv)
            ORDER BY c.relname, p.priv`;
        return rows.map((r) => `${r.relname} ${r.priv}`);
    };

    /** Tables a role can write at least one column of, however the grant was made. */
    const effectivelyWritableTables = async (role: string) => {
        const rows = await sql<{relname: string}[]>`
            SELECT DISTINCT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            CROSS JOIN unnest(ARRAY['INSERT','UPDATE','REFERENCES']) AS p(priv)
            WHERE c.relkind IN ('r','p','v','m')
              AND has_column_privilege(${role}, c.oid, a.attnum, p.priv)
            ORDER BY c.relname`;
        return rows.map((r) => r.relname);
    };

    test('anon holds no table-level write on anything', async () => {
        expect(await effectiveTableWrites('anon')).toEqual([]);
    });

    test('anon can write columns of feedback and nothing else', async () => {
        expect(await effectivelyWritableTables('anon')).toEqual(['feedback']);

        const rows = await sql<{attname: string}[]>`
            SELECT a.attname FROM pg_attribute a
            WHERE a.attrelid = 'public.feedback'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('anon', a.attrelid, a.attnum, 'INSERT')
            ORDER BY a.attname`;
        // Not notified_at, and not github_issue: a client that can write either
        // can file a report the notifier will never look at.
        expect(rows.map((r) => r.attname)).toEqual(FEEDBACK_COLUMNS);
    });

    test('authenticated holds table-level writes on the two sighting tables only', async () => {
        const expected = WRITABLE_BY_CONTRIBUTORS.flatMap((table) =>
            CONTRIBUTOR_WRITES.map((privilege) => `${table} ${privilege}`)).sort();
        expect(await effectiveTableWrites('authenticated')).toEqual(expected);
    });

    test('authenticated can write columns of those two and feedback, nothing else', async () => {
        expect(await effectivelyWritableTables('authenticated'))
            .toEqual(['feedback', ...WRITABLE_BY_CONTRIBUTORS].sort());
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
        for (const role of ['anon', 'authenticated']) {
            const rows = await sql<{attname: string}[]>`
                SELECT a.attname FROM pg_attribute a
                WHERE a.attrelid = 'public.contributor_email_addresses'::regclass
                  AND a.attnum > 0 AND NOT a.attisdropped
                  AND has_column_privilege(${role}, a.attrelid, a.attnum, 'SELECT')
                ORDER BY a.attname`;
            expect(rows.map((r) => r.attname), `${role} can read a column of it`).toEqual([]);
        }
    });
});
