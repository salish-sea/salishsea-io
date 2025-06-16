import { Temporal } from "temporal-polyfill";
import { queryStringAppend } from "../frontend/util.ts";
import { db } from "./database.ts";
import type { Extent } from "../types.ts";
import { z } from 'zod';
import { withTimeout } from "../utils.ts";

export const orcaId = 41521;
export const cetaceaId = 152871;
export const otariidaeId = 41736;

const ResultPageSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    total_results: z.number(),
    page: z.number(),
    per_page: z.number(),
    results: z.array(itemSchema),
  });

const PhotoSchema = z.object({
  id: z.number(),
  attribution: z.string(),
  hidden: z.boolean(),
  license_code: z.string().nullable(),
  original_dimensions: z.object({
    height: z.number(),
    width: z.number(),
  }),
  url: z.string(),
});

// It's worth validating the query results because it's easy for this type to diverge from the field spec, below.
const ObservationSchema = z.object({
  id: z.number(),
  description: z.string().nullable(),
  geojson: z.object({
    coordinates: z.tuple([z.number(), z.number()]),
    type: z.literal('Point'),
  }),
  license_code: z.string(),
  photos: z.array(PhotoSchema),
  taxon: z.object({
    id: z.number(),
    name: z.string(),
    preferred_common_name: z.string().nullable(),
  }),
  time_observed_at: z.string().nullable(),
  uri: z.string(),
  user: z.object({
    login: z.string().min(1),
  }),
});

const ObservationResultPageSchema = ResultPageSchema(ObservationSchema);
export type ObservationResultPage = z.infer<typeof ObservationResultPageSchema>;

// Export the schemas
export { PhotoSchema, ObservationSchema };

// Export the inferred types if needed
export type Photo = z.infer<typeof PhotoSchema>;
export type Observation = z.infer<typeof ObservationSchema>;

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

const observationSearch = 'https://api.inaturalist.org/v2/observations';
const observationFieldspec = "(id:!t,description:!t,geojson:!t,photos:(id:!t,attribution:!t,hidden:!t,license_code:!t,original_dimensions:(height:!t,width:!t),url:!t),license_code:!t,taxon:(id:!t,name:!t,preferred_common_name:!t),time_observed_at:!t,uri:!t,user:(login:!t))";
type FetchOptions = {earliest: Temporal.PlainDate, extent: Extent, latest: Temporal.PlainDate, taxon_ids: number[]};
export async function fetchObservations({earliest, extent: [minx, miny, maxx, maxy], latest, taxon_ids}: FetchOptions) {
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
    const response = await withTimeout(30 * 1000, async (signal) => {
      const request = new Request(url, {
        headers: {
          Accept: 'application/json',
        },
        signal,
      });
      return await fetch(request);
    });
    const payload = await response.json();
    const body = ObservationResultPageSchema.parse(payload);
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
