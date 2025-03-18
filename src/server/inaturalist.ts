import { Temporal } from "temporal-polyfill";
import { queryStringAppend } from "../frontend/util.ts";
import type { Extent } from "ol/extent.js";
import { db } from "./database.ts";
import type { Feature, Point } from "geojson";
import { detectIndividuals, symbolFor } from "./taxon.ts";

type ResultPage<T> = {
  total_results: number;
  page: number;
  per_page: number;
  results: T[];
}

type Observation = {
  id: number;
  description: string | null;
  geojson: {coordinates: [number, number], type: 'Point'};
  photos: [{url: string}],
  taxon: {id: number; name: string; preferred_common_name: string | null};
  time_observed_at: string | null;
  uri: string;
}

type ObservationRow = {
  id: number;
  description: string | null;
  latitude: number;
  longitude: number;
  taxon_id: number;
  observed_at: number; // UNIX time
}

function assertValidObservation(obs: any): asserts obs is Observation {
  if (typeof obs !== 'object')
    throw 'Invalid observation';
  if (!('geojson' in obs))
    throw 'Observation has no geojson field';
  if (typeof obs.geojson !== 'object')
    throw 'Observation has invalid geojson field';
  // etc
}

function assertValidResponse(body: any): asserts body is ResultPage<Observation> {
  if (typeof body !== 'object')
    throw 'Response from iNaturalist was not an object';
  if (!('results' in body))
    throw 'Response from iNaturalist does not have results';
  if (!Array.isArray(body.results))
    throw 'Invalid results in iNaturalist response';
  for (const obs of body.results) {
    assertValidObservation(obs);
  }
}

const observationSearch = 'https://api.inaturalist.org/v2/observations';
const observationFieldspec = "(id:!t,description:!t,geojson:!t,photos:(url:!t),taxon:(id:!t,name:!t,preferred_common_name:!t),time_observed_at:!t,uri:!t)";
export async function fetchObservations(
  {earliest, extent: [minx, miny, maxx, maxy], latest, taxon_ids}:
    {earliest: Temporal.PlainDate, extent: Extent, latest: Temporal.PlainDate, taxon_ids: number[]}
) {
  const per_page = 200;
  let page = 1;
  let total = Infinity;
  const results: Observation[] = [];
  while (per_page * page < total) {
    const url = queryStringAppend(observationSearch, {
      d1: earliest.toString(),
      d2: latest.toString(),
      nelat: maxy.toFixed(6),
      nelng: maxx.toFixed(6),
      swlat: miny.toFixed(6),
      swlng: minx.toFixed(6),
      taxon_id: taxon_ids,
      geoprivacy: 'open',
      taxon_geoprivacy: 'open',
      fields: observationFieldspec,
      page,
      per_page,
    });
    const request = new Request(url);
    request.headers.set('Accept', 'application/json');
    const response = await fetch(url);
    const body = await response.json();
    assertValidResponse(body);
    total = body.total_results;
    page++;
    results.concat(body.results);
  }
  return results;
}

const loadFeatureStatement = db.prepare<ObservationRow>(`
INSERT OR REPLACE INTO inaturalist_observations
( id,  description,  longitude,  latitude,  taxon_id,  observed_at)
VALUES
(@id, @description, @longitude, @latitude, @taxon_id, @observed_at)
`);
const upsert = db.transaction((rows: ObservationRow[]) => {
  for (const row of rows) {
    loadFeatureStatement.run(row);
  }
});
export async function loadObservations(observations: Observation[]) {
  const rows = observations
    .filter(observation => typeof observation.time_observed_at === 'string')
    .map(observation => {
      const observedAt = Temporal.Instant.from(observation.time_observed_at!);
      return {
        id: observation.id,
        description: nullIfEmpty(observation.description),
        longitude: observation.geojson.coordinates[0],
        latitude: observation.geojson.coordinates[1],
        observed_at: observedAt.epochSeconds,
        taxon_id: observation.taxon.id,
      }
    });
  upsert(rows);
  return rows.length;
}

function nullIfEmpty(str: string | null) {
  if (!str)
    return null;
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type ObservationProperties = {
  id: string;
  body: string | null;
  count: null;
  kind: 'Sighting';
  individuals: string[];
  name: string;
  source: 'iNaturalist';
  species: string;
  symbol: string;
  timestamp: number;
}
const sightingsBetweenQuery = db.prepare<
{earliest: number; latest: number},
  Omit<ObservationProperties, 'individuals' | 'symbol'> & {vernacular_name: string | null; scientific_name: string; longitude: number; latitude: number}
>(`
SELECT
  'inaturalist:' || o.id AS id,
  o.description AS body,
  null as count,
  'Sighting' as kind,
  'iNaturalist' as source,
  o.longitude,
  o.latitude,
  t.vernacular_name,
  t.scientific_name,
  o.observed_at as "timestamp"
FROM inaturalist_observations o
JOIN taxa t ON o.taxon_id = t.id
WHERE o.observed_at BETWEEN @earliest AND @latest
`);
export const sightingsBetween = (earliest: Temporal.Instant, latest: Temporal.Instant) => {
  const results: Feature<Point, ObservationProperties>[] = sightingsBetweenQuery
    .all({earliest: earliest.epochSeconds, latest: latest.epochSeconds})
    .map(row => ({
      id: row.id,
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [row.longitude, row.latitude],
      },
      properties: {
        ...row,
        individuals: row.body ? detectIndividuals(row.body) : [],
        symbol: 'HELLO' // symbolFor(row),
      }
    }));
  return results;
};
