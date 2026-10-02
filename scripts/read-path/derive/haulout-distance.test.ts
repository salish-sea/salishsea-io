import geodesic from 'geographiclib-geodesic';
import postgres from 'postgres';
import { describe, expect, test } from 'vitest';

import { distanceM, pgRound } from './haulout-distance.ts';

const { Geodesic } = geodesic;

describe('pgRound', () => {
    test('rounds to the nearest integer', () => {
        expect(pgRound(499.4)).toBe(499);
        expect(pgRound(499.6)).toBe(500);
    });

    test('a half goes to the even neighbour, as rint does', () => {
        expect(pgRound(499.5)).toBe(500);
        expect(pgRound(500.5)).toBe(500);
        expect(pgRound(0.5)).toBe(0);
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

// The twin against the function it twins, on points around every seeded haul-out site:
// five bearings, and distances from a few metres to past the largest radius, including
// ones a sphere would measure on the other side of a 500 m radius. Not a distance of
// exactly some n + 0.5 m: st_project places a probe at a distance PostGIS measures exactly,
// GeographicLib measures each within some tens of nanometres of it (40 at most, measured
// over these), and at a tie that difference decides the rounding. A real report sits that
// close to a tie about once in ten million.
describe.skipIf(!DSN)('distanceM measures what public.haulout_distance_m does (local Supabase)', () => {
    test('around every haul-out site', async () => {
        const sql = postgres(DSN as string, {prepare: false, max: 1});
        try {
            const rows = await sql<{site_lat: number, site_lon: number, lat: number, lon: number, metres: number, distance_m: number}[]>`
                WITH probe AS (
                    SELECT h.location AS site, gis.st_project(
                               gis.st_setsrid(gis.st_makepoint((h.location).lon, (h.location).lat), 4326)::gis.geography,
                               d, radians(b))::gis.geometry AS p
                    FROM public.haulouts h,
                         unnest(array[3.7, 120.25, 498.6, 499.3, 499.7, 500.4, 501.9, 2000.2]) AS d,
                         unnest(array[0, 45, 90, 180, 270]) AS b
                )
                SELECT (site).lat AS site_lat, (site).lon AS site_lon,
                       gis.st_y(p) AS lat, gis.st_x(p) AS lon,
                       gis.st_distance(
                           gis.st_setsrid(gis.st_makepoint((site).lon, (site).lat), 4326)::gis.geography,
                           p::gis.geography) AS metres,
                       public.haulout_distance_m(site, ROW(gis.st_x(p), gis.st_y(p))::public.lon_lat) AS distance_m
                FROM probe`;
            expect(rows.length).toBeGreaterThan(0);
            const far = rows.filter(r =>
                Math.abs(Geodesic.WGS84.Inverse(r.site_lat, r.site_lon, r.lat, r.lon).s12! - r.metres) > 1e-6);
            expect(far).toEqual([]);
            const disagreeing = rows.filter(r => distanceM(r.site_lat, r.site_lon, r.lat, r.lon) !== r.distance_m);
            expect(disagreeing).toEqual([]);
        } finally {
            await sql.end();
        }
    });
});
