import { db } from "./database.ts";
import type { Feature, Point } from "geojson";
import { Temporal } from "temporal-polyfill";
import { detectIndividuals, symbolFor } from "./taxon.ts";
import '@formatjs/intl-datetimeformat/polyfill.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';

export type SightingProperties = SightingsBetweenRow & {
  date: string;
  individuals: string[];
  kind: 'Sighting';
  prev_date: string | null;
  symbol: string | undefined;
  time: string;
}

type SightingsBetweenRow = {
  id: string;
  body: string | null;
  count: number | null;
  latitude: number;
  longitude: number;
  name: string; // vernacular name, or else scientific name
  prev_timestamp: number | null;
  scientific_name: string;
  species: string; // scientific name
  timestamp: number;
  vernacular_name: string | null;
}
const sightingsBetweenQuery = db.prepare<{earliest: number; latest: number}, SightingsBetweenRow>(`
SELECT
  s.*,
  lag(timestamp) OVER (ORDER BY timestamp DESC) AS prev_timestamp,
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
      const prev_date = row.prev_timestamp ? Temporal.Instant.fromEpochSeconds(row.prev_timestamp).toZonedDateTimeISO('PST8PDT').toPlainDate().toLocaleString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'}) : null;
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
          prev_date,
          kind: 'Sighting',
          individuals: detectIndividuals(row.body || ''),
          symbol: symbolFor(row),
        }
      }
    });
  return features;
};
