import type { Feature, Point } from "geojson";
import {Temporal} from "temporal-polyfill";

type VesselLocation = {
  VesselID: number;
  VesselName: string;
  Latitude: number;
  Longitude: number;
  Heading: number;
  InService: boolean;
  AtDock: boolean;
  TimeStamp: string;
}

type VesselLocationResponse = VesselLocation[];

type InvalidRequestResponse = {
  Message?: string;
};

export type Properties = {
  kind: 'Ferry';
  name: string;
  source: 'WSF';
  timestamp: Temporal.Instant;
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
  const response = await fetch(url);
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
  const vessels = data.filter(vessel => vessel.InService && !vessel.AtDock);
  return vessels;
}

export const location2geojson = (location: VesselLocation) => {
  const feature: Feature<Point, Properties> = {
    id: `wdf:${location.VesselName}`,
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [location.Longitude, location.Latitude],
    },
    properties: {
      kind: 'Ferry',
      name: location.VesselName,
      source: 'WSF',
      timestamp: Temporal.Instant.fromEpochMilliseconds(parseInt(location.TimeStamp.slice(6, 19), 10)),
    },
  }
  return feature;
}
