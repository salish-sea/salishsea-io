import sharp from 'sharp';
import { TILE, type Viewport, tilesFor } from './mercator.js';

/**
 * Where basemap tiles come from: the image tiles of our own basemap, salish-sea/basemap
 * (decisions 074 and 076; the basemap's decision 014). They are the map's own style
 * without its labels, so a card looks like the map it links to. Each is a 256-pixel tile
 * drawn at 512, for high-density screens, so it is shrunk to 256 here. Cards ask for
 * zooms 8 and 9, which the tiles cover wherever SalishSea.io has data.
 *
 * The same set as `IMAGE_TILES` in src/profile-map.ts, which src/style.test.ts checks;
 * scripts/update-basemap.ts rewrites both.
 */
export const IMAGE_TILES = 'https://tiles.salishsea.io/images/86f8ccd15381ab0e/{z}/{x}/{y}.webp';

/** What the basemap's sources ask to be credited with: OpenStreetMap's licence requires it. */
export const BASEMAP_ATTRIBUTION = '© OpenStreetMap contributors; depths from NOAA, Natural Resources Canada, GEBCO';

/** Painted where a tile is missing so a gap reads as ocean, not as a hole. */
const SEA = { r: 0xc3, g: 0xde, b: 0xeb };

const TILE_TIMEOUT_MS = 4000;

/**
 * The tiles the basemap has, as "z x y", from the list it publishes beside them (the
 * basemap's decision 014): its image tiles cover only some of the map, and S3 answers a
 * request for one it doesn't hold with 403, the same answer it would give if its
 * permissions broke. Fetched once for each Lambda instance; a fetch that fails is tried
 * again on the next card, and until then the list is unknown.
 */
let held: Promise<Set<string>> | undefined;
async function heldTiles(): Promise<Set<string> | undefined> {
  held ??= (async () => {
    const res = await fetch(IMAGE_TILES.replace('{z}/{x}/{y}.webp', 'tiles.txt'), { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`tiles.txt: ${res.status}`);
    return new Set((await res.text()).split('\n').filter(Boolean));
  })();
  try {
    return await held;
  } catch {
    held = undefined;
    return undefined;
  }
}

/** For tests: forget the list of tiles, so that the next card fetches it again. */
export function forgetHeldTiles(): void {
  held = undefined;
}

/**
 * One tile, at TILE pixels; 'absent' if the basemap's list says it has no such tile; or
 * 'failed' if it didn't arrive, by a timeout, a network error or any answer but a tile.
 * Either is survivable: the mosaic keeps the sea-coloured background there. Only a failure
 * would be filled in by drawing the card again. When the list is unknown, every tile is
 * asked for, and any that doesn't arrive counts as failed.
 */
async function fetchTile(z: number, x: number, y: number, list: Set<string> | undefined): Promise<Buffer | 'absent' | 'failed'> {
  if (list && !list.has(`${z} ${x} ${y}`)) return 'absent';
  const url = IMAGE_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
    if (!res.ok) return 'failed';
    return await sharp(Buffer.from(await res.arrayBuffer())).resize(TILE, TILE).png().toBuffer();
  } catch {
    return 'failed';
  }
}

/**
 * The basemap for `v`, as raw card-sized image data. Tiles are fetched
 * concurrently — a card needs ~18 of them and doing that serially is the
 * difference between a fast card and a crawler timeout. `failed` counts the tiles that
 * didn't arrive, so that a card with holes isn't cached as if it were whole.
 */
export async function renderBasemap(v: Viewport): Promise<{ image: Buffer; failed: number }> {
  const { tiles, mosaicWidth, mosaicHeight, mosaicOffset } = tilesFor(v);

  const list = await heldTiles();
  const fetched = await Promise.all(
    tiles.map(async t => ({ t, tile: await fetchTile(t.z, t.x, t.y, list) })),
  );

  const composites = fetched.flatMap(({ t, tile }) =>
    Buffer.isBuffer(tile) ? [{ input: tile, left: t.left, top: t.top }] : []);

  const mosaic = await sharp({
    create: { width: mosaicWidth, height: mosaicHeight, channels: 3, background: SEA },
  }).composite(composites).png().toBuffer();

  const image = await sharp(mosaic)
    .extract({
      left: mosaicOffset.left,
      top: mosaicOffset.top,
      width: v.width,
      height: v.height,
    })
    .png()
    .toBuffer();

  return { image, failed: fetched.filter(({ tile }) => tile === 'failed').length };
}

export { TILE };
