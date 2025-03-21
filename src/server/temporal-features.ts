import { db } from "./database.ts";
import type { Feature, Point } from "geojson";
import { Temporal } from "temporal-polyfill";
import { detectIndividuals, symbolFor } from "./taxon.ts";
import '@formatjs/intl-datetimeformat/polyfill.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';

export type SightingPhoto = {
  attribution?: string | null;
  url: string;
};

export type SightingProperties = SightingsBetweenRow & {
  date: string;
  individuals: string[];
  kind: 'Sighting';
  photos: SightingPhoto[];
  symbol: string | undefined;
  time: string;
};

type SightingsBetweenRow = {
  id: string;
  body: string | null;
  count: number | null;
  latitude: number;
  longitude: number;
  photos_json: string | null;
  source: string;
  timestamp: number;
  url: string | null;
  user: string | null;

  name: string; // vernacular name, or else scientific name
  scientific_name: string;
  vernacular_name: string | null;
};
const sightingsBetweenQuery = db.prepare<{earliest: number; latest: number}, SightingsBetweenRow>(`
SELECT
  s.*,
  coalesce(t.vernacular_name, t.scientific_name) AS name,
  t.scientific_name,
  t.vernacular_name
FROM (
  SELECT
    'maplify:' || id AS id,
    nullif(replace(trim(comments, ' '), '<br>', '\n'), '') AS body,
    iif(number_sighted > 0, number_sighted) AS count,
    latitude,
    longitude,
    created AS timestamp,
    iif(photo_url is not null, json_array(json_object('url', photo_url))) AS photos_json,
    source,
    null as url,
    null as user,
    taxon_id
  FROM maplify_sightings

  UNION ALL

  SELECT
    'inaturalist:' || id AS id,
    nullif(trim(description, ' '), '') AS body,
    null as count,
    latitude,
    longitude,
    observed_at as "timestamp",
    photos_json,
    'iNaturalist' as source,
    url,
    username AS user,
    taxon_id
  FROM inaturalist_observations
) AS s
JOIN taxa t ON s.taxon_id = t.id
WHERE timestamp BETWEEN @earliest AND @latest
ORDER BY timestamp desc;
`);
export const sightingsBetween = (earliest: Temporal.Instant, latest: Temporal.Instant) => {
  const features: Feature<Point, SightingProperties>[] = sightingsBetweenQuery
    .all({earliest: earliest.epochSeconds, latest: latest.epochSeconds})
    .map(row => {
      const zoned = Temporal.Instant.fromEpochSeconds(row.timestamp).toZonedDateTimeISO('PST8PDT');
      const date = zoned.toPlainDate().toLocaleString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'});
      const time = zoned.toPlainTime().toLocaleString('en-US', {timeStyle: 'short'});
      return {
        id: row.id,
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [row.longitude, row.latitude],
        },
        properties: {
          ...row,
          date,
          time,
          kind: 'Sighting',
          individuals: detectIndividuals(row.body || ''),
          photos: row.photos_json ? JSON.parse(row.photos_json) : [],
          symbol: symbolFor(row),
        }
      }
    });
  return features;
};
