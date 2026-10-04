import { distance } from '@turf/distance';
import { LineString, Point } from 'ol/geom.js';
import Feature from 'ol/Feature.js';
import { fromLonLat } from 'ol/proj.js';
import type { Occurrence } from './types.ts';
import { travelSpeedFor } from './constants.ts';
import { occurrence2feature } from './occurrence.ts';
import { labelForSegment } from './symbology.ts';

const hour_in_ms = 60 * 60 * 1000;

export type Segment = {
  expectedTravelSpeedKmph: number | null;
  lastOccurrenceAt: Date;
  occurrences: Occurrence[];
  taxon: Occurrence['taxon'];
}

/**
 * A day's occurrences joined into travel segments (decision 063).
 *
 * Every segment stays open at once. Each occurrence, oldest first, goes to the
 * segment that admits it with the lowest score, or starts a new one. The score
 * is the distance from the segment's latest point plus the distance the species
 * usually travels in the time since, so a segment seen recently beats a
 * slightly nearer one seen hours ago. A report that names an ecotype never
 * joins a segment that names another: residents and Bigg's don't travel
 * together.
 */
export function occurrences2segments(occurrences: Occurrence[]): Segment[] {
  const segments: Segment[] = [];
  for (const occurrence of occurrences.toSorted((a, b) => a.observed_at_ms - b.observed_at_ms)) {
    let best: Segment | null = null;
    let bestScore = Infinity;
    for (const segment of segments) {
      const score = joinScore(segment, occurrence);
      if (score < bestScore) {
        best = segment;
        bestScore = score;
      }
    }
    if (best) {
      best.occurrences.push(occurrence);
      best.lastOccurrenceAt = new Date(occurrence.observed_at_ms);
      best.taxon = occurrence.taxon;
    } else {
      segments.push({
        expectedTravelSpeedKmph: travelSpeedFor(occurrence.taxon.scientific_name) || null,
        lastOccurrenceAt: new Date(occurrence.observed_at_ms),
        occurrences: [occurrence],
        taxon: occurrence.taxon,
      });
    }
  }
  return segments;
}

/**
 * How far `candidate` is from the end of `segment`, in kilometres of distance
 * plus travel time, or Infinity if the segment may not take it: another
 * species, more than 12 hours or 20 km after its latest point, faster than
 * three times the species' speed after a 3 km allowance, or another ecotype.
 */
function joinScore(segment: Segment, candidate: Occurrence): number {
  const start = segment.occurrences[0]!;
  const last = segment.occurrences[segment.occurrences.length - 1]!;
  const speed = segment.expectedTravelSpeedKmph;
  if (!start.taxon.species_id || !speed || start.taxon.species_id !== candidate.taxon.species_id)
    return Infinity;
  const delta_hours = (candidate.observed_at_ms - last.observed_at_ms) / hour_in_ms;
  if (delta_hours > 12)
    return Infinity;
  const delta_meters = distance(coord(candidate), coord(last), {units: 'meters'});
  if (delta_meters > 20000)
    return Infinity;
  // Two occurrences at the same instant give 0/0, which is NaN and so never
  // exceeds the limit: they join.
  const meters_per_hour = Math.max(0, (delta_meters - 3000)) / delta_hours;
  if (meters_per_hour > 3.0 * (speed * 1000))
    return Infinity;
  if (ecotypesConflict(candidate, segment.occurrences))
    return Infinity;
  return delta_meters / 1000 + speed * delta_hours;
}

export type Ecotype = 'resident' | 'biggs';

/**
 * The ecotypes a report names, from its subspecies or from a named pod, ID or
 * ecotype: J, K and L are residents, T is Bigg's. Empty when it names neither.
 * `ater` is residents generally, not Southern Residents (see labelForSegment),
 * which is all the join needs: residents and Bigg's don't travel together.
 */
export function ecotypesOf({taxon, identifiers}: {taxon: Pick<Occurrence['taxon'], 'scientific_name'>, identifiers: Occurrence['identifiers']}): Set<Ecotype> {
  const out = new Set<Ecotype>();
  const subspecies = taxon.scientific_name.split(' ')[2];
  if (subspecies === 'ater') out.add('resident');
  if (subspecies === 'rectipinnus') out.add('biggs');
  for (const id of identifiers ?? []) {
    if (/^[JKL](\d|\s*pod|$)/i.test(id) || /resident/i.test(id)) out.add('resident');
    else if (/^T\d/.test(id) || /bigg/i.test(id)) out.add('biggs');
  }
  return out;
}

/** True when the candidate and the segment each name an ecotype and share none. */
function ecotypesConflict(candidate: Occurrence, occurrences: Occurrence[]): boolean {
  const mine = ecotypesOf(candidate);
  if (mine.size === 0)
    return false;
  const theirs = new Set(occurrences.flatMap(o => [...ecotypesOf(o)]));
  return theirs.size > 0 && ![...mine].some(e => theirs.has(e));
}

/**
 * The segment's points as map features, with the head told what it stands for.
 *
 * Decision 029 puts one label on each segment head and lets it speak for the
 * whole track — "Humpback / Seen 3× over 10h" — so the head needs the track's
 * size, span and pooled identifiers. They are attached here rather than in the
 * map component because this is where a segment is still an object; by the time
 * obs-map has a flat list of features, recovering which ones belonged together
 * means matching ids back up.
 *
 * The head is the LAST occurrence. That is the most recent position, which is
 * both what a reader wants and the point the old red `isLast` ring already
 * emphasised.
 */
export function segment2features(segment: Segment): Feature<Point>[] {
  const {occurrences} = segment;
  if (occurrences.length === 0)
    throw new Error("Segment had no occurrences");
  const features = occurrences.map(occurrence2feature);
  const head = features[features.length - 1]!;
  features[0]!.set('isFirst', true);
  head.set('isLast', true);

  const identifiers = new Set(occurrences.flatMap(occurrence => occurrence.identifiers ?? []));
  head.setProperties({
    // Pooled, not read off the head: the pod is usually named in one sighting's
    // prose, and it is rarely the last one.
    segmentIdentity: labelForSegment(occurrences),
    segmentLength: occurrences.length,
    segmentIdentifiers: [...identifiers].sort(),
    segmentSpanHours:
      (occurrences[occurrences.length - 1]!.observed_at_ms - occurrences[0]!.observed_at_ms) / hour_in_ms,
  });
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

function coord({location: {lat, lon}}: Occurrence) {
  return [lon, lat];
}
