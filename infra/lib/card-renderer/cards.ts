// Card composition: turn an occurrence (or a day of them) into JPEG bytes.

import sharp from 'sharp';
import { BASEMAP_ATTRIBUTION, renderBasemap } from './basemap.js';
import { CARD_HEIGHT, CARD_WIDTH, chromeSvg, type Marker } from './chrome.js';
import { isVisible, viewport, type LonLat, type Viewport } from './mercator.js';
import type { Occurrence } from './data.js';

/**
 * Zoom for a single sighting. Nine is the app's own default view
 * (`src/obs-map.ts`) and the frame that read best in the renderer prototype:
 * enough coast to answer "where is this?" without becoming a continent.
 */
export const OCCURRENCE_ZOOM = 9;

/**
 * A day card frames the Salish Sea rather than fitting to its markers. Fitting
 * would be the obvious choice and the wrong one: 54% of recent sightings fall
 * outside the region, so a day's set routinely spans California to Alaska and
 * fitting it yields a continent with specks on it. See decision 020.
 */
export const SALISH_SEA_CENTER: LonLat = { lon: -123.2, lat: 48.5 };
export const DAY_ZOOM = 8;

const PACIFIC = 'America/Los_Angeles';

/** "June 3, 2025" in Pacific time — the timeline the site is organised around. */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: PACIFIC,
  }).format(new Date(normalizeInstant(iso)));
}

/**
 * Postgres hands back timestamps without a zone designator; JS would read those
 * as local time and silently shift the date. Treat a bare timestamp as UTC, which
 * is what it is.
 */
export function normalizeInstant(iso: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
}

async function compose(v: Viewport, chrome: Parameters<typeof chromeSvg>[0]): Promise<Buffer> {
  const { image } = await renderBasemap(v);
  return await sharp(image)
    .composite([{ input: chromeSvg(chrome, v) }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

/** A card for one sighting: the marker centred, species and date beneath. */
export async function renderOccurrenceCard(occ: Occurrence): Promise<Buffer> {
  if (!occ.location) throw new Error(`occurrence ${occ.id} has no location`);
  const v = viewport(occ.location, OCCURRENCE_ZOOM, CARD_WIDTH, CARD_HEIGHT);
  const count = occ.count ?? 1;
  return compose(v, {
    title: count > 1 ? `${count} ${occ.species}s` : occ.species,
    subtitle: `${formatDate(occ.observedAt)} · SalishSea.io`,
    attribution: BASEMAP_ATTRIBUTION,
    markers: [{ at: occ.location, primary: true }],
  });
}

/**
 * A card for a day's sightings.
 *
 * The caption counts *plotted* markers, never the total fetched. A viewer can
 * only see what is in frame, and a number that includes dots outside it would be
 * a caption that lies about its own picture.
 */
export async function renderDayCard(occurrences: Occurrence[], date: string): Promise<Buffer> {
  const v = viewport(SALISH_SEA_CENTER, DAY_ZOOM, CARD_WIDTH, CARD_HEIGHT);
  const markers: Marker[] = occurrences
    .filter(o => o.location && isVisible(o.location, v))
    .map(o => ({ at: o.location!, primary: false }));

  const title = markers.length === 1 ? '1 sighting' : `${markers.length} sightings`;
  return compose(v, {
    title,
    subtitle: `${formatDate(`${date}T12:00:00Z`)} · SalishSea.io`,
    attribution: BASEMAP_ATTRIBUTION,
    markers,
  });
}
