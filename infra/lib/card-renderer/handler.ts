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
import { configFromEnv, fetchOccurrence, fetchOccurrencesBetween } from './data.js';
import { currentPacificDate, isValidDate, pacificDayRange } from './pacific-day.js';

// A past sighting never moves, so its card is immutable. Today's day card still
// gains sightings as they arrive, so it gets a short life instead.
const IMMUTABLE = 'public, max-age=31536000, immutable';
const VOLATILE = 'public, max-age=900';
// Long enough that a crawler storm over one bad id doesn't reach Supabase
// repeatedly; short enough that a genuinely new occurrence isn't 404-locked.
const MISS = 'public, max-age=300';

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

const image = (jpeg: Buffer, cacheControl: string): Result => ({
  statusCode: 200,
  headers: { 'content-type': 'image/jpeg', 'cache-control': cacheControl },
  body: jpeg.toString('base64'),
  isBase64Encoded: true,
});

const miss = (reason: string): Result => ({
  statusCode: 404,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': MISS },
  body: reason,
});

export const handler = async (event: FunctionUrlEvent): Promise<Result> => {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? '';
  const started = Date.now();

  try {
    const occurrenceMatch = path.match(OCCURRENCE_PATH);
    if (occurrenceMatch) {
      const id = decodeURIComponent(occurrenceMatch[1]!);
      const occ = await fetchOccurrence(configFromEnv(), id);
      if (!occ?.location) {
        console.log(JSON.stringify({ msg: 'card-miss', kind: 'occurrence', id }));
        return miss('no such occurrence, or it has no location');
      }
      const jpeg = await renderOccurrenceCard(occ);
      console.log(JSON.stringify({
        msg: 'card', kind: 'occurrence', id, ms: Date.now() - started, bytes: jpeg.length,
      }));
      return image(jpeg, IMMUTABLE);
    }

    const dayMatch = path.match(DAY_PATH);
    if (dayMatch) {
      const date = dayMatch[1]!;
      if (!isValidDate(date)) return miss('not a calendar date');
      const { startIso, endIso } = pacificDayRange(date);
      const occurrences = await fetchOccurrencesBetween(configFromEnv(), startIso, endIso);
      const jpeg = await renderDayCard(occurrences, date);
      console.log(JSON.stringify({
        msg: 'card', kind: 'day', date, fetched: occurrences.length,
        ms: Date.now() - started, bytes: jpeg.length,
      }));
      return image(jpeg, date === currentPacificDate() ? VOLATILE : IMMUTABLE);
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
