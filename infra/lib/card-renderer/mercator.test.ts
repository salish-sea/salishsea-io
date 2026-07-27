import {
  TILE, isVisible, latToWorldY, lonToWorldX, project, tilesFor, viewport, worldXToLon, worldYToLat,
} from './mercator';

const CARD = { w: 1200, h: 630 };

describe('Web Mercator projection', () => {
  it('places the antimeridian and prime meridian where the tile scheme expects', () => {
    // At zoom 0 the whole world is one 256px tile: lon -180 is x=0, lon 0 is the middle.
    expect(lonToWorldX(-180, 0)).toBeCloseTo(0, 6);
    expect(lonToWorldX(0, 0)).toBeCloseTo(TILE / 2, 6);
    expect(lonToWorldX(180, 0)).toBeCloseTo(TILE, 6);
    // The equator sits halfway down; Mercator is symmetric about it.
    expect(latToWorldY(0, 0)).toBeCloseTo(TILE / 2, 6);
  });

  it('round-trips lon/lat through world pixels', () => {
    for (const [lon, lat] of [[-123.09, 48.61], [-121.89, 36.61], [0, 0], [151.2, -33.87]]) {
      const z = 11;
      expect(worldXToLon(lonToWorldX(lon!, z), z)).toBeCloseTo(lon!, 6);
      expect(worldYToLat(latToWorldY(lat!, z), z)).toBeCloseTo(lat!, 6);
    }
  });

  it('clamps beyond the Mercator limit instead of returning infinity', () => {
    // A bad ingest row at a pole must not produce NaN/Infinity geometry.
    expect(Number.isFinite(latToWorldY(90, 9))).toBe(true);
    expect(Number.isFinite(latToWorldY(-90, 9))).toBe(true);
  });

  it('doubles the world size for each zoom level', () => {
    expect(lonToWorldX(45, 5) / lonToWorldX(45, 4)).toBeCloseTo(2, 9);
  });
});

describe('viewport and projection onto a card', () => {
  const center = { lon: -123.09, lat: 48.61 };
  const v = viewport(center, 9, CARD.w, CARD.h);

  it('puts the centre of the view at the centre of the card', () => {
    const { x, y } = project(center, v);
    expect(x).toBeCloseTo(CARD.w / 2, 6);
    expect(y).toBeCloseTo(CARD.h / 2, 6);
  });

  it('increases x eastward and y southward', () => {
    const east = project({ lon: center.lon + 0.5, lat: center.lat }, v);
    const south = project({ lon: center.lon, lat: center.lat - 0.5 }, v);
    expect(east.x).toBeGreaterThan(CARD.w / 2);
    expect(south.y).toBeGreaterThan(CARD.h / 2);
  });

  it('reports whether a point falls on the card', () => {
    expect(isVisible(center, v)).toBe(true);
    // Monterey is ~1,300 km away — nowhere near a Salish Sea card.
    expect(isVisible({ lon: -121.89, lat: 36.61 }, v)).toBe(false);
  });
});

describe('tile cover', () => {
  const v = viewport({ lon: -123.09, lat: 48.61 }, 9, CARD.w, CARD.h);
  const cover = tilesFor(v);

  it('covers the whole card', () => {
    expect(cover.mosaicWidth).toBeGreaterThanOrEqual(CARD.w);
    expect(cover.mosaicHeight).toBeGreaterThanOrEqual(CARD.h);
  });

  it('crops back to the card from inside the mosaic', () => {
    expect(cover.mosaicOffset.left).toBeGreaterThanOrEqual(0);
    expect(cover.mosaicOffset.top).toBeGreaterThanOrEqual(0);
    expect(cover.mosaicOffset.left + CARD.w).toBeLessThanOrEqual(cover.mosaicWidth);
    expect(cover.mosaicOffset.top + CARD.h).toBeLessThanOrEqual(cover.mosaicHeight);
  });

  it('needs the ~18 tiles the prototype measured', () => {
    // 1200x630 at 256px/tile is 5-6 across by 3-4 down.
    expect(cover.tiles.length).toBeGreaterThanOrEqual(15);
    expect(cover.tiles.length).toBeLessThanOrEqual(28);
  });

  it('lays tiles out on a grid with no gaps', () => {
    for (const t of cover.tiles) {
      expect(t.left % TILE).toBe(0);
      expect(t.top % TILE).toBe(0);
    }
  });

  it('wraps x across the antimeridian rather than asking for a negative tile', () => {
    const edge = viewport({ lon: 179.9, lat: 0 }, 4, CARD.w, CARD.h);
    const span = Math.pow(2, 4);
    for (const t of tilesFor(edge).tiles) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(span);
    }
  });

  it('omits tiles above and below the world instead of requesting them', () => {
    // A card centred near the Mercator limit overhangs the top of the world.
    const polar = viewport({ lon: 0, lat: 84.9 }, 3, CARD.w, CARD.h);
    const span = Math.pow(2, 3);
    for (const t of tilesFor(polar).tiles) {
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(span);
    }
  });
});
