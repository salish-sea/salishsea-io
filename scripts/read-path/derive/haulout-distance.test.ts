import geodesic from 'geographiclib-geodesic';
import { readFileSync } from 'node:fs';
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

// The twin against what the function it twins answered, captured before Postgres retired
// (salish-9uu.11): points around three haul-out sites, at five bearings and distances from a
// few metres to past the largest radius, including ones a sphere would measure on the other
// side of a 500 m radius. `metres` is PostGIS's st_distance to the probe, `distance_m`
// public.haulout_distance_m's answer. Not a distance of exactly some n + 0.5 m: st_project
// placed each probe at a distance PostGIS measures exactly, GeographicLib measures each
// within some tens of nanometres of it (40 at most, measured over these), and at a tie that
// difference decides the rounding. A real report sits that close to a tie about once in
// ten million.
describe('distanceM measures what public.haulout_distance_m did', () => {
    const rows = readFileSync(new URL('../fixtures/twins/haulout-distance.tsv', import.meta.url), 'utf8')
        .trimEnd().split('\n').slice(1)
        .map(line => line.split('\t').map(Number) as [number, number, number, number, number, number])
        .map(([site_lat, site_lon, lat, lon, metres, distance_m]) => ({site_lat, site_lon, lat, lon, metres, distance_m}));

    test('around three haul-out sites', () => {
        expect(rows.length).toBe(120);
        const far = rows.filter(r =>
            Math.abs(Geodesic.WGS84.Inverse(r.site_lat, r.site_lon, r.lat, r.lon).s12! - r.metres) > 1e-6);
        expect(far).toEqual([]);
        const disagreeing = rows.filter(r => distanceM(r.site_lat, r.site_lon, r.lat, r.lon) !== r.distance_m);
        expect(disagreeing).toEqual([]);
    });
});
