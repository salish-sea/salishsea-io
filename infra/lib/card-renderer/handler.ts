// Lambda behind a Function URL, fronted by the CloudFront `/cards/*` behavior.
//
// Routes:
//   /cards/o/<url-encoded occurrence id>.jpg
//   /cards/o/<url-encoded occurrence id>/<z>.jpg  — at the zoom of a shared view of the map
//   /cards/day/<YYYY-MM-DD>.jpg
//   /cards/day/<YYYY-MM-DD>/<x>,<y>,<z>.jpg  — the day framed on a shared view of the
//     map: its centre in whole EPSG:3857 metres and its zoom, as the site's URL gives them
//
// A miss returns 404 rather than a placeholder image: a crawler that gets no
// image falls back to a text-only card, which is the honest outcome and matches
// decision 019. A broken-image card would be worse than none.

import { renderDayCard, renderOccurrenceCard } from './cards.js';
import { fetchDayOccurrences, fetchOccurrence } from './data.js';
import { INCOMPLETE, MISS as MISS_CACHE, cacheControlForDate, cacheControlForInstant } from './cache-control.js';
import type { Card, Frame } from './cards.js';
import { isValidDate, pacificDayRange } from './pacific-day.js';
import { MERCATOR_EXTENT, fromMetres } from './mercator.js';

// Cache lifetimes are keyed on how recent the card's subject is — see
// cache-control.ts for why, and for the window.

// An encoded id has no '/', so a zoom after one can't be part of it; that form is matched first.
const ZOOMED_OCCURRENCE_PATH = /^\/cards\/o\/([^/]+)\/([0-9]+)\.jpg$/;
const OCCURRENCE_PATH = /^\/cards\/o\/(.+)\.jpg$/;
const DAY_PATH = /^\/cards\/day\/([0-9]{4}-[0-9]{2}-[0-9]{2})\.jpg$/;
const VIEW_PATH = /^\/cards\/day\/([0-9]{4}-[0-9]{2}-[0-9]{2})\/(-?[0-9]+),(-?[0-9]+),([0-9]+)\.jpg$/;

/**
 * The zooms a shared view's card is drawn at: the basemap's image tiles go up to 15,
 * and below 3 a card is wider than the world. The edge handler brings a link's zoom
 * into this range before it names the card (its MIN_VIEW_ZOOM and MAX_VIEW_ZOOM).
 */
export const VIEW_ZOOMS = { min: 3, max: 15 } as const;

interface FunctionUrlEvent {
  rawPath?: string;
  requestContext?: { http?: { path?: string } };
}

interface Result {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

/** A card, cached as its subject allows, or briefly if some of its basemap tiles failed. */
const image = ({ jpeg, failedTiles }: Card, cacheControl: string): Result => ({
  statusCode: 200,
  headers: { 'content-type': 'image/jpeg', 'cache-control': failedTiles > 0 ? INCOMPLETE : cacheControl },
  body: jpeg.toString('base64'),
  isBase64Encoded: true,
});

const miss = (reason: string): Result => ({
  statusCode: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': MISS_CACHE },
  body: reason,
});

export const handler = async (event: FunctionUrlEvent): Promise<Result> => {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? '';
  const started = Date.now();

  try {
    const occurrenceMatch = path.match(ZOOMED_OCCURRENCE_PATH) ?? path.match(OCCURRENCE_PATH);
    if (occurrenceMatch) {
      const id = decodeURIComponent(occurrenceMatch[1]!);
      const z = occurrenceMatch[2] === undefined ? undefined : Number(occurrenceMatch[2]);
      if (z !== undefined && (z < VIEW_ZOOMS.min || z > VIEW_ZOOMS.max)) return miss('zoom out of range');
      const occ = await fetchOccurrence(id);
      if (!occ?.location) {
        console.log(JSON.stringify({ msg: 'card-miss', kind: 'occurrence', id }));
        return miss('no such occurrence, or it has no location');
      }
      const card = await renderOccurrenceCard(occ, z);
      console.log(JSON.stringify({
        msg: 'card', kind: 'occurrence', id, z, ms: Date.now() - started, bytes: card.jpeg.length,
        failedTiles: card.failedTiles,
      }));
      return image(card, cacheControlForInstant(occ.observedAt));
    }

    const dayMatch = path.match(DAY_PATH) ?? path.match(VIEW_PATH);
    if (dayMatch) {
      const date = dayMatch[1]!;
      if (!isValidDate(date)) return miss('not a calendar date');
      let frame: Frame | undefined;
      if (dayMatch[2] !== undefined) {
        const [x, y, z] = dayMatch.slice(2, 5).map(Number) as [number, number, number];
        if (Math.abs(x) > MERCATOR_EXTENT || Math.abs(y) > MERCATOR_EXTENT) return miss('not a point on the map');
        if (z < VIEW_ZOOMS.min || z > VIEW_ZOOMS.max) return miss('zoom out of range');
        frame = { center: fromMetres(x, y), z };
      }
      const { endIso } = pacificDayRange(date);
      const occurrences = await fetchDayOccurrences(date);
      const card = await renderDayCard(occurrences, date, frame);
      console.log(JSON.stringify({
        msg: 'card', kind: 'day', date, view: frame ? path.slice(path.lastIndexOf('/') + 1, -4) : undefined,
        fetched: occurrences.length, ms: Date.now() - started, bytes: card.jpeg.length, failedTiles: card.failedTiles,
      }));
      return image(card, cacheControlForDate(date, endIso));
    }

    return miss('unrecognized card path');
  } catch (err) {
    // No fallback image on purpose — see the note at the top of this file.
    console.error(JSON.stringify({
      msg: 'card-error', path, ms: Date.now() - started, error: String(err),
    }));
    return {
      statusCode: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      body: 'card render failed',
    };
  }
};
