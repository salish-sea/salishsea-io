import type { Feature, Point } from "geojson";
import {Temporal} from "temporal-polyfill";
import { db } from "./database.ts";

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

export type FerryLocationProperties = {
  kind: 'Ferry';
  name: string;
  source: 'WSF';
  timestamp: number; // UNIX time
};

type FerryLocationRow = {
  vessel_id: number;
  timestamp: number;
  vessel_name: string;
  longitude: number;
  latitude: number;
  heading: number | null;
  in_service: number;
  at_dock: number;
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

const locationsAsOfQuery = db.prepare<{as_of: number; within_s: number}, FerryLocationRow>(`
SELECT * FROM (
  SELECT *, row_number() OVER w AS rank
  FROM ferry_locations
  WHERE in_service AND NOT at_dock AND "timestamp" BETWEEN @as_of - @within_s AND @as_of + @within_s
  WINDOW w AS (PARTITION BY vessel_name ORDER BY abs("timestamp" - @as_of) ASC)
) v WHERE rank = 1
`);
// Load the most current location of each ferry, if any, within `within_s` seconds of `asof`.
export const locationsAsOf = (as_of: Temporal.Instant, within_s: number = 90) => {
  const locations = locationsAsOfQuery.all({as_of: as_of.epochSeconds, within_s});
  const features: Feature<Point, FerryLocationProperties>[] = locations.map(row => ({
    id: `wsf:${row.vessel_name}`,
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [row.longitude, row.latitude],
    },
    properties: {
      kind: 'Ferry',
      name: row.vessel_name,
      source: 'WSF',
      timestamp: row.timestamp,
    }
  }));
  return features;
};

const loadLocationStatement = db.prepare<FerryLocationRow>(`
INSERT INTO ferry_locations
( vessel_id,  timestamp,  vessel_name,  longitude,  latitude,  heading,  in_service,  at_dock)
VALUES
(@vessel_id, @timestamp, @vessel_name, @longitude, @latitude, @heading, @in_service, @at_dock);
`);
/// Returns the number of inserted rows.
export function loadLocations(locations: VesselLocation[]) {
  for (const location of locations) {
    const timestamp = parseInt(location.TimeStamp.slice(6, 16), 10);
    loadLocationStatement.run({
      vessel_id: location.VesselID,
      timestamp,
      vessel_name: location.VesselName,
      longitude: location.Longitude,
      latitude: location.Latitude,
      heading: location.Heading,
      in_service: location.InService ? 1 : 0,
      at_dock: location.AtDock ? 1 : 0,
    });
  }
};
