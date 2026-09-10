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

    test('a signed-in contributor can create, edit and delete a sighting', async () => {
        // The half a logged-out smoke test cannot see. Rolled back.
        class Rollback extends Error {}
        const id = '11111111-1111-1111-1111-111111111111';
        await sql.begin(async (tx) => {
            const [user] = await tx<{id: string}[]>`SELECT id FROM auth.users LIMIT 1`;
            if (!user) throw new Rollback();   // no seeded user; nothing to assert
            await tx`SET LOCAL ROLE authenticated`;
            await tx.unsafe(`SET LOCAL request.jwt.claims = '{"sub":"${user.id}","role":"authenticated"}'`);

            const create = async (body: string) => tx`
                SELECT public.upsert_observation(
                    ${id}::uuid, NULL, ${body}::varchar, 1::smallint, NULL, now(), NULL,
                    ARRAY[]::public.occurrence_photo[], ROW(-123.0, 48.5)::public.lon_lat,
                    'Orcinus orca'::varchar, NULL)`;

            await create('created by a test');
            await create('edited by a test');
            const deleted = await tx`DELETE FROM public.observations WHERE id = ${id}::uuid`;
            expect(deleted.count).toBe(1);

            throw new Rollback();
        }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    });

    test('contributor_email_addresses is readable by nobody', async () => {
        const rows = await sql`
            SELECT privilege_type FROM information_schema.table_privileges
            WHERE table_schema = 'public' AND table_name = 'contributor_email_addresses'
              AND grantee IN ('anon', 'authenticated')`;
        expect(rows).toEqual([]);
    });
});
