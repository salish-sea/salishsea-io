import { supabase } from './supabase.ts';
import { Temporal } from 'temporal-polyfill';
import type { Database } from '../database.types.ts';

type PublicSchema = Database['public'];
export type Individual = PublicSchema['Tables']['individuals']['Row'];
export type SocialGroup = PublicSchema['Tables']['social_groups']['Row'];
export type IndividualOccurrence = PublicSchema['Views']['individual_occurrences']['Row'];

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

// ---- Profile paths (decision 034) -------------------------------------------
//
// A profile URL keys on the register identifier; the designation rides along
// as a slug that is composed here and ignored on read:
//
//   /individuals/0010193/T065A     canonical — only 0010193 is read
//   /individuals/0010193           bare identifier; the page rewrites the address
//   /individuals/T065A, /T046A     a designation: legacy links and typed URLs
//
// The edge handler (infra/lib/edge-handler) 301s the non-canonical shapes
// before the page loads; the page handles them too, because the edge fails
// open to the shell when its lookup is slow. These helpers mirror the ones in
// the handler, which cannot import from src/ — change one, change the other.
//
// A matriline's slug is the group's written form, T065As, not the matriarch's
// code that social_groups.designation holds: /matrilines/0002163/T065As. It is
// how sighting prose writes the group, and 034's own example.

// What a profile path names.
export type ProfileKey =
  | { kind: 'entity'; entityId: string; slug: string | null }
  | { kind: 'designation'; designation: string };

// The local part of a register identifier (SSA:0010193 → 0010193): animals
// ADR-0021's registered pattern.
const ENTITY_LOCAL_PART_RE = /^\d{7}$/;

// The designation as a URL segment: apostrophes dropped (Bigg's → Biggs), any
// other run of non-alphanumerics collapsed to a hyphen.
export function slugify(designation: string): string {
  return designation.replace(/['’]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// A row with no register identifier is addressed by its designation, as before.
function profilePath(prefix: string, entityId: string | null, designation: string): string {
  if (!entityId) return `/${prefix}/${encodeURIComponent(designation)}`;
  const slug = slugify(designation);
  return `/${prefix}/${entityId.replace(/^SSA:/, '')}${slug ? `/${slug}` : ''}`;
}

export function individualPath(individual: { entity_id: string | null; primary_designation: string }): string {
  return profilePath('individuals', individual.entity_id, individual.primary_designation);
}

export function matrilinePath(group: { entity_id: string | null; designation: string }): string {
  if (!group.entity_id) return `/matrilines/${encodeURIComponent(group.designation)}`;
  return profilePath('matrilines', group.entity_id, `${group.designation}s`);
}

export function ecotypePath(group: { entity_id: string | null; designation: string }): string {
  return profilePath('ecotypes', group.entity_id, group.designation);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

// /<prefix>/<segment>[/<segment>][/]. Two segments name an identifier and its
// slug; a designation stands alone, so /individuals/T065A/photos is nothing.
function parseKeyedPath(pathname: string, prefix: string): ProfileKey | null {
  const match = pathname.match(new RegExp(`^/${prefix}/([^/]+)(?:/([^/]*))?/?$`));
  if (!match) return null;
  const first = decodeSegment(match[1]!);
  if (first === null) return null;
  // A trailing slash leaves an empty second segment; it means nothing. A
  // present one that will not decode is a malformed path, not a missing slug.
  const second = match[2] ? decodeSegment(match[2]) : null;
  if (match[2] && second === null) return null;
  if (ENTITY_LOCAL_PART_RE.test(first)) {
    return { kind: 'entity', entityId: `SSA:${first}`, slug: second || null };
  }
  return second ? null : { kind: 'designation', designation: first };
}

export function parseIndividualPath(pathname: string): ProfileKey | null {
  return parseKeyedPath(pathname, 'individuals');
}

export function parseEcotypePath(pathname: string): ProfileKey | null {
  return parseKeyedPath(pathname, 'ecotypes');
}

export function parseMatrilinePath(pathname: string): ProfileKey | null {
  return parseKeyedPath(pathname, 'matrilines');
}

// What to call the subject before it has loaded, or when it never does.
export function keyLabel(key: ProfileKey): string {
  return key.kind === 'entity' ? key.entityId : key.designation;
}

// A LIKE pattern matching exactly `value`, so `ilike` gives case-insensitive
// equality and nothing more. Postgres's wildcards are % and _, PostgREST adds *
// as an alias for %, and the default escape character is the backslash.
function ilikeLiteral(value: string): string {
  return value.replace(/[\\%_*]/g, '\\$&');
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
export function monthlyPresence(links: Pick<OccurrenceLink, 'observed_at'>[], years: number, currentYear: number): PresenceYear[] {
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
/**
 * What the register calls an animal (decision 033, migration 20260922010000).
 *
 * `common_name` is what it calls THIS entity — an ecotype's "Bigg's killer whale", an
 * individual's nickname. `taxon_common_name` is what it calls the taxon the entity belongs
 * to, "Killer whale" for anything under Orcinus orca however deep. A caller usually wants
 * the most specific of the two it can prove, which is a composition and therefore ours
 * (animals ADR-0011); the register supplies the strings and we choose between them.
 */
export type AnimalName = {
  entity_id: string;
  common_name: string | null;
  taxon_entity_id: string | null;
  taxon_common_name: string | null;
  /**
   * The scientific name public.occurrences shows for this entity — for a caller drawing
   * something that has not been saved yet and must look as it will once it is.
   */
  inaturalist_scientific_name: string | null;
};

/**
 * Names for specific entities, keyed by `SSA:` identifier.
 *
 * Asks for the handful the caller can name rather than fetching the register: 426 of 786
 * entities carry a common name, most of them individuals' nicknames that a profile page
 * already has by other means. Returns an empty map for an empty request without a round
 * trip, so a caller need not special-case an entity that has no identifier yet.
 */
export async function fetchAnimalNames(entityIds: readonly (string | null)[]): Promise<Map<string, AnimalName>> {
  const wanted = [...new Set(entityIds.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();
  const { data } = await supabase()
    .from('animal_names')
    .select('entity_id, common_name, taxon_entity_id, taxon_common_name, inaturalist_scientific_name')
    .in('entity_id', wanted)
    .throwOnError();
  // `entity_id` types as nullable because every column of a VIEW does — Postgres cannot
  // express NOT NULL through one, so gen-types has nothing to go on. It is the view's key
  // and cannot actually be null; narrowed rather than asserted, so a view that one day
  // does return one is dropped instead of keying the map on `null`.
  return new Map(
    (data ?? [])
      .filter((row): row is AnimalName => row.entity_id !== null)
      .map(row => [row.entity_id, row]),
  );
}

export function groupChain<G extends SocialGroup>(groupId: number, groupsById: Map<number, G>): G[] {
  const chain: G[] = [];
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
  nicknames (name, theme, status, named_year, namer:parties (name, url))
` as const;

// The individual a designation names — any code it has ever carried, so a
// superseded T046A finds T122 — matched case-insensitively and as typed
// (T65A → T065A). null when no designation matches.
async function individualIdForDesignation(designation: string): Promise<number | null> {
  const { data } = await supabase()
    .from('designations')
    .select('individual_id')
    .ilike('code', ilikeLiteral(normalizeDesignation(designation)))
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return data?.individual_id ?? null;
}

export async function fetchIndividual(key: ProfileKey) {
  let query = supabase().from('individuals').select(INDIVIDUAL_SELECT);
  if (key.kind === 'entity') {
    query = query.eq('entity_id', key.entityId);
  } else {
    const id = await individualIdForDesignation(key.designation);
    if (id === null) return null;
    query = query.eq('id', id);
  }
  const { data } = await query.maybeSingle().throwOnError();
  return data;
}
export type IndividualProfile = NonNullable<Awaited<ReturnType<typeof fetchIndividual>>>;

export async function fetchParents({ mother_id, father_id }: Pick<Individual, 'mother_id' | 'father_id'>) {
  const ids = [mother_id, father_id].filter((id): id is number => id !== null);
  if (!ids.length) return { mother: null, father: null };
  const { data } = await supabase()
    .from('individuals')
    .select('id, entity_id, primary_designation, life_status, nicknames (name, status)')
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
    .select('id, entity_id, primary_designation, sex, born_earliest, born_latest, life_status, nicknames (name, status)')
    .or(`mother_id.eq.${individualId},father_id.eq.${individualId}`)
    .order('born_earliest', { ascending: true, nullsFirst: true })
    .throwOnError();
  return data;
}
export type Offspring = Awaited<ReturnType<typeof fetchOffspring>>[number];

// A group row plus what a page needs to link its anchor individual: the
// register identifier that keys the individual's URL (decision 034).
export type CatalogGroup = SocialGroup & {
  anchor: { entity_id: string | null; primary_designation: string } | null;
};

// The whole catalog's group graph is a few hundred small rows — fetch it once
// and resolve pod/ecotype chains client-side instead of walking FKs per hop.
export async function fetchAllGroups(): Promise<Map<number, CatalogGroup>> {
  const { data } = await supabase()
    .from('social_groups')
    .select('*, anchor:individuals!anchor_individual_id (entity_id, primary_designation)')
    .throwOnError();
  return new Map(data.map(group => [group.id, group]));
}

// Every animal in a matriline as the register says it (migration 20260923010000): the
// matriarch and all her descendants, sub-lineages included, dead or alive. Each carries
// her innermost matriline, which is how a page groups them by sub-lineage.
//
// Two reads rather than an embed: PostgREST cannot follow matriline_members to
// individuals, because the view's individual_id is a primary key it projects, not a
// foreign key, and PostgREST infers view relationships from foreign keys alone.
export async function fetchGroupMembers(groupId: number) {
  const { data: rows } = await supabase()
    .from('matriline_members')
    .select('individual_id, innermost_group_id')
    .eq('group_id', groupId)
    .throwOnError();
  const ids = rows.map(r => r.individual_id).filter((id): id is number => id !== null);
  if (!ids.length) return [];
  const { data: individuals } = await supabase()
    .from('individuals')
    .select('id, entity_id, primary_designation, sex, born_earliest, life_status, nicknames (name, status)')
    .in('id', ids)
    .throwOnError();
  const byId = new Map(individuals.map(i => [i.id, i]));
  return rows.flatMap(({ individual_id, innermost_group_id }) => {
    const individual = individual_id !== null ? byId.get(individual_id) : undefined;
    return individual ? [{ innermost_group_id, individual }] : [];
  });
}

// An animal's narrowest matriline: a matriarch's own, not her mother's, though
// the register counts her in both. null for an animal in no matriline.
export async function fetchInnermostMatrilineId(individualId: number): Promise<number | null> {
  const { data } = await supabase()
    .from('matriline_members')
    .select('innermost_group_id')
    .eq('individual_id', individualId)
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return data?.innermost_group_id ?? null;
}
export type GroupMember = Awaited<ReturnType<typeof fetchGroupMembers>>[number];

// The occurrence-view slice every page yields; the three views are all
// structurally OccurrenceRow (group/ecotype rows just omit via_group).
type OccurrencePage = {
  range(from: number, to: number): {
    throwOnError(): PromiseLike<{ data: OccurrenceRow[] }>;
  };
};

// PostgREST caps a single response at max_rows (1000). Page through so a subject
// with more reports than the cap (a busy matriline, or the whole ecotype) isn't
// silently truncated. `build` makes a fresh filtered query per page — a
// PostgREST builder is single-use — and is fully type-checked at each call site.
async function pageOccurrences(build: () => OccurrencePage): Promise<OccurrenceRow[]> {
  const PAGE = 1000;
  const rows: OccurrenceRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await build().range(from, from + PAGE - 1).throwOnError();
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

export async function fetchOccurrenceLinks(individualId: number): Promise<OccurrenceLink[]> {
  return dedupeOccurrenceLinks(await pageOccurrences(() => supabase()
    .from('individual_occurrences')
    .select()
    .eq('individual_id', individualId)
    .order('occurrence_id', { ascending: true })));
}

// The !anchor_individual_id hint disambiguates the embed: social_groups
// reaches individuals both through the anchor FK and through membership.
// Nickname facts only — story is access-restricted (D-21).
const MATRILINE_SELECT = `
  *,
  nicknames (name, theme, status, named_year, namer:parties (name, url)),
  anchor:individuals!anchor_individual_id (id, entity_id, primary_designation, life_status, nicknames (name, status))
` as const;

// A matriline by register identifier, or by designation as a legacy link or a
// person writes it: the matriarch's code (T065A, /matrilines/T065A before 034)
// or the group's own written form (T65As). Dropping the trailing s is safe
// here, and only here, because the route has already said this is a group —
// ADR-0019 omits that clause from the fold because in general it merges a
// matriline with its matriarch.
export function matrilineDesignation(typed: string): string {
  return normalizeDesignation(typed).replace(/S$/, '');
}

export async function fetchMatriline(key: ProfileKey) {
  let query = supabase()
    .from('social_groups')
    .select(MATRILINE_SELECT)
    .eq('kind', 'matriline');
  query = key.kind === 'entity'
    ? query.eq('entity_id', key.entityId)
    : query.ilike('designation', ilikeLiteral(matrilineDesignation(key.designation)));
  const { data } = await query.limit(1).maybeSingle().throwOnError();
  return data;
}
export type MatrilineProfile = NonNullable<Awaited<ReturnType<typeof fetchMatriline>>>;

export async function fetchGroupOccurrenceLinks(groupId: number): Promise<OccurrenceLink[]> {
  return dedupeOccurrenceLinks(await pageOccurrences(() => supabase()
    .from('group_occurrences')
    .select()
    .eq('social_group_id', groupId)
    .order('occurrence_id', { ascending: true })));
}

// An ecotype has no anchor individual and no group nicknames today, but the
// select mirrors the matriline shape so the masthead can grow. Facts only (D-21).
const ECOTYPE_SELECT = `
  *,
  nicknames (name, theme, status, named_year, namer:parties (name, url))
` as const;

export async function fetchEcotype(key: ProfileKey) {
  let query = supabase()
    .from('social_groups')
    .select(ECOTYPE_SELECT)
    .eq('kind', 'ecotype');
  query = key.kind === 'entity'
    ? query.eq('entity_id', key.entityId)
    : query.ilike('designation', ilikeLiteral(key.designation));
  const { data } = await query.limit(1).maybeSingle().throwOnError();
  return data;
}
export type EcotypeProfile = NonNullable<Awaited<ReturnType<typeof fetchEcotype>>>;

// The ecotype's sighting record is the union of every descendant's reports
// (see docs/decisions/017); one filter on ecotype_id, deduped per occurrence.
export async function fetchEcotypeOccurrenceLinks(ecotypeId: number): Promise<OccurrenceLink[]> {
  return dedupeOccurrenceLinks(await pageOccurrences(() => supabase()
    .from('ecotype_occurrences')
    .select()
    .eq('ecotype_id', ecotypeId)
    .order('occurrence_id', { ascending: true })));
}

// The matrilines that descend from an ecotype, sorted A–Z — for the ecotype
// page's directory. Tree-scoped (via groupChain), so a future second ecotype
// only lists its own matrilines.
export function descendantMatrilines<G extends SocialGroup>(ecotypeId: number, groupsById: Map<number, G>): G[] {
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

// ---------------------------------------------------------------------------
// Haul-out sites (decision 040): our own list, seeded from the WDFW atlas.
// A site's key is its own integer id, not a register identifier — the
// register holds animals, not places — so the path helpers are separate.

export type Haulout = PublicSchema['Tables']['haulouts']['Row'];
export type HauloutOccurrence = PublicSchema['Views']['haulout_occurrences']['Row'];

// A report the haulout_occurrences view attributed to a site, with the fields
// the page relies on guaranteed present.
export interface HauloutReport {
  haulout_id: number;
  occurrence_id: string;
  observed_at: string;
  location: { lon: number; lat: number } | null;
  accuracy: number | null;
  distance_m: number;
  taxon: { scientific_name: string | null; vernacular_name: string | null } | null;
  species_name: string | null;
  photos: { src: string | null; attribution: string | null }[];
  url: string | null;
  attribution: string | null;
  observer: string | null;
  body: string | null;
}

// The atlas's species codes (Jeffries et al. 2000, table legend).
export const ATLAS_SPECIES: Record<string, string> = {
  PV: 'harbor seal',
  ZC: 'California sea lion',
  EJ: 'Steller sea lion',
  MA: 'northern elephant seal',
};

export function hauloutPath(site: Pick<Haulout, 'id' | 'name'>): string {
  const slug = slugify(site.name);
  return `/haulouts/${site.id}${slug ? `/${slug}` : ''}`;
}

// /haulouts/<id>[/<slug>][/]. Only the id is read; a non-numeric first segment
// names nothing, since sites have no designation to fall back on.
export function parseHauloutPath(pathname: string): number | null {
  const match = pathname.match(/^\/haulouts\/(\d{1,9})(?:\/[^/]*)?\/?$/);
  return match ? Number(match[1]) : null;
}

export async function fetchHaulout(id: number): Promise<Haulout | null> {
  const { data } = await supabase().from('haulouts').select().eq('id', id).maybeSingle().throwOnError();
  return data;
}

export async function fetchAllHaulouts(): Promise<Haulout[]> {
  const { data } = await supabase().from('haulouts').select().order('id').throwOnError();
  return data;
}

// Newest first. The view's location is never null (it is what the join is on),
// but the generated type cannot know that.
export async function fetchHauloutReports(hauloutId: number): Promise<HauloutReport[]> {
  const { data } = await supabase()
    .from('haulout_occurrences')
    .select()
    .eq('haulout_id', hauloutId)
    .order('observed_at', { ascending: false })
    .throwOnError();
  return data.flatMap(row => {
    if (!row.occurrence_id || !row.observed_at || row.haulout_id === null || row.distance_m === null) return [];
    const location = row.location?.lon != null && row.location?.lat != null
      ? { lon: row.location.lon, lat: row.location.lat } : null;
    return [{
      haulout_id: row.haulout_id,
      occurrence_id: row.occurrence_id,
      observed_at: row.observed_at,
      location,
      accuracy: row.accuracy,
      distance_m: row.distance_m,
      taxon: row.taxon ? { scientific_name: row.taxon.scientific_name, vernacular_name: row.taxon.vernacular_name } : null,
      species_name: row.species_name,
      photos: (row.photos ?? []).map(p => ({ src: p.src, attribution: p.attribution })),
      url: row.url,
      attribution: row.attribution,
      observer: row.observer,
      body: row.body,
    }];
  });
}

// Great-circle distance between two points, in kilometres — for ordering
// neighbouring sites, where a few metres either way is nothing.
export function distanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// iNaturalist photos are mirrored as the 75×75 `square` thumbnail; the same
// path serves `medium` (500px), which is what a photo strip wants. The hosts
// are matched exactly, as the edge handler's og:image rewrite does.
const INAT_SQUARE_RE =
  /^(https:\/\/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/\d+\/)square(\.[a-z]+)$/i;
export function mediumPhotoUrl(src: string): string {
  return src.replace(INAT_SQUARE_RE, '$1medium$2');
}
