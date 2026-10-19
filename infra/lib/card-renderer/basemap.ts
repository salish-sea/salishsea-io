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
 * One tile, at TILE pixels; 'absent' if the basemap has no file for it, since its image
 * tiles cover only some of the map and S3 answers 403 for a file it doesn't hold; or
 * 'failed' if it didn't arrive, by a timeout, a network error or a server error. Either is
 * survivable: the mosaic keeps the sea-coloured background there. Only a failure would be
 * filled in by drawing the card again.
 */
async function fetchTile(z: number, x: number, y: number): Promise<Buffer | 'absent' | 'failed'> {
  const url = IMAGE_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
    if (res.status === 403 || res.status === 404) return 'absent';
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

  const fetched = await Promise.all(
    tiles.map(async t => ({ t, tile: await fetchTile(t.z, t.x, t.y) })),
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
