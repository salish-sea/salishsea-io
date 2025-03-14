import type { Feature, Point } from "geojson";
import {Temporal} from "temporal-polyfill";
import { withConnection } from "./database.ts";
import { DuckDBConnection, DuckDBTimestampValue } from "@duckdb/node-api";

export type VesselLocation = {
  VesselID: number;
  VesselName: string;
  DepartingTerminalAbbrev: string | null;
  ArrivingTerminalAbbrev: string | null;
  Latitude: number;
  Longitude: number;
  Heading: number;
  InService: boolean;
  AtDock: boolean;
  TimeStamp: string;
}

export type VesselLocationResponse = VesselLocation[];

type InvalidRequestResponse = {
  Message?: string;
};

export type Properties = {
  kind: 'Ferry';
  name: string;
  source: 'WSF';
  timestamp: string;
};

const accessCode = process.env.WSF_ACCESS_CODE;

function assertValidResponse(response: any): asserts response is VesselLocationResponse {
  if (Array.isArray(response))
    return;
  if (typeof response === 'object' && 'Message' in response && typeof response.Message === 'string') {
    throw `Invalid response from WSF: ${response.Message}`;
  }
  throw "Didn't receive expected response from WSF.";
}

/// Fetch the current locations of vessels in service and under way.
export const fetchCurrentLocations = async () => {
  if (!accessCode)
    throw "Must set an access code at WSF_ACCESS_CODE to use the WSF API.";

  const url = `https://wsdot.wa.gov/ferries/api/vessels/rest/vessellocations?apiaccesscode=${accessCode}`;
  const request = new Request(url);
  request.headers.append('Content-Type', 'application/json');
  const response = await fetch(request);
  if (response.status === 400) {
    const contentType = response.headers.get('Content-Type');
    let error = response.statusText;
    if (contentType?.startsWith('application/json')) {
      const errorBody: InvalidRequestResponse = await response.json();
      error = errorBody.Message ?? error;
    }
    throw `Failed to fetch ferry locations: ${error}`;
  }
  const data = await response.json();
  assertValidResponse(data);
  return data;
}

// Load the most current location of each ferry, if any, within `within_s` seconds of `asof`.
export const locationsAsOf = async (asof: Temporal.Instant, within_s: number = 90) => {
  const query = `
    SELECT *, abs(epoch("timestamp" - timestamptz '${asof}')) AS ts_delta_s
    FROM ferry_locations
    WHERE in_service AND NOT at_dock
    WINDOW w AS (PARTITION BY vessel_name ORDER BY ts_delta_s ASC)
    QUALIFY row_number() OVER w = 1 AND ts_delta_s < ${within_s};
  `;
  const result = await withConnection(dbconn => dbconn.runAndReadAll(query));
  const features: Feature<Point, Properties>[] = result.getRowObjectsJson()
    .map(row => ({
      id: `wsf:${row.vessel_name as string}`,
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [row.longitude as number, row.latitude as number],
      },
      properties: {
        kind: 'Ferry',
        name: row.vessel_name as string,
        source: 'WSF',
        timestamp: row.timestamp as string,
      }
    }));
    return features;
};

/// Returns the number of inserted rows.
export async function loadLocations(locations: VesselLocation[]) {
  return await withConnection(async (dbconn: DuckDBConnection) => {
    await dbconn.run(`
CREATE TABLE IF NOT EXISTS ferry_locations (
  vessel_id INT NOT NULL,
  "timestamp" timestamptz NOT NULL,
  vessel_name string NOT NULL,
  latitude double NOT NULL,
  longitude double NOT NULL,
  heading integer,
  in_service boolean not null,
  at_dock boolean not null,
);
    `);

    const appender = await dbconn.createAppender('ferry_locations');

    for (const ferry of locations) {
      appender.appendInteger(ferry.VesselID);

      const millis = BigInt(ferry.TimeStamp.slice(6, 19));
      const timestamp = new DuckDBTimestampValue(millis * BigInt(1000));
      appender.appendTimestamp(timestamp);

      appender.appendVarchar(ferry.VesselName);
      appender.appendDouble(ferry.Latitude);
      appender.appendDouble(ferry.Longitude);
      appender.appendInteger(ferry.Heading);
      appender.appendBoolean(ferry.InService);
      appender.appendBoolean(ferry.AtDock);
      appender.endRow();
    }
    appender.close();
    return locations.length;
  });
};
