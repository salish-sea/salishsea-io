import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { point as turfPoint } from '@turf/helpers';
import { distance } from '@turf/distance';
import { bearing as getBearing } from "@turf/bearing";

const hour = 60 * 60;

export type TravelLineProperties = {
  bearing: number;
  kind: 'TravelLine';
}

export function imputeTravelLines(observations: Feature<Point, {timestamp: number, species: string}>[]) {
  const sorted = observations.toSorted((a, b) => b.properties.timestamp - a.properties.timestamp);
  const lines: Feature<LineString, TravelLineProperties>[] = [];
  for (const obs of sorted) {
    const fromPoint = turfPoint(obs.geometry.coordinates)
    const fromObservedAt = obs.properties.timestamp;
    for (const candidate of observations) {
      if (obs.properties.species !== candidate.properties.species)
        continue;

      const timeDelta = candidate.properties.timestamp - fromObservedAt;
      if (timeDelta <= 0)
        continue;

      if (timeDelta > 12 * hour)
        continue;

      const toPoint = turfPoint(candidate.geometry.coordinates);
      const displacementMeters = distance(fromPoint, toPoint, {units: 'meters'});
      if (displacementMeters > 10000)
        continue;

      const metersPerHour = displacementMeters / (timeDelta / hour);
      if (metersPerHour > 10000)
        continue;

      const feature: Feature<LineString, TravelLineProperties> = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [obs.geometry.coordinates, candidate.geometry.coordinates],
        },
        properties: {
          bearing: Math.round(getBearing(fromPoint, toPoint)),
          kind: 'TravelLine',
        },
      };
      lines.push(feature);
    }
  }
  return lines;
}
