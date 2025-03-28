import { Temporal } from "temporal-polyfill";
import { queryStringAppend } from "../frontend/util.ts";
import { db } from "./database.ts";
import type { Extent } from "../types.ts";

type ResultPage<T> = {
  total_results: number;
  page: number;
  per_page: number;
  results: T[];
}

type Photo = {
  id: number;
  attribution: string;
  hidden: boolean;
  license_code: string | null;
  original_dimensions: {height: number, width: number};
  url: string; // e.g. `.../square.jpeg`
};

type Observation = {
  id: number;
  description: string | null;
  geojson: {coordinates: [number, number], type: 'Point'};
  license_code: string;
  photos: Photo[],
  taxon: {id: number; name: string; preferred_common_name: string | null};
  time_observed_at: string | null;
  uri: string;
  user: {login: string};
}

type ObservationRow = {
  id: number;
  description: string | null;
  latitude: number;
  longitude: number;
  taxon_id: number;
  observed_at: number; // UNIX time
  license_code: string;
  photos_json: string | null;
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
const observationFieldspec = "(id:!t,description:!t,geojson:!t,photos:(id:!t,attribution:!t,hidden:!t,license_code:!t,original_dimensions:(height:!t,width:!t),url:!t),license_code:!t,taxon:(id:!t,name:!t,preferred_common_name:!t),time_observed_at:!t,uri:!t,user:(login:!t))";
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
      licensed: true,
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
    results.push(...body.results);
  }
  return results;
}

const loadFeatureStatement = db.prepare<ObservationRow>(`
INSERT OR REPLACE INTO inaturalist_observations
( id,  description,  longitude,  latitude,  license_code,  taxon_id,  observed_at,  photos_json,  url,  username)
VALUES
(@id, @description, @longitude, @latitude, @license_code, @taxon_id, @observed_at, @photos_json, @url, @username)
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
      const photos = observation
        .photos
        .filter(photo => photo.license_code && !photo.hidden);
      return {
        id: observation.id,
        description: nullIfEmpty(observation.description),
        longitude: observation.geojson.coordinates[0],
        latitude: observation.geojson.coordinates[1],
        license_code: observation.license_code,
        taxon_id: observation.taxon.id,
        observed_at: observedAt.epochMilliseconds / 1000,
        photos_json: photos.length ? JSON.stringify(photos) : null,
        url: observation.uri,
        username: observation.user.login,
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
