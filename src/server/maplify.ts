import { Temporal } from "temporal-polyfill";
import { queryStringAppend } from "../frontend/util.ts";
import { db } from "./database.ts";
import type { Extent } from "../types.ts";

type Source = 'CINMS' | 'ocean_alert' | 'rwsas' | 'FARPB' | 'whale_alert';

type Result = {
  type: string; // always 'sighting'
  id: number; // records from source = 'rwsas' can have duplicate ids
  project_id: number;
  trip_id: number; // 0 appears to be sentinel
  name: string;
  scientific_name: string; // can be blank
  latitude: number;
  longitude: number;
  number_sighted: number; // [-999...0...1500]
  created: string; // e.g. "2025-01-21 17:50:00" in UTC??
  photo_url: string;
  comments: string;
  in_ocean: number;
  count_check: number;
  moderated: number; // 0, 1, or 2
  trusted: number;
  is_test: number;
  source: Source;
  usernm: string; // blank, "whalealertoa"
  icon: string;
}

type APIResponse = {
  count: string; // !!
  results: Result[];
}

type SightingRow = {
  id: number;
  project_id: number;
  trip_id: number;
  name: string;
  scientific_name: string;
  latitude: number;
  longitude: number;
  number_sighted: number;
  created: number; // UNIX time
  photo_url: string | null;
  comments: string | null;
  in_ocean: number;
  count_check: number;
  moderated: number;
  trusted: number;
  is_test: number;
  source: string;
  usernm: string | null;
  icon: string | null;
  taxon_id: number | null;
}

function assertValidResponse(response: any): asserts response is APIResponse {
  if (typeof response !== 'object')
    throw "Response was not a JSON object";
  if (!('results' in response))
    throw "No results in response";
  if (!Array.isArray(response.results))
    throw "Results were not an array.";
}

const baseURL = 'https://maplify.com/waseak/php/search-all-sightings.php';
/// Earliest and latest are perhaps in Florida time?
export async function fetchSightings(earliest: Temporal.PlainDate, latest: Temporal.PlainDate, extent: Extent) {
  const url = queryStringAppend(baseURL, {
    BBOX: extent,
    start: earliest,
    end: latest,
  });
  const request = new Request(url);
  request.headers.set('Accept', 'application/json')
  const response = await fetch(request);
  const body = await response.json();
  assertValidResponse(body);
  return body.results;
}

const clearExistingBetween = db.prepare<{earliest: number, latest: number}>(`
DELETE FROM maplify_sightings WHERE created BETWEEN @earliest AND @latest;
`);
const loadSightingStatement = db.prepare<SightingRow>(`
INSERT OR REPLACE INTO maplify_sightings
( id,  project_id,  trip_id,  name,  scientific_name,  latitude,  longitude,  number_sighted,  created,  photo_url,
  comments,  in_ocean,  count_check,  moderated,  trusted,  is_test,  source,  usernm,  icon)
VALUES
(@id, @project_id, @trip_id, @name, @scientific_name, @latitude, @longitude, @number_sighted, @created, @photo_url,
 @comments, @in_ocean, @count_check, @moderated, @trusted, @is_test, @source, @usernm, @icon);
`);
const inferTaxonIds = db.prepare(`
UPDATE maplify_sightings AS s
SET taxon_id = t.id
FROM taxa AS t
WHERE t.scientific_name = coalesce(
  nullif(s.scientific_name, ''),
  CASE s.name
  WHEN 'Killer Whale (Orca)' THEN 'Orcinus orca'
  WHEN 'Southern Resident Killer Whale' THEN 'Orcinus orca'
  WHEN 'Grey' THEN 'Eschrichtius robustus'
  WHEN 'California Sea Lion' THEN 'Zalophus californianus'
  WHEN 'Long-beaked Common Dolphin' THEN 'Delphinus delphis'
  WHEN 'Common Long-Beaked Dolphin' THEN 'Delphinus delphis'
  END
)
`);
function nullIfEmpty(str: string) {
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed : null;
}
const upsert = db.transaction((rows: SightingRow[], earliest: number, latest: number) => {
  clearExistingBetween.run({earliest, latest});
  for (const row of rows) {
    loadSightingStatement.run(row);
  }
  inferTaxonIds.run();
});
export function loadSightings(sightings: Result[]) {
  // Skip 'rwsas' source, which has duplicate record ids
  const toLoad = sightings
    .filter(sighting => sighting.source !== 'rwsas')
    .map(sighting => {
      const created = Temporal.PlainDateTime.from(sighting.created).toZonedDateTime('GMT').toInstant();
      return {
        ...sighting,
        comments: nullIfEmpty(sighting.comments),
        created: created.epochMilliseconds / 1000,
        photo_url: nullIfEmpty(sighting.photo_url),
        scientific_name: sighting.scientific_name,
        taxon_id: null,
      };
    });
  const earliest = Math.min(...toLoad.map(s => s.created));
  const latest = Math.max(...toLoad.map(s => s.created));
  upsert(toLoad, earliest, latest);
  return toLoad.length;
};
