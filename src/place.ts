import type { Occurrence } from './types.ts';

/**
 * Where reports were, by the water regions the read-path build names them with
 * (`place`, salish-fwyt.2): one of the basemap's regions, named as a card says it ("Haro
 * Strait", "Mud Bay (Lopez Sound)", "off Vancouver Island"), so a name stands alone, with
 * no "in" before it. A report has none on land beyond the shore, in fresh water, outside
 * the map's range, or before the build has seen it (a sighting just saved).
 */
type Placed = Pick<Occurrence, 'place'>;

/** The place most of the reports were in, ties going to the earliest; null when none has one. */
export function mainPlace(reports: readonly Placed[]): string | null {
  const counts = new Map<string, number>();
  for (const {place} of reports) if (place) counts.set(place, (counts.get(place) ?? 0) + 1);
  let best: string | null = null;
  // a Map keeps the order names were first seen in, so the earliest wins a tie
  for (const [place, n] of counts) if (best === null || n > counts.get(best)!) best = place;
  return best;
}

/** Where reports in travel order began and ended: "Haro Strait", or "Haro Strait to Boundary Pass". */
export function placeSpan(reports: readonly Placed[]): string | null {
  const placed = reports.filter(r => r.place);
  const first = placed[0]?.place, last = placed[placed.length - 1]?.place;
  if (!first || !last) return null;
  return first === last ? first : `${first} to ${last}`;
}
