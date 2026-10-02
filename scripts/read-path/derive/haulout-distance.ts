/**
 * How far each pinniped report near a haul-out site is from it, measured as Postgres
 * measures it (decision 061, salish-xv35.13): public.haulout_distance_m, which is
 * `round(st_distance(site::geography, report::geography))::integer`.
 *
 * PostGIS measures a geography distance on the WGS84 spheroid with GeographicLib's
 * geodesic inverse, so this calls the same algorithm rather than a sphere's haversine,
 * which is off by up to half a percent and would move a report across a 500 m radius.
 * `round` of a double is the C library's rint: halves go to the even neighbour.
 */

import type { DuckDBConnection } from '@duckdb/node-api';
import geodesic from 'geographiclib-geodesic';

const { Geodesic } = geodesic;

/** round(double precision) in Postgres: to the nearest integer, a half to the even one. */
export function pgRound(x: number): number {
    const floor = Math.floor(x);
    const fraction = x - floor;
    if (fraction !== 0.5) return Math.round(x);
    return floor % 2 === 0 ? floor : floor + 1;
}

/** public.haulout_distance_m(site, report), in metres. */
export function distanceM(siteLat: number, siteLon: number, lat: number, lon: number): number {
    return pgRound(Geodesic.WGS84.Inverse(siteLat, siteLon, lat, lon).s12!);
}

/**
 * Write `haulout_distance(haulout_id, occurrence_id, radius_m, distance_m)`, one row per
 * pair in the temp table haulout_nearby (derive/haulout-nearby.sql), into the
 * connection's in-memory catalog.
 */
export async function writeHauloutDistances(conn: DuckDBConnection): Promise<void> {
    const pairs = (await conn.runAndReadAll(
        'SELECT haulout_id, occurrence_id, radius_m, site_lat, site_lon, lat, lon FROM haulout_nearby',
    )).getRows() as [number, string, number, number, number, number, number][];
    await conn.run(`CREATE OR REPLACE TABLE memory.main.haulout_distance (
        haulout_id INTEGER, occurrence_id VARCHAR, radius_m INTEGER, distance_m INTEGER)`);
    const appender = await conn.createAppender('haulout_distance', 'main', 'memory');
    try {
        for (const [hauloutId, occurrenceId, radiusM, siteLat, siteLon, lat, lon] of pairs) {
            appender.appendInteger(hauloutId);
            appender.appendVarchar(occurrenceId);
            appender.appendInteger(radiusM);
            appender.appendInteger(distanceM(siteLat, siteLon, lat, lon));
            appender.endRow();
        }
        appender.flushSync();
    } finally {
        appender.closeSync();
    }
}
