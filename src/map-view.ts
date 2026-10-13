/**
 * The map's position as the URL carries it, and as MapLibre takes it.
 *
 * Permalinks (`x`, `y`, `z`) were written while the map was OpenLayers: the
 * centre in EPSG:3857 metres, and OpenLayers' zoom, which counts 256-pixel tiles.
 * MapLibre counts 512-pixel tiles, so the same view is one zoom level lower
 * there. Decision 076 keeps the links' meaning, so every link already shared
 * opens where it did; the conversion happens here and nowhere else.
 */

const EARTH_RADIUS = 6378137;
const DEGREES = 180 / Math.PI;

/** OpenLayers' zoom number for a MapLibre zoom. */
export const permalinkZoom = (mapZoom: number) => mapZoom + 1;
/** MapLibre's zoom for the zoom number in a permalink. */
export const mapZoom = (permalinkZoom: number) => permalinkZoom - 1;

/** EPSG:3857 metres for a longitude and latitude. */
export function fromLonLat([lon, lat]: readonly [number, number]): [number, number] {
  const x = EARTH_RADIUS * lon / DEGREES;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + lat / DEGREES / 2));
  return [x, y];
}

/** Longitude and latitude for EPSG:3857 metres. */
export function toLonLat([x, y]: readonly [number, number]): [number, number] {
  const lon = x / EARTH_RADIUS * DEGREES;
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * DEGREES;
  return [lon, lat];
}
