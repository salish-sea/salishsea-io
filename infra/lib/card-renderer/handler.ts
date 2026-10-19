// Lambda behind a Function URL, fronted by the CloudFront `/cards/*` behavior.
//
// Routes:
//   /cards/o/<url-encoded occurrence id>.jpg
//   /cards/day/<YYYY-MM-DD>.jpg
//
// A miss returns 404 rather than a placeholder image: a crawler that gets no
// image falls back to a text-only card, which is the honest outcome and matches
// decision 019. A broken-image card would be worse than none.

import { renderDayCard, renderOccurrenceCard } from './cards.js';
import { fetchDayOccurrences, fetchOccurrence } from './data.js';
import { INCOMPLETE, MISS as MISS_CACHE, cacheControlForDate, cacheControlForInstant } from './cache-control.js';
import type { Card } from './cards.js';
import { isValidDate, pacificDayRange } from './pacific-day.js';

// Cache lifetimes are keyed on how recent the card's subject is — see
// cache-control.ts for why, and for the window.

const OCCURRENCE_PATH = /^\/cards\/o\/(.+)\.jpg$/;
const DAY_PATH = /^\/cards\/day\/([0-9]{4}-[0-9]{2}-[0-9]{2})\.jpg$/;

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
    const occurrenceMatch = path.match(OCCURRENCE_PATH);
    if (occurrenceMatch) {
      const id = decodeURIComponent(occurrenceMatch[1]!);
      const occ = await fetchOccurrence(id);
      if (!occ?.location) {
        console.log(JSON.stringify({ msg: 'card-miss', kind: 'occurrence', id }));
        return miss('no such occurrence, or it has no location');
      }
      const card = await renderOccurrenceCard(occ);
      console.log(JSON.stringify({
        msg: 'card', kind: 'occurrence', id, ms: Date.now() - started, bytes: card.jpeg.length,
        failedTiles: card.failedTiles,
      }));
      return image(card, cacheControlForInstant(occ.observedAt));
    }

    const dayMatch = path.match(DAY_PATH);
    if (dayMatch) {
      const date = dayMatch[1]!;
      if (!isValidDate(date)) return miss('not a calendar date');
      const { endIso } = pacificDayRange(date);
      const occurrences = await fetchDayOccurrences(date);
      const card = await renderDayCard(occurrences, date);
      console.log(JSON.stringify({
        msg: 'card', kind: 'day', date, fetched: occurrences.length,
        ms: Date.now() - started, bytes: card.jpeg.length, failedTiles: card.failedTiles,
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
