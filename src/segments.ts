import { distance } from '@turf/distance';
import { LineString, Point } from 'ol/geom.js';
import Feature from 'ol/Feature.js';
import { fromLonLat } from 'ol/proj.js';
import type { Occurrence } from './supabase.ts';
import { travelSpeedKmH } from './constants.ts';
import { occurrence2feature } from './occurrence.ts';

const hour_in_ms = 60 * 60 * 1000;

export type Segment = {
  expectedTravelSpeedKmph: number | null;
  lastOccurrenceAt: Date;
  occurrences: Occurrence[];
  taxon: Occurrence['taxon'];
}

export function occurrences2segments(occurrences: Occurrence[]) {
  const placed: Set<Occurrence['id']> = new Set();
  const segments: Segment[] = [];
  const sorted = occurrences.toSorted((a, b) => a.observed_at_ms - b.observed_at_ms);
  for (const [idx, occurrence] of sorted.entries()) {
    if (placed.has(occurrence.id))
      continue;
    const segment = imputeSegmentFrom(occurrence, sorted.slice(idx + 1).filter(candidate => !placed.has(candidate.id)));
    for (const point of segment.occurrences)
      placed.add(point.id);
    segments.push(segment);
  }
  return segments;
}

export function segment2features(segment: Segment): Feature<Point>[] {
  if (segment.occurrences.length === 0)
    throw new Error("Segment had no occurrences");
  const features = segment.occurrences.map(occurrence2feature);
  features[0]!.set('isFirst', true);
  features[features.length - 1]!.set('isLast', true);
  return features;
}

export function segment2travelLine({occurrences, ...segment}: Segment): Feature<LineString> | null {
  if (occurrences.length < 2)
    return null;
  const feature = new Feature(new LineString(occurrences.map(occurrence => fromLonLat(coord(occurrence)))));
  const firstPoint = occurrences[0]!;
  feature.setId(`line-from-${firstPoint.id}`);
  feature.setProperties(segment);
  return feature;
}

// Precondition: candidates all occur after start.
function imputeSegmentFrom(start: Occurrence, candidates: Occurrence[]): Segment {
  const occurrences = [start];
  const meanTravelSpeed = travelSpeedKmH[start.taxon.scientific_name];
  let last_point = start;
  if (start.taxon.species_id && meanTravelSpeed) {
    for (const candidate of candidates) {
      if (start.taxon.species_id !== candidate.taxon.species_id)
        continue;
      const delta_ms = candidate.observed_at_ms - last_point.observed_at_ms;
      if (delta_ms > 12 * hour_in_ms)
        continue;
      if (delta_ms < 0)
        throw new Error("Input occurrences out of order when imputing travel lines");
      const delta_meters = distance(coord(candidate), coord(last_point), {units: 'meters'});
      if (delta_meters > 20000)
        continue;
      const meters_per_hour = Math.max(0, (delta_meters - 3000)) / (delta_ms / hour_in_ms);
      if (meters_per_hour > 1.5 * (meanTravelSpeed * 1000))
        continue;
      occurrences.push(candidate);
      last_point = candidate;
    }
  }
  return {
    expectedTravelSpeedKmph: meanTravelSpeed || null,
    lastOccurrenceAt: new Date(last_point.observed_at_ms),
    occurrences,
    taxon: last_point.taxon,
  };
}

function coord({location: {lat, lon}}: Occurrence) {
  return [lon, lat];
}
