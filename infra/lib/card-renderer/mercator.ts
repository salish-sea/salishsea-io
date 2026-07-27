// Web Mercator (EPSG:3857) pixel maths for a slippy-tile basemap.
//
// One "world" at zoom z is 2^z tiles square, TILE px each. Everything below works
// in *world pixels* at a given zoom, because that is the coordinate space where a
// card's viewport, the tiles it needs, and the markers drawn on it all line up
// with plain arithmetic.

export const TILE = 256;

export interface LonLat {
  lon: number;
  lat: number;
}

/** Horizontal world-pixel position of a longitude at zoom `z`. */
export function lonToWorldX(lon: number, z: number): number {
  return (lon + 180) / 360 * Math.pow(2, z) * TILE;
}

/** Vertical world-pixel position of a latitude at zoom `z`. */
export function latToWorldY(lat: number, z: number): number {
  // Clamp to the Mercator limit: the projection sends the poles to infinity, and
  // a bad ingest row shouldn't be able to produce NaN geometry downstream.
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const s = Math.sin(clamped * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z) * TILE;
}

export function worldXToLon(x: number, z: number): number {
  return x / (Math.pow(2, z) * TILE) * 360 - 180;
}

export function worldYToLat(y: number, z: number): number {
  const n = Math.PI - 2 * Math.PI * y / (Math.pow(2, z) * TILE);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * The rectangle of world pixels a card covers: `width` x `height` centred on
 * `center` at zoom `z`. Every other calculation hangs off this.
 */
export interface Viewport {
  z: number;
  width: number;
  height: number;
  /** World-pixel coordinate of the card's left edge. */
  left: number;
  /** World-pixel coordinate of the card's top edge. */
  top: number;
}

export function viewport(center: LonLat, z: number, width: number, height: number): Viewport {
  return {
    z, width, height,
    left: lonToWorldX(center.lon, z) - width / 2,
    top: latToWorldY(center.lat, z) - height / 2,
  };
}

/** Where a point lands on the card, in card pixels from its top-left corner. */
export function project(point: LonLat, v: Viewport): { x: number; y: number } {
  return {
    x: lonToWorldX(point.lon, v.z) - v.left,
    y: latToWorldY(point.lat, v.z) - v.top,
  };
}

/** True when a point falls inside the card, with `pad` px of slack. */
export function isVisible(point: LonLat, v: Viewport, pad = 0): boolean {
  const { x, y } = project(point, v);
  return x >= -pad && x <= v.width + pad && y >= -pad && y <= v.height + pad;
}

export interface TileRef {
  x: number;
  y: number;
  z: number;
  /** Where this tile's top-left corner sits on the mosaic. */
  left: number;
  top: number;
}

/**
 * Every tile needed to cover `v`, plus the offset each one occupies in a mosaic
 * whose origin is the top-left tile. The mosaic is a whole number of tiles, so it
 * overhangs the card — `mosaicOffset` says how far in to crop afterwards.
 */
export function tilesFor(v: Viewport): {
  tiles: TileRef[];
  mosaicWidth: number;
  mosaicHeight: number;
  mosaicOffset: { left: number; top: number };
} {
  const tx0 = Math.floor(v.left / TILE);
  const ty0 = Math.floor(v.top / TILE);
  const tx1 = Math.floor((v.left + v.width) / TILE);
  const ty1 = Math.floor((v.top + v.height) / TILE);

  const span = Math.pow(2, v.z);
  const tiles: TileRef[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      // Wrap in x (the world repeats east-west); drop out-of-range y, where
      // there is simply no tile. Callers paint those as empty sea.
      if (ty < 0 || ty >= span) continue;
      tiles.push({
        x: ((tx % span) + span) % span,
        y: ty,
        z: v.z,
        left: (tx - tx0) * TILE,
        top: (ty - ty0) * TILE,
      });
    }
  }

  return {
    tiles,
    mosaicWidth: (tx1 - tx0 + 1) * TILE,
    mosaicHeight: (ty1 - ty0 + 1) * TILE,
    mosaicOffset: { left: Math.round(v.left - tx0 * TILE), top: Math.round(v.top - ty0 * TILE) },
  };
}
