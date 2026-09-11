/**
 * The haul-out site list and its attribution view read as anon (decision 040,
 * migration 20260911180000).
 *
 * The second test is the one that matters: a view's tables are checked against
 * the view's owner, but a function body the planner inlines is checked against
 * the CALLER, and anon has no USAGE on schema gis. `SET ROLE anon` reproduces
 * what a laptop's superuser connection cannot (migration 20260829040000's
 * lesson); the distance function is SECURITY DEFINER for this reason.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

describe.skipIf(!DSN)('haul-out sites (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    test('the atlas seed is present, keyed by the atlas row number, and hand-added sites number from 1001', async () => {
        const [{ n }] = await sql<{n: number}[]>`SELECT count(*)::int AS n FROM public.haulouts`;
        expect(n).toBe(362);
        const [shilshole] = await sql<{name: string; atlas_code: string; verified: boolean}[]>`
            SELECT name, atlas_code, verified FROM public.haulouts WHERE id = 340`;
        expect(shilshole).toMatchObject({ name: 'Shilshole Bay Area', atlas_code: '10.19', verified: false });
        const [{ next }] = await sql<{next: string}[]>`SELECT last_value::text AS next FROM public.haulouts_id_seq`;
        expect(Number(next)).toBeGreaterThanOrEqual(1000);
    });

    test('anon reads a site and its attributed reports without a permissions error', async () => {
        await sql.begin(async tx => {
            await tx`SET LOCAL ROLE anon`;
            const sites = await tx`SELECT id, name, location, radius_m FROM public.haulouts WHERE id = 340`;
            expect(sites).toHaveLength(1);
            // Empty on a fresh database; the point is that it answers at all.
            const reports = await tx`SELECT haulout_id, distance_m, species_name FROM public.haulout_occurrences WHERE haulout_id = 340`;
            expect(Array.isArray(reports)).toBe(true);
            for (const r of reports) expect(r['distance_m']).toBeLessThanOrEqual(500);
        });
    });
});
