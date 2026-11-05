import { mainPlace } from './place.ts';
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
  /**
   * How many of those name the subject itself: for an animal, rather than a group it is in
   * (T065As for T065A5); for a matriline, rather than a sub-lineage under it (T065As for
   * T065s) or only its members (salish-fwyt.7).
   */
  as_self: number;
  /** On a matriline's encounter, how many of its reports name only members of it (T065A5 for T065s); absent when none do. */
  only_members?: number;
  /** How many of those only possibly name it ("possibly T99s", decision 054); absent when none do. */
  possibly?: number;
  /**
   * The calves first named in it: the subject itself, or a member of the matriline that
   * is the subject, in the first report that names the calf, counted only when the
   * build holds reports of the calf from its birth year (salish-fwyt.4.2). Absent when none.
   */
  firsts?: CalfFirst[];
  /** The identifiers of each report that has any, for chips that count reports (pooledAnimals). */
  identifiers: string[][];
  /** Where its middle report was placed, of those that were; null when none was. */
  location: {lon: number, lat: number} | null;
  /** The water region most of its reports were in (salish-fwyt.2); null when none was in one, absent from a file written before places. */
  place?: string | null;
  /** Its reports' photos, oldest first, each with the page of the report it came with. */
  photos: (Pick<OccurrencePhoto, 'src' | 'thumb' | 'attribution'> & {href: string})[];
  /** How many reports came through each channel, busiest first, as a segment's card names them. */
  channels: [channel: string, reports: number][];
}

/** A calf named for the first time: its designation and the year it was born. */
export interface CalfFirst {
  label: string;
  born: number;
}

/**
 * A report of a subject: which subject, the group it was reached through, if any, the
 * member it was reached through, for a matriline's report that names only members, and
 * whether it only possibly names it.
 */
export interface SubjectReport<K> {
  subject: K;
  via_group: string | null;
  via_member?: string;
  possibly?: boolean;
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
  firstsOf: (occurrenceId: string) => readonly (CalfFirst & {subjects: readonly K[]})[] = () => [],
): [K, Encounter][] {
  const out: [K, Encounter][] = [];
  const occurrences = rows.map(r => ({...r, observed_at_ms: Date.parse(r.observed_at)}) as Occurrence);
  for (const {occurrences: reports} of occurrences2segments(occurrences)) {
    const bySubject = new Map<K, {ids: string[], as_self: number, only_members?: number, possibly?: number}>();
    for (const r of reports) for (const {subject, via_group, via_member, possibly} of reportsOf(r.id)) {
      const mine = bySubject.get(subject) ?? bySubject.set(subject, {ids: [], as_self: 0}).get(subject)!;
      mine.ids.push(r.id);
      if (via_member) mine.only_members = (mine.only_members ?? 0) + 1;
      else if (!via_group) mine.as_self++;
      if (possibly) mine.possibly = (mine.possibly ?? 0) + 1;
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
      place: mainPlace(reports),
      photos: reports.flatMap(r => (r.photos ?? []).map(({src, thumb, attribution}) =>
        ({src, thumb, attribution, href: r.url || src}))),
      // Ties by name, so the same day always writes the same bytes.
      channels: [...channels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    };
    for (const [subject, mine] of bySubject) {
      // A calf first named anywhere on the track, for the calf and its matrilines.
      const firsts = reports.flatMap(r => firstsOf(r.id).filter(f => f.subjects.includes(subject)))
        .map(({label, born}) => ({label, born}));
      out.push([subject, {...shared, ...mine, ...(firsts.length ? {firsts} : {})}]);
    }
  }
  return out;
}
