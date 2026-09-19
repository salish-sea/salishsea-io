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

    test('the bounding box never excludes a point the radius would keep', async () => {
        // The prefilter narrows candidates before haulout_distance_m; it must not
        // DECIDE membership. Asserted against the real geometry rather than
        // against the arithmetic, because the arithmetic was wrong once: 111,320
        // (the MEAN metres per degree of latitude) gave a half-box of 499.42 m at
        // 48N for a 500 m radius, so a report 499.5 m due north was dropped.
        //
        // ST_Project places each probe at an exact distance and bearing on the
        // spheroid, which is the only way to say "just inside the radius" without
        // re-deriving the metres-per-degree this test exists to check. Every
        // seeded site is probed at all four compass points at 99.9% of its radius;
        // due north is the worst case for the latitude bound, east and west for
        // longitude.
        const [{ failures }] = await sql<{failures: string[]}[]>`
            WITH probes AS (
                SELECT h.id, h.radius_m, (h.location).lat AS lat, (h.location).lon AS lon,
                       gis.ST_Project(
                           gis.ST_SetSRID(gis.ST_MakePoint((h.location).lon, (h.location).lat), 4326)::gis.geography,
                           h.radius_m * 0.999,
                           radians(az)
                       ) AS probe
                FROM public.haulouts h
                CROSS JOIN (VALUES (0), (90), (180), (270)) AS a(az)
            ), placed AS (
                SELECT id, radius_m, lat, lon,
                       gis.ST_Y(probe::gis.geometry) AS plat,
                       gis.ST_X(probe::gis.geometry) AS plon
                FROM probes
            )
            SELECT coalesce(array_agg(
                     id || ' at ' || public.haulout_distance_m(ROW(lon, lat)::public.lon_lat,
                                                               ROW(plon, plat)::public.lon_lat)
                        || 'm, radius ' || radius_m), '{}') AS failures
            FROM placed
            WHERE public.haulout_distance_m(ROW(lon, lat)::public.lon_lat,
                                            ROW(plon, plat)::public.lon_lat) <= radius_m
              AND NOT (
                plat BETWEEN lat - (radius_m / 110500.0) AND lat + (radius_m / 110500.0)
                AND plon BETWEEN lon - (radius_m / (111320.0 * greatest(cos(radians(lat)), 0.01)))
                             AND lon + (radius_m / (111320.0 * greatest(cos(radians(lat)), 0.01)))
              )`;
        expect(failures).toEqual([]);
    });
});
