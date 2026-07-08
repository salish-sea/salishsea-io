import { supabase } from './supabase.ts';
import { Temporal } from 'temporal-polyfill';
import type { Database } from '../database.types.ts';

type PublicSchema = Database['public'];
export type Individual = PublicSchema['Tables']['individuals']['Row'];
export type SocialGroup = PublicSchema['Tables']['social_groups']['Row'];
export type IndividualOccurrence = PublicSchema['Views']['individual_occurrences']['Row'];
export type EcotypeOccurrence = PublicSchema['Views']['ecotype_occurrences']['Row'];

// One (occurrence, individual) link from the individual_occurrences view, with
// the fields the profile page needs guaranteed present.
export interface OccurrenceLink {
  occurrence_id: string;
  observed_at: string;
  location: { lon: number; lat: number } | null;
  is_present: boolean;
  status: PublicSchema['Enums']['identification_status'];
  via_group: string | null;
}

export function observedDate(observedAt: string): Temporal.PlainDate {
  return Temporal.Instant.from(observedAt).toZonedDateTimeISO('PST8PDT').toPlainDate();
}

// The main map, opened on the link's day and focused on its occurrence.
export function mapUrl(link: Pick<OccurrenceLink, 'observed_at' | 'occurrence_id'>): string {
  return `/?d=${observedDate(link.observed_at).toString()}&o=${encodeURIComponent(link.occurrence_id)}`;
}

export function individualPath(designation: string): string {
  return `/individuals/${encodeURIComponent(designation)}`;
}

export function matrilinePath(designation: string): string {
  return `/matrilines/${encodeURIComponent(designation)}`;
}

export function ecotypePath(designation: string): string {
  return `/ecotypes/${encodeURIComponent(designation)}`;
}

function parseProfilePath(pathname: string, re: RegExp): string | null {
  const match = pathname.match(re);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

// Extract the designation from an /individuals/<designation> path.
export function parseIndividualPath(pathname: string): string | null {
  return parseProfilePath(pathname, /^\/individuals\/([^/]+)\/?$/);
}

// Extract the designation from a /matrilines/<designation> path.
export function parseMatrilinePath(pathname: string): string | null {
  return parseProfilePath(pathname, /^\/matrilines\/([^/]+)\/?$/);
}

// Extract the designation from an /ecotypes/<designation> path.
export function parseEcotypePath(pathname: string): string | null {
  return parseProfilePath(pathname, /^\/ecotypes\/([^/]+)\/?$/);
}

// TS port of public.normalize_designation (20260707220211_identifications.sql):
// map an un-padded sighting code ('T65A5') to the padded catalog key ('T065A5').
// Pad only the first numeric block of T-codes; uppercase; pass others through.
// .slice(0, 3) mirrors SQL lpad()'s truncation for hypothetical 4+-digit blocks.
export function normalizeDesignation(code: string): string {
  const u = code.trim().toUpperCase();
  const m = u.match(/^T(\d+)(.*)$/);
  if (!m) return u;
  return 'T' + m[1]!.padStart(3, '0').slice(0, 3) + m[2]!;
}

// The shared shape of individual_occurrences and group_occurrences rows;
// group rows carry no via_group (a group claim is always direct).
type OccurrenceRow =
  Pick<IndividualOccurrence, 'occurrence_id' | 'observed_at' | 'location' | 'is_present' | 'status'>
  & { via_group?: string | null };

// Collapse view rows to at most one link per occurrence, preferring a direct
// claim over a via-group inference, and dropping absence claims and rejected
// identifications — the page lists where the animal was reported, not where a
// curator ruled it out.
export function dedupeOccurrenceLinks(rows: OccurrenceRow[]): OccurrenceLink[] {
  const byOccurrence = new Map<string, OccurrenceLink>();
  for (const row of rows) {
    const { occurrence_id, observed_at, location, is_present, status, via_group } = row;
    if (!occurrence_id || !observed_at || !status) continue;
    if (is_present === false || status === 'rejected') continue;
    const existing = byOccurrence.get(occurrence_id);
    if (existing && !(existing.via_group && !via_group)) continue;
    byOccurrence.set(occurrence_id, {
      occurrence_id,
      observed_at,
      location: location?.lon != null && location.lat != null
        ? { lon: location.lon, lat: location.lat }
        : null,
      is_present: is_present ?? true,
      status,
      via_group: via_group ?? null,
    });
  }
  return [...byOccurrence.values()]
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
}

export interface PresenceYear {
  year: number;
  months: number[]; // 12 counts, January first
}

// Distinct-occurrence counts per calendar month (PST8PDT, like the rest of the
// app) for the trailing `years` years ending at `currentYear`, newest first.
export function monthlyPresence(links: OccurrenceLink[], years: number, currentYear: number): PresenceYear[] {
  const grid = new Map<number, number[]>();
  for (let y = currentYear; y > currentYear - years; y--)
    grid.set(y, new Array<number>(12).fill(0));
  for (const link of links) {
    const zoned = Temporal.Instant.from(link.observed_at).toZonedDateTimeISO('PST8PDT');
    const months = grid.get(zoned.year);
    if (months)
      months[zoned.month - 1]! += 1;
  }
  return [...grid.entries()].map(([year, months]) => ({ year, months }));
}

// Walk a group's ancestry (matriline -> parent matriline -> ... -> ecotype).
// Returns the chain starting at the group itself; guards against cycles.
export function groupChain(groupId: number, groupsById: Map<number, SocialGroup>): SocialGroup[] {
  const chain: SocialGroup[] = [];
  const seen = new Set<number>();
  for (let id: number | null = groupId; id !== null && !seen.has(id);) {
    seen.add(id);
    const group = groupsById.get(id);
    if (!group) break;
    chain.push(group);
    id = group.parent_group_id;
  }
  return chain;
}

// mother/father are fetched separately (fetchParents): the self-referencing FK
// makes PostgREST embed direction ambiguous, and supabase-js's type parser and
// the server disagree on the disambiguation syntax.
const INDIVIDUAL_SELECT = `
  *,
  designations (code, scheme, is_primary, status, in_catalog, authority:parties (name, url)),
  nicknames (name, theme, status, named_year, namer:parties (name, url)),
  memberships:group_memberships!individual_id (
    is_current, joined_year, left_year, basis,
    group:social_groups (id, kind, designation, parent_group_id, anchor_individual_id, notes)
  )
` as const;

export async function fetchIndividual(designation: string) {
  const { data } = await supabase()
    .from('individuals')
    .select(INDIVIDUAL_SELECT)
    .eq('primary_designation', designation)
    .maybeSingle()
    .throwOnError();
  return data;
}
export type IndividualProfile = NonNullable<Awaited<ReturnType<typeof fetchIndividual>>>;

export async function fetchParents({ mother_id, father_id }: Pick<Individual, 'mother_id' | 'father_id'>) {
  const ids = [mother_id, father_id].filter((id): id is number => id !== null);
  if (!ids.length) return { mother: null, father: null };
  const { data } = await supabase()
    .from('individuals')
    .select('id, primary_designation, life_status, nicknames (name, status)')
    .in('id', ids)
    .throwOnError();
  return {
    mother: data.find(i => i.id === mother_id) ?? null,
    father: data.find(i => i.id === father_id) ?? null,
  };
}
export type Parent = NonNullable<Awaited<ReturnType<typeof fetchParents>>['mother']>;

export async function fetchOffspring(individualId: number) {
  const { data } = await supabase()
    .from('individuals')
    .select('id, primary_designation, sex, born_earliest, born_latest, life_status, nicknames (name, status)')
    .or(`mother_id.eq.${individualId},father_id.eq.${individualId}`)
    .order('born_earliest', { ascending: true, nullsFirst: true })
    .throwOnError();
  return data;
}
export type Offspring = Awaited<ReturnType<typeof fetchOffspring>>[number];

// The whole catalog's group graph is a few hundred small rows — fetch it once
// and resolve pod/ecotype chains client-side instead of walking FKs per hop.
export async function fetchAllGroups(): Promise<Map<number, SocialGroup>> {
  const { data } = await supabase()
    .from('social_groups')
    .select()
    .throwOnError();
  return new Map(data.map(group => [group.id, group]));
}

export async function fetchGroupMembers(groupId: number) {
  const { data } = await supabase()
    .from('group_memberships')
    .select('is_current, joined_year, left_year, individual:individuals (id, primary_designation, sex, born_earliest, life_status, nicknames (name, status))')
    .eq('group_id', groupId)
    .throwOnError();
  return data;
}
export type GroupMember = Awaited<ReturnType<typeof fetchGroupMembers>>[number];

export async function fetchOccurrenceLinks(individualId: number): Promise<OccurrenceLink[]> {
  const { data } = await supabase()
    .from('individual_occurrences')
    .select()
    .eq('individual_id', individualId)
    .throwOnError();
  return dedupeOccurrenceLinks(data);
}

// The !anchor_individual_id hint disambiguates the embed: social_groups
// reaches individuals both through the anchor FK and through
// group_memberships. Nickname facts only — story is access-restricted (D-21).
const MATRILINE_SELECT = `
  *,
  nicknames (name, theme, status, named_year, namer:parties (name, url)),
  anchor:individuals!anchor_individual_id (id, primary_designation, life_status, nicknames (name, status))
` as const;

export async function fetchMatriline(designation: string) {
  const { data } = await supabase()
    .from('social_groups')
    .select(MATRILINE_SELECT)
    .eq('designation', designation)
    .eq('kind', 'matriline')
    .maybeSingle()
    .throwOnError();
  return data;
}
export type MatrilineProfile = NonNullable<Awaited<ReturnType<typeof fetchMatriline>>>;

export async function fetchGroupOccurrenceLinks(groupId: number): Promise<OccurrenceLink[]> {
  const { data } = await supabase()
    .from('group_occurrences')
    .select()
    .eq('social_group_id', groupId)
    .throwOnError();
  return dedupeOccurrenceLinks(data);
}

// An ecotype has no anchor individual and no group nicknames today, but the
// select mirrors the matriline shape so the masthead can grow. Facts only (D-21).
const ECOTYPE_SELECT = `
  *,
  nicknames (name, theme, status, named_year, namer:parties (name, url))
` as const;

export async function fetchEcotype(designation: string) {
  const { data } = await supabase()
    .from('social_groups')
    .select(ECOTYPE_SELECT)
    .eq('designation', designation)
    .eq('kind', 'ecotype')
    .maybeSingle()
    .throwOnError();
  return data;
}
export type EcotypeProfile = NonNullable<Awaited<ReturnType<typeof fetchEcotype>>>;

// The ecotype's sighting record is the union of every descendant's reports
// (see docs/decisions/017); one filter on ecotype_id, deduped per occurrence.
// Paginated: an ecotype aggregates thousands of reports and PostgREST caps a
// single response at max_rows (1000), which would silently truncate the map and
// the "N reports in all" count.
export async function fetchEcotypeOccurrenceLinks(ecotypeId: number): Promise<OccurrenceLink[]> {
  const PAGE = 1000;
  const rows: EcotypeOccurrence[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase()
      .from('ecotype_occurrences')
      .select()
      .eq('ecotype_id', ecotypeId)
      .order('occurrence_id', { ascending: true }) // stable paging order
      .range(from, from + PAGE - 1)
      .throwOnError();
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return dedupeOccurrenceLinks(rows);
}

// The matrilines that descend from an ecotype, sorted A–Z — for the ecotype
// page's directory. Tree-scoped (via groupChain), so a future second ecotype
// only lists its own matrilines.
export function descendantMatrilines(ecotypeId: number, groupsById: Map<number, SocialGroup>): SocialGroup[] {
  return [...groupsById.values()]
    .filter(g => g.kind === 'matriline' && groupChain(g.id, groupsById).some(a => a.id === ecotypeId))
    .sort((a, b) => a.designation.localeCompare(b.designation));
}

// The official nickname if there is one, else the first non-deprecated one.
export function displayName(nicknames: { name: string; status: string | null }[]): string | null {
  const official = nicknames.find(n => n.status === 'official');
  if (official) return official.name;
  const usable = nicknames.find(n => n.status !== 'deprecated');
  return usable?.name ?? null;
}
