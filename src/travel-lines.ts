import { distance } from '@turf/distance';
import { LineString, type Point } from 'ol/geom.js';
import Feature from 'ol/Feature.js';
import { fromLonLat, toLonLat } from 'ol/proj.js';
import type { Occurrence } from './supabase.ts';
import type { Merge } from 'type-fest';
import { travelSpeedKmH } from './constants.ts';

const hour_in_ms = 60 * 60 * 1000;

type Candidate = Merge<GeoJSON.Feature<GeoJSON.Point, {
  epoch_ms: number;
  scientific_name: string;
  species_id: number;
}>, {id: Occurrence['id']}>;

// Precondition: occurrences are in chronological order.
export function imputeTravelLines(occurrences: Feature<Point>[]) {
  const candidates: Candidate[] = occurrences
    .flatMap(occurrence => {
      const taxon = occurrence.get('taxon') as Occurrence['taxon'];
      if (!taxon.species_id) return [];
      return [{
        type: 'Feature' as const,
        id: occurrence.getId() as Occurrence['id'],
        geometry: {type: 'Point' as const, coordinates: toLonLat(occurrence.getGeometry()!.getCoordinates()!)},
        properties: {
          epoch_ms: Date.parse(occurrence.get('observed_at')),
          species_id: taxon.species_id,
          scientific_name: taxon.scientific_name,
        },
      }];
    });
  const placed: Set<Occurrence['id']> = new Set();
  const lines: Feature<LineString>[] = [];
  for (const [idx, occurrence] of candidates.entries()) {
    if (placed.has(occurrence.id))
      continue;
    const points = imputeLineFrom(occurrence, candidates.slice(idx + 1).filter(candidate => !placed.has(candidate.id)));
    for (const point of points)
      placed.add(point.id);
    const feature = new Feature(new LineString(points.map(point => fromLonLat(point.geometry.coordinates))));
    feature.setId(`line-from-${occurrence.id}`);
    const lastPoint = points[points.length - 1]!;
    const meanTravelSpeed = travelSpeedKmH[occurrence.properties.scientific_name];
    if (meanTravelSpeed) {
      feature.set('last_epoch_ms', lastPoint.properties.epoch_ms);
      feature.set('mean_travel_speed', meanTravelSpeed);
    }
    lines.push(feature);
  }
  return lines;
}

// Precondition: candidates all occur after start.
function imputeLineFrom(start: Candidate, candidates: Candidate[]) {
  const points = [start];
  let last_point = start;
  for (const candidate of candidates) {
    if (start.properties.species_id !== candidate.properties.species_id)
      continue;
    const delta_ms = candidate.properties.epoch_ms - last_point.properties.epoch_ms;
    if (delta_ms > 12 * hour_in_ms)
      continue;
    if (delta_ms < 0)
      throw new Error("Input occurrences out of order when imputing travel lines");
    const delta_meters = distance(candidate, last_point, {units: 'meters'});
    if (delta_meters > 20000)
      continue;
    const meters_per_hour = Math.max(0, (delta_meters - 3000)) / (delta_ms / hour_in_ms);
    if (meters_per_hour > 10000)
      continue;
    points.push(candidate);
    last_point = candidate;
  }
  return points;
}
