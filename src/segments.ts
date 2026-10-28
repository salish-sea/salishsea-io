import { distance } from '@turf/distance';
import { circle } from '@turf/circle';
import type { Feature, LineString, Point, Polygon } from 'geojson';
import type { Occurrence } from './types.ts';
import { travelSpeedFor } from './constants.ts';
import { labelForSegment } from './symbology.ts';
import { fromLonLat } from './map-view.ts';

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
 * together. A dead animal is a segment of its own (salish-1y8): a carcass is
 * not part of a travelling group's path, and nothing joins it.
 */
export function occurrences2segments(occurrences: Occurrence[]): Segment[] {
  const segments: Segment[] = [];
  for (const occurrence of occurrences.toSorted((a, b) => a.observed_at_ms - b.observed_at_ms)) {
    let best: Segment | null = null;
    let bestScore = Infinity;
    // A segment with no travel speed takes nothing (joinScore), so a dead one stays alone.
    const dead = occurrence.vitality === 'dead';
    for (const segment of dead ? [] : segments) {
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
        expectedTravelSpeedKmph: dead ? null : travelSpeedFor(occurrence.taxon.scientific_name) || null,
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
/**
 * How a travel segment moved, as its card says it (salish-fwyt.5): the length of the
 * path through its reports, oldest first; how far its last report is from its first;
 * the hours between them; and the direction the last report that gives one says. From
 * where reporters placed the animals, so a zigzag may be partly theirs. Whether it
 * travelled or stayed in one area is not judged here (salish-jdl2).
 */
export interface SegmentMovement {
  pathKm: number;
  netKm: number;
  hours: number;
  lastDirection: Occurrence['direction'];
}

export function segmentMovement(occurrences: readonly Occurrence[]): SegmentMovement {
  const placed = occurrences.filter(o => o.location?.lon != null && o.location?.lat != null);
  let pathKm = 0;
  for (let i = 1; i < placed.length; i++)
    pathKm += distance(coord(placed[i - 1]!), coord(placed[i]!), {units: 'kilometers'});
  const netKm = placed.length > 1 ? distance(coord(placed[0]!), coord(placed[placed.length - 1]!), {units: 'kilometers'}) : 0;
  const first = occurrences[0], last = occurrences[occurrences.length - 1];
  const hours = first && last ? (last.observed_at_ms - first.observed_at_ms) / hour_in_ms : 0;
  const lastDirection = occurrences.findLast(o => o.direction)?.direction ?? null;
  return {pathKm, netKm, hours, lastDirection};
}

export function ecotypesOf({taxon, identifiers}: {taxon: Pick<Occurrence['taxon'], 'scientific_name'>, identifiers: Occurrence['identifiers']}): Set<Ecotype> {
  const out = new Set<Ecotype>();
  const subspecies = taxon.scientific_name?.split(' ')[2];
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
 * The segment's occurrences, each told where it sits in the segment, and the
 * head told what it stands for.
 *
 * Decision 029 puts one label on each segment head and lets it speak for the
 * whole track — "Humpback / Seen 3× over 10h" — so the head needs the track's
 * size, span and pooled identifiers. They are attached here rather than in the
 * map component because this is where a segment is still an object; by the time
 * the map has a flat list of points, recovering which ones belonged together
 * means matching ids back up.
 *
 * The head is the LAST occurrence. That is the most recent position, which is
 * both what a reader wants and the point the old red `isLast` ring already
 * emphasised.
 */
export function placeInSegment(segment: Segment): Occurrence[] {
  const {occurrences} = segment;
  if (occurrences.length === 0)
    throw new Error("Segment had no occurrences");
  const placed: Occurrence[] = occurrences.map(occurrence => ({...occurrence}));
  placed[0]!.isFirst = true;
  const identifiers = new Set(occurrences.flatMap(occurrence => occurrence.identifiers ?? []));
  Object.assign(placed[placed.length - 1]!, {
    isLast: true,
    // Pooled, not read off the head: the pod is usually named in one sighting's
    // prose, and it is rarely the last one.
    segmentIdentity: labelForSegment(occurrences),
    segmentLength: occurrences.length,
    segmentIdentifiers: [...identifiers].sort(),
    segmentSpanHours:
      (occurrences[occurrences.length - 1]!.observed_at_ms - occurrences[0]!.observed_at_ms) / hour_in_ms,
  });
  return placed;
}

export type TravelLineProperties = {
  expectedTravelSpeedKmph: number | null;
  lastOccurrenceAt: number;
};

export function segment2travelLine({occurrences, expectedTravelSpeedKmph, lastOccurrenceAt}: Segment): Feature<LineString, TravelLineProperties> | null {
  if (occurrences.length < 2)
    return null;
  return {
    type: 'Feature',
    id: `line-from-${occurrences[0]!.id}`,
    geometry: {type: 'LineString', coordinates: occurrences.map(coord)},
    properties: {expectedTravelSpeedKmph, lastOccurrenceAt: lastOccurrenceAt.valueOf()},
  };
}

/**
 * An arrow at the middle of each hop of a track, turned to point along it. The
 * angle is measured on the Mercator map, clockwise from east, since that is the
 * way the hop is drawn.
 */
export function travelArrows(line: Feature<LineString>): Feature<Point, {rotation: number}>[] {
  const points = line.geometry.coordinates as [number, number][];
  return points.slice(1).map((end, i) => {
    const start = points[i]!;
    const [x0, y0] = fromLonLat(start);
    const [x1, y1] = fromLonLat(end);
    return {
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]},
      properties: {rotation: -Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI},
    };
  });
}

/**
 * Where a track's animals might be now, and in half an hour, if they kept to
 * their species' usual speed: two rings around the last sighting, fainter the
 * older the guess, each labelled at its top. Nothing for a track whose last
 * sighting is six hours old or more.
 */
export function imputedPositions(line: Feature<LineString, TravelLineProperties>, now: number): Feature<LineString | Point, {opacity: number} | {label: string}>[] {
  const speed = line.properties.expectedTravelSpeedKmph;
  if (!speed)
    return [];
  const ageHours = (now - line.properties.lastOccurrenceAt) / hour_in_ms;
  if (ageHours >= 6)
    return [];
  const last = line.geometry.coordinates[line.geometry.coordinates.length - 1] as [number, number];
  return [ageHours, ageHours + 0.5].flatMap(delayHours => {
    const radiusKm = delayHours * speed;
    const opacity = 3 / (3 + 4 * delayHours * ageHours);
    const ring = circle(last, Math.max(radiusKm, 0.001), {steps: 64, units: 'kilometers'}) as Feature<Polygon>;
    const outline = ring.geometry.coordinates[0]!;
    return [
      {type: 'Feature', geometry: {type: 'LineString', coordinates: outline}, properties: {opacity}},
      {
        type: 'Feature',
        // The ring's northernmost point: turf starts its circle due north.
        geometry: {type: 'Point', coordinates: outline[0]!},
        properties: {label: delayHours === ageHours ? `now at ${speed}km/h` : `in 30min`},
      },
    ];
  });
}

function coord({location: {lat, lon}}: Occurrence): [number, number] {
  return [lon, lat];
}
