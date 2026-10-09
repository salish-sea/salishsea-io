import { fold } from './fold.ts';
import { Temporal } from 'temporal-polyfill';

// The catalogue as its pages read it, written out by hand since Postgres stopped being
// its source (salish-9uu.10). The read-path build assembles these shapes from the
// checked-in catalogue and the register (scripts/read-path/profiles.ts, decision 064);
// the vocabularies are data/reference/enums.tsv's.
type LifeStatus = 'alive' | 'deceased' | 'presumed_deceased' | 'unknown';
type Sex = 'male' | 'female';
type ParentageCertainty = 'confirmed' | 'presumed' | 'hypothesized';
type NicknameStatus = 'official' | 'provisional' | 'proposed' | 'deprecated' | 'awaiting_decision';
type DesignationScheme = 'bc_wa' | 'alaska' | 'california' | 'other';
type DesignationStatus = 'active' | 'superseded' | 'uncertain';
type SocialGroupKind = 'ecotype' | 'community' | 'clan' | 'pod' | 'matriline' | 'named_group';
type IdentificationStatus = 'candidate' | 'validated' | 'rejected';
type IdentificationCertainty = 'possible' | 'probable' | 'certain';
type IdentificationEvidence = 'text_mention' | 'photograph' | 'cv_match' | 'field_observation' | 'acoustic';
type MaybeLonLat = { lon: number | null; lat: number | null };

export type Individual = {
  id: number;
  entity_id: string | null;
  primary_designation: string;
  sex: Sex | null;
  born_earliest: number | null;
  born_latest: number | null;
  life_status: LifeStatus;
  mother_id: number | null;
  maternity_certainty: ParentageCertainty;
  father_id: number | null;
  paternity_certainty: ParentageCertainty | null;
};
type SocialGroupRow = {
  id: number;
  kind: SocialGroupKind;
  designation: string;
  designation_folded: string | null;
  entity_id: string | null;
  anchor_individual_id: number | null;
};
// A group row plus its parent, which is the register's (decision 051) and so
// comes from public.group_parents rather than a column of its own.
export type SocialGroup = SocialGroupRow & { parent_group_id: number | null };
// One (individual, occurrence) row of the build's individual links (salish-xv35.13),
// in the columns Postgres's individual_occurrences view had.
export type IndividualOccurrence = {
  individual_id: number | null;
  occurrence_id: string | null;
  observed_at: string | null;
  location: MaybeLonLat | null;
  code: string | null;
  is_present: boolean | null;
  evidence: IdentificationEvidence | null;
  status: IdentificationStatus | null;
  certainty: IdentificationCertainty | null;
  via_group: string | null;
};

type Party = { name: string; url: string | null };
type Nickname = { name: string; theme: string | null; status: NicknameStatus; named_year: number | null; namer: Party | null };
type NicknameBrief = { name: string; status: NicknameStatus };

// One (occurrence, individual) link from the individual_occurrences view, with
// the fields the profile page needs guaranteed present.
export interface OccurrenceLink {
  occurrence_id: string;
  observed_at: string;
  location: { lon: number; lat: number } | null;
  is_present: boolean;
  status: IdentificationStatus;
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
// The Fly app's redirect server (scripts/read-path/redirect.ts) 301s the
// non-canonical shapes, from the map the build writes.
//
// A matriline's slug is the group's written form, T065As, not the matriarch's
// code that social_groups.designation holds: /matrilines/0002163/T065As. It is
// how sighting prose writes the group, and 034's own example.

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

/**
 * The kinds of group a population's top page is for (decision 070): an ecotype, as the
 * Bigg's are, or a community, as the Southern Residents are. They are peers; nothing
 * renders a page for the Resident ecotype or a clan.
 */
export const POPULATION_KINDS = ['ecotype', 'community'] as const;

export function isPopulation(group: { kind: string }): boolean {
  return (POPULATION_KINDS as readonly string[]).includes(group.kind);
}

// What each population is called. A group's notes would say, but notes are never
// rendered (D-21), so the label is set in code; one without an entry shows its designation.
const POPULATION_LABELS: Record<string, string> = {
  Biggs: "Bigg's (transient) killer whales",
  'Southern Resident': 'Southern Resident killer whales',
};

/** What a population is called in a heading, a title or a link: "Bigg's (transient) killer whales". */
export function populationLabel(group: { designation: string }): string {
  return POPULATION_LABELS[group.designation] ?? group.designation;
}

/** One of a population's animals, in prose: "Bigg's killer whale", "Southern Resident killer whale". */
export function populationNoun(group: { designation: string }): string {
  return populationLabel(group).replace(/ \([^)]*\)/, '').replace(/s$/, '');
}

export function populationPath(group: { entity_id: string | null; designation: string }): string {
  return profilePath('populations', group.entity_id, group.designation);
}

/** What a pod is called in a heading, a title or a link: J pod. Its designation is the letter alone. */
export function podLabel(group: { designation: string }): string {
  return `${group.designation} pod`;
}

/**
 * A Southern Resident pod's page (decision 070's one level between a population and its
 * matrilines): /pods/0000020/J-pod. Generated from the register, so it always has an identifier.
 */
export function podPath(group: { entity_id: string | null; designation: string }): string {
  return profilePath('pods', group.entity_id, podLabel(group));
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
    // A direct claim beats a via-group one; between two groups, the alphabetically
    // first, so the choice doesn't fall to row order (decision 057).
    if (existing && !(existing.via_group && (!via_group || via_group < existing.via_group))) continue;
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

// What an individual's page shows of it (decision 057): its row, its designations and
// their authorities, and its nicknames with their namers. Nickname facts only: a story is
// withheld (rights policy D-21).
export type IndividualProfile = Individual & {
  designations: { code: string; scheme: DesignationScheme; is_primary: boolean; status: DesignationStatus;
    in_catalog: boolean; authority: Party | null }[];
  nicknames: Nickname[];
};
export type Parent = Pick<Individual, 'id' | 'entity_id' | 'primary_designation' | 'life_status'> & { nicknames: NicknameBrief[] };
export type Offspring = Pick<Individual, 'id' | 'entity_id' | 'primary_designation' | 'sex' | 'born_earliest' | 'born_latest' | 'life_status'>
  & { nicknames: NicknameBrief[] };

// A group row plus what a page needs to link its anchor individual: the
// register identifier that keys the individual's URL (decision 034).
export type CatalogGroup = SocialGroup & {
  anchor: { entity_id: string | null; primary_designation: string } | null;
};

// An animal in a matriline as the register says it: the matriarch and all her
// descendants, sub-lineages included, dead or alive. Each carries her innermost
// matriline, which is how a page groups them by sub-lineage.
export type GroupMember = {
  innermost_group_id: number | null;
  individual: Pick<Individual, 'id' | 'entity_id' | 'primary_designation' | 'sex' | 'born_earliest' | 'life_status'>
    & { nicknames: NicknameBrief[] };
};

// A matriline by register identifier, or by designation as a legacy link or a
// person writes it: the matriarch's code (T065A, /matrilines/T065A before 034)
// or the group's own written form (T65As). Folded, then the trailing s dropped
// — safe here, and only here, because the route has already said this is a
// group. ADR-0019 omits that clause from the fold because in general it merges
// a matriline with its matriarch.
export function matrilineDesignation(typed: string): string {
  return fold(typed).replace(/s$/, '');
}

// What a matriline's page shows of it: the group, its nicknames, and its anchor.
export type MatrilineProfile = SocialGroupRow & {
  nicknames: Nickname[];
  anchor: (Pick<Individual, 'id' | 'entity_id' | 'primary_designation' | 'life_status'> & { nicknames: NicknameBrief[] }) | null;
};
// A population has no anchor individual and no group nicknames today, but the shape
// mirrors the matriline's so the masthead can grow. Facts only (D-21).
export type EcotypeProfile = SocialGroupRow & { nicknames: Nickname[] };

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

export type Haulout = {
  id: number;
  name: string;
  location: MaybeLonLat;
  radius_m: number;
  region: string | null;
  story: string | null;
  verified: boolean;
  created_at: string;
  atlas_code: string | null;
  atlas_count: string | null;
  atlas_description: string | null;
  atlas_species: string[] | null;
  atlas_tidal_use: string | null;
};
// One report the build attributed to a site, in the columns Postgres's
// haulout_occurrences view had.
export type HauloutOccurrence = {
  haulout_id: number | null;
  occurrence_id: string | null;
  observed_at: string | null;
  location: MaybeLonLat | null;
  accuracy: number | null;
  distance_m: number | null;
  taxon: { scientific_name: string | null; vernacular_name: string | null; species_id: number | null; entity_id: string | null } | null;
  species_name: string | null;
  photos: { src: string | null; thumb: string | null; attribution: string | null; mimetype: string | null; license: string | null }[] | null;
  url: string | null;
  attribution: string | null;
  observer: string | null;
  body: string | null;
};

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

// What the main map's haul-out layer draws of each site (GH #453): where it is,
// how far its reports reach, and enough to name it and link to its page.
export type HauloutSite = Pick<Haulout, 'id' | 'name' | 'location' | 'radius_m'>;

export const hauloutSite = ({id, name, location, radius_m}: HauloutSite): HauloutSite => ({id, name, location, radius_m});

// The file the read-path build writes the sites into, beside their pages
// (scripts/read-path/profiles.ts), and the map reads them from.
export const HAULOUT_SITES_FILE = 'sites.json';

export function hauloutReport(row: HauloutOccurrence): HauloutReport[] {
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
