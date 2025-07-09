import { db } from "./database.ts";
import type { Feature, Geometry, Point } from "geojson";
import { Temporal } from "temporal-polyfill";
import { detectIndividuals, symbolFor } from "./taxon.ts";
import '@formatjs/intl-datetimeformat/polyfill.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
import { marked } from 'marked';
import type { Direction } from "../direction.ts";
import type { FeatureProperties } from "../types.ts";
import { imputeTravelLines } from "./travel.ts";
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const domPurify = createDOMPurify(new JSDOM('').window);

export type SightingPhoto = {
  attribution?: string | null;
  url: string;
};

// body is html | null
export type SightingProperties = SightingsBetweenRow & {
  date: string;
  direction: Direction | null;
  individuals: string[];
  kind: 'Sighting';
  photos: SightingPhoto[];
  species: string;
  symbol: string | undefined;
  time: string;
};

type SightingsBetweenRow = {
  id: string;
  body: string | null;
  count: number | null;
  direction: Direction | null;
  latitude: number;
  longitude: number;
  photos_json: string | null;
  source: string;
  timestamp: number;
  url: string | null;
  path: string | null;
  userName: string | null;
  userSub: string | null;

  name: string; // vernacular name, or else scientific name
  scientific_name: string;
  vernacular_name: string | null;
};
const sightingsBetweenQuery = db.prepare<{earliest: number; latest: number}, SightingsBetweenRow>(`
SELECT * FROM combined_observations
WHERE timestamp BETWEEN @earliest AND @latest
ORDER BY timestamp ASC;
`);
export const sightingsBetween = (earliest: Temporal.Instant, latest: Temporal.Instant) => {
  const features: Feature<Point, SightingProperties>[] = sightingsBetweenQuery
    .all({earliest: earliest.epochMilliseconds / 1000, latest: latest.epochMilliseconds / 1000})
    .map(row => {
      const zoned = Temporal.Instant.fromEpochMilliseconds(row.timestamp * 1000).toZonedDateTimeISO('PST8PDT');
      const date = zoned.toPlainDate().toLocaleString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
      const time = zoned.toPlainTime().toLocaleString('en-US', {timeStyle: 'short'});
      const body = row.body ? domPurify.sanitize(marked.parse(row.body, {async: false})) : null;
      return {
        id: row.id,
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [row.longitude, row.latitude],
        },
        properties: {
          ...row,
          body,
          date,
          direction: row.direction || detectDirection(row.body || ''),
          time,
          kind: 'Sighting',
          individuals: detectIndividuals(row.body || ''),
          photos: row.photos_json ? JSON.parse(row.photos_json) : [],
          species: row.scientific_name.split(' ').slice(0, 2).join(' '),
          symbol: symbolFor(row),
        }
      }
    });
  return features;
};

const directionRE = /\b((north(east|west|))|(south(east|west|)))bound\b/i;
const detectDirection: (text: string) => Direction | null = (text: string) => {
  const matches = text.match(directionRE);
  if (matches)
    return matches[1]?.toLocaleLowerCase() as Direction || null;
  return null;
};

export const collectFeatures = (date: Temporal.PlainDate) => {
  const earliest = date.toZonedDateTime('PST8PDT');
  const latest = earliest.add({ hours: 24 });
  const sightings = sightingsBetween(earliest.toInstant(), latest.toInstant());
  const travelLines = imputeTravelLines(sightings);
  const features: Feature<Geometry, FeatureProperties>[] = [
    ...sightings,
    ...travelLines,
  ];
  const collection = {
    features,
    params: {date: date.toString()},
    type: 'FeatureCollection' as const,
  };
  return collection;
};
