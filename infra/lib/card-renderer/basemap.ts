import sharp from 'sharp';
import { TILE, type Viewport, tilesFor } from './mercator.js';

/**
 * Where basemap tiles come from. **This is the licensing seam — keep it one
 * constant.**
 *
 * This is the same Esri "World Ocean Base" layer the app itself draws
 * (`src/obs-map.ts`, `src/individual-map.ts`), chosen because a side-by-side
 * prototype showed its muted bathymetric styling reads far better at card size
 * than a coastline we draw ourselves (decision 020).
 *
 * Note the position we are knowingly taking: the ArcGIS item for this layer
 * (`1e126e7520f9466c9ca28b8f28b5e500`) says *"This layer is not intended to be
 * used to export tiles for offline"*, and compositing tiles into images we cache
 * and serve is arguably that. Esri publishes a sanctioned twin for exactly this
 * use — **World Ocean Base (for Export)**, item `5d85d897aee241f884158aa514954443`
 * — which reportedly consumes no credits but requires an ArcGIS Location Platform
 * or Developer account plus app credentials.
 *
 * Switching must therefore stay cheap: change the template below and add a token
 * to the request in `fetchTile`. Nothing else in the renderer knows where tiles
 * come from.
 *
 * Path order is Esri's: /{z}/{y}/{x}, not the usual /{z}/{x}/{y}.
 */
export const TILE_HOSTS = [
  'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile',
  'https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile',
];

/** Required on every card by the basemap's terms; matches the service's copyrightText. */
export const BASEMAP_ATTRIBUTION = 'Esri, Garmin, GEBCO, NOAA NGDC, and other contributors';

/** Painted where a tile is missing so a gap reads as ocean, not as a hole. */
const SEA = { r: 0xc4, g: 0xda, b: 0xea };

const TILE_TIMEOUT_MS = 4000;

/**
 * One tile, or null if every host refused. The app lists two Esri hosts and so do
 * we: a single flaky host shouldn't blank a card. A null is survivable — the
 * mosaic keeps the sea-coloured background there.
 */
async function fetchTile(z: number, x: number, y: number): Promise<Buffer | null> {
  for (const host of TILE_HOSTS) {
    try {
      const res = await fetch(`${host}/${z}/${y}/${x}`, {
        signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // Try the next host.
    }
  }
  return null;
}

/**
 * The basemap for `v`, as raw card-sized image data. Tiles are fetched
 * concurrently — a card needs ~18 of them and doing that serially is the
 * difference between a fast card and a crawler timeout.
 */
export async function renderBasemap(v: Viewport): Promise<{ image: Buffer; missing: number }> {
  const { tiles, mosaicWidth, mosaicHeight, mosaicOffset } = tilesFor(v);

  const fetched = await Promise.all(
    tiles.map(async t => ({ t, buf: await fetchTile(t.z, t.x, t.y) })),
  );

  const composites = fetched
    .filter((f): f is { t: typeof tiles[number]; buf: Buffer } => f.buf !== null)
    .map(({ t, buf }) => ({ input: buf, left: t.left, top: t.top }));

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

  return { image, missing: fetched.length - composites.length };
}

export { TILE };
