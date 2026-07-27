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
 * What we do here: fetch tiles over HTTPS per request, composite them into one
 * image, render Esri's required attribution into it, and serve it online through
 * our CDN. We do not redistribute tiles, and nothing is packaged for offline use.
 *
 * Esri also publishes **World Ocean Base (for Export)**
 * (item `5d85d897aee241f884158aa514954443`), described as intended for exporting
 * imagery for *offline use in ArcGIS applications*; it requires an ArcGIS
 * Location Platform or Developer account and app credentials.
 *
 * Keeping the source in one constant is what makes moving to that layer — or any
 * other basemap — a config change plus a token in `fetchTile`, rather than a
 * rewrite. Nothing else in the renderer knows where tiles come from. See
 * decision 020 for the reasoning and its limits.
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
