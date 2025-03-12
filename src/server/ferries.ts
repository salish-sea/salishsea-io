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

type Properties = {
  kind: 'Ferry';
  name: string;
  source: 'WSF';
  timestamp: Temporal.Instant;
};

const accessCode = process.env.WSF_ACCESS_CODE;

export const fetchCurrentLocations = async () => {
  const url = `https://wsdot.wa.gov/ferries/api/vessels/rest/vessellocations?apiaccesscode=${accessCode}`;
  const response = await fetch(url);
  const data = await response.json();
  return data as VesselLocationResponse;
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
