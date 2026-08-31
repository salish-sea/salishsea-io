/**
 * Geographic extents, `[minx, miny, maxx, maxy]` in decimal lon/lat WGS84.
 *
 * Dependency-free on purpose. The Maplify ingest core
 * ([scripts/ingest/maplify.ts](../scripts/ingest/maplify.ts)) imports this file
 * under Deno, where `constants.ts`'s `temporal-polyfill` import would not
 * resolve — and the scope rule there (decision 036) must use the SAME Salish Sea
 * box the map filters on (decisions 022/023), not a copy that can drift.
 */
export type Extent = [number, number, number, number];

// A finite number, not a truthy one: 0 is a valid boundary (the equator, the
// prime meridian), and NaN/undefined from a malformed URL are not.
const finite = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n);

export function isExtent(input: number[]): input is Extent {
  if (input.length !== 4) return false;
  const [minx, miny, maxx, maxy] = input;
  if (!(finite(minx) && finite(miny) && finite(maxx) && finite(maxy))) return false;
  return minx < maxx && miny < maxy &&
    minx >= -180 && minx <= 180 && maxx >= -180 && maxx <= 180 &&
    miny >= -90 && miny <= 90 && maxy >= -90 && maxy <= 90;
}

/** Whether a lon/lat point lies inside (or on the edge of) an extent. */
export function extentContains([minx, miny, maxx, maxy]: Extent, lon: number, lat: number): boolean {
  return lon >= minx && lon <= maxx && lat >= miny && lat <= maxy;
}

/**
 * Where Maplify ingest reaches: the Acartia cooperative's boundaries, i.e. the
 * full Southern Resident range down to central California. Deliberately this
 * wide so that killer whales are consumed range-wide (decision 036); everything
 * else fetched from it is kept only inside {@link salishSeaExtent}.
 *
 * https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia
 */
export const acartiaExtent: Extent = [-136, 36, -120, 54];
export const pugetSoundExtent: Extent = [-123.15, 47.04, -122.20, 48.16];
export const sanJuansExtent: Extent = [-123.25, 48.4, -122.73, 48.79];
export const srkwExtent: Extent = [-125.5, 36, -122, 54];
/**
 * The Salish Sea plus the Strait of Juan de Fuca — the one box that means
 * "Salish Sea" everywhere: the map's region filter (decision 022) and the
 * ingest scope for non-killer-whale records (decision 036).
 */
export const salishSeaExtent: Extent = [-126, 47, -122, 50.5];
export const salishSRKWExtent: Extent = [-124, 47, -122, 49.5];
