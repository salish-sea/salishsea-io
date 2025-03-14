import { Temporal } from "temporal-polyfill";
import { queryStringAppend } from "../frontend/util.ts";
import { withConnection } from "./database.ts";
import { DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";
import type { Feature, Point } from "geojson";

type Source = 'CINMS' | 'ocean_alert' | 'rwsas' | 'FARPB' | 'whale_alert';

type Result = {
  type: string;
  id: number;
  project_id: number;
  trip_id: number;
  name: string;
  scientific_name: string;
  latitude: number;
  longitude: number;
  number_sighted: number;
  created: string; // e.g. "2025-01-21 17:50:00"
  photo_url: string;
  comments: string;
  in_ocean: number;
  count_check: number;
  moderated: number;
  trusted: number;
  is_test: number;
  source: Source;
  usernm: string;
  icon: string;
}

type APIResponse = {
  count: string; // !!
  results: Result[];
}

export type Properties = {
  kind: 'Sighting';
  source: 'Maplify';
  taxon: string;
  timestamp: string;
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
export async function fetchSightings(earliest: Temporal.PlainDate, latest: Temporal.PlainDate) {
  const url = queryStringAppend(baseURL, {
    BBOX: [-180, 0, 180, 90],
    start: earliest,
    end: latest,
  });
  const request = new Request(url);
  request.headers.set('Content-Type', 'application/json')
  const response = await fetch(request);
  const body = await response.json();
  assertValidResponse(body);
  return body.results;
}

export async function loadSightings(sightings: Result[]) {
  return await withConnection(async (dbconn: DuckDBConnection) => {
    await dbconn.run(`
CREATE TABLE IF NOT EXISTS maplify_sightings (
  type varchar not null,
  id integer not null,
  name varchar,
  scientific_name string,
  latitude double not null,
  longitude double not null,
  number_sighted integer not null,
  created timestamptz not null,
  photo_url varchar,
  "comments" varchar,
  in_ocean boolean,
  count_check boolean,
  moderated boolean,
  "trusted" boolean,
  is_test boolean,
  source varchar,
  usernm varchar,
  icon varchar,
);
    `);
    const appender = await dbconn.createAppender('maplify_sightings');
    for (const sighting of sightings) {
      appender.appendVarchar(sighting.type);
      appender.appendInteger(sighting.id);
      appender.appendVarchar(sighting.name);
      appender.appendVarchar(sighting.scientific_name);
      appender.appendDouble(sighting.latitude);
      appender.appendDouble(sighting.longitude);
      appender.appendInteger(sighting.number_sighted);

      const created = Temporal.PlainDateTime.from(sighting.created).toZonedDateTime('GMT').toInstant();
      const timestamp = new DuckDBTimestampValue(created.epochMicroseconds);
      appender.appendTimestamp(timestamp);

      appender.appendVarchar(sighting.photo_url);
      appender.appendVarchar(sighting.comments);
      appender.appendBoolean(sighting.in_ocean === 1);
      appender.appendBoolean(sighting.count_check === 1);
      appender.appendBoolean(sighting.moderated === 1);
      appender.appendBoolean(sighting.trusted === 1);
      appender.appendBoolean(sighting.is_test === 1);
      appender.appendVarchar(sighting.source);
      appender.appendVarchar(sighting.usernm);
      appender.appendVarchar(sighting.icon);
      appender.endRow();
    }
    appender.close();
    return sightings.length;
  });
}

export const sightingsBetween = async (earliest: Temporal.Instant, latest: Temporal.Instant) => {
  const query = `
    FROM maplify_sightings
    WHERE created BETWEEN '${earliest}' AND '${latest}'
  `;
  const result = await withConnection(dbconn => dbconn.runAndReadAll(query));
  const features: Feature<Point, Properties>[] = result.getRowObjectsJson()
    .map(row => ({
      id: `maplify:${row.id as number}`,
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [row.longitude as number, row.latitude as number],
      },
      properties: {
        kind: 'Sighting',
        name: row.name as string,
        source: 'Maplify',
        taxon: row.scientific_name as string,
        timestamp: row.timestamp?.toString() as string,
      }
    }));
    return features;
};
