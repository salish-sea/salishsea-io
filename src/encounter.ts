import { occurrences2segments } from './segments.ts';
import type { Occurrence, OccurrencePhoto, SegmentPlacement } from './types.ts';

/**
 * One of a day's travel segments that holds at least one report of a subject, summarized
 * for the subject's timeline (decision 098). The read-path build writes a subject's
 * encounters beside its page data (scripts/read-path/encounters.ts), since an encounter
 * needs every report of its day, not only the subject's. A row of the timeline opens to
 * the encounter's own card, which finds the segment again in the day's file by `ids`.
 */
export interface Encounter {
  /** The Pacific day, as the day files are named. */
  day: string;
  /** When its first and its last report were made. */
  start: string;
  end: string;
  /** How many reports the segment holds, the subject's and any others on the same track. */
  reports: number;
  /** The subject's reports in it, oldest first. */
  ids: string[];
  /** How many of those name the subject itself, rather than a group it is in (T065As for T065A5). */
  as_self: number;
  /** The identifiers of each report that has any, for chips that count reports (pooledAnimals). */
  identifiers: string[][];
  /** Where its middle report was placed, of those that were; null when none was. */
  location: {lon: number, lat: number} | null;
  /** Its reports' photos, oldest first, each with the page of the report it came with. */
  photos: (Pick<OccurrencePhoto, 'src' | 'thumb' | 'attribution'> & {href: string})[];
  /** How many reports came through each channel, busiest first, as a segment's card names them. */
  channels: [channel: string, reports: number][];
}

/** A report of a subject: which subject, and the group it was reached through, if any. */
export interface SubjectReport<K> {
  subject: K;
  via_group: string | null;
}

/** What a day's file holds of an occurrence, before the map adds its own fields. */
export type DayOccurrence = Omit<Occurrence, 'observed_at_ms' | keyof SegmentPlacement>;

/** The channel a report came through, as a segment's card names it: our own sightings are "SalishSea.io", as a card says of them, not "SalishSea.io Direct". */
export function channelOf(r: Pick<Occurrence, 'provider_slug' | 'collection' | 'provider'>): string {
  return r.provider_slug === 'direct' ? 'SalishSea.io' : r.collection || r.provider || 'another source';
}

/**
 * A day's encounters for every subject its reports name: the day joined into travel
 * segments as the map joins it (src/segments.ts, decision 063), and each segment that
 * holds a report of a subject summarized for that subject. `reportsOf` says which
 * subjects an occurrence is a report of.
 */
export function dayEncounters<K>(
  day: string,
  rows: readonly DayOccurrence[],
  reportsOf: (occurrenceId: string) => readonly SubjectReport<K>[],
): [K, Encounter][] {
  const out: [K, Encounter][] = [];
  const occurrences = rows.map(r => ({...r, observed_at_ms: Date.parse(r.observed_at)}) as Occurrence);
  for (const {occurrences: reports} of occurrences2segments(occurrences)) {
    const bySubject = new Map<K, {ids: string[], as_self: number}>();
    for (const r of reports) for (const {subject, via_group} of reportsOf(r.id)) {
      const mine = bySubject.get(subject) ?? bySubject.set(subject, {ids: [], as_self: 0}).get(subject)!;
      mine.ids.push(r.id);
      if (!via_group) mine.as_self++;
    }
    if (!bySubject.size) continue;
    const placed = reports.filter(r => r.location?.lon != null && r.location?.lat != null);
    const middle = placed[Math.floor(placed.length / 2)];
    const channels = new Map<string, number>();
    for (const r of reports) channels.set(channelOf(r), (channels.get(channelOf(r)) ?? 0) + 1);
    const shared = {
      day,
      start: reports[0]!.observed_at,
      end: reports[reports.length - 1]!.observed_at,
      reports: reports.length,
      identifiers: reports.flatMap(r => r.identifiers?.length ? [r.identifiers] : []),
      location: middle ? {lon: middle.location.lon, lat: middle.location.lat} : null,
      photos: reports.flatMap(r => (r.photos ?? []).map(({src, thumb, attribution}) =>
        ({src, thumb, attribution, href: r.url || src}))),
      // Ties by name, so the same day always writes the same bytes.
      channels: [...channels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    };
    for (const [subject, mine] of bySubject) out.push([subject, {...shared, ...mine}]);
  }
  return out;
}
