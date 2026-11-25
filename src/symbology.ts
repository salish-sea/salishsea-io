/**
 * What a marker on the map says an animal is.
 *
 * Decision [029](../docs/decisions/029-map-symbology.md): colour carries the
 * taxon group, the label carries the specifics, and no occurrence is a letter
 * any more. `symbolFor()` collapsed 61,411 occurrences onto 18 glyphs, so `H`
 * meant both a 15 m humpback and a 1.5 m harbour porpoise.
 *
 * Two things live here that look alike and are not. The GROUP is ours outright —
 * a rendering bucket, invented to make a whale distinguishable from a porpoise
 * at a glance. The NAME is the register's, and we only ever compose a shorter
 * form of what it already asserts (animals ADR-0011).
 */

import type { Occurrence } from './types.ts';

// ---------------------------------------------------------------------------
// Taxon groups
// ---------------------------------------------------------------------------

export type GroupKey =
  | 'orca' | 'baleen' | 'toothed' | 'dolphin' | 'porpoise'
  | 'seal' | 'sealion' | 'otter' | 'unknown';

/**
 * The palette is Okabe–Ito, chosen for separation under the common forms of
 * colour vision deficiency and for holding up against the basemap's pale
 * ocean. Orca is near-black because that is what an orca looks like.
 *
 * `label` is the fallback display name for an animal identified no further than
 * its group, and the accessible name for the marker. It is deliberately a
 * category, not a species: "Baleen Whale" claims less than any species would.
 */
export const GROUPS: Record<GroupKey, {label: string, color: string}> = {
  orca:     {label: 'Killer whale',  color: '#1a1a1a'},
  baleen:   {label: 'Baleen whale',  color: '#0072B2'},
  toothed:  {label: 'Toothed whale', color: '#5B2C8D'},
  dolphin:  {label: 'Dolphin',       color: '#56B4E9'},
  porpoise: {label: 'Porpoise',      color: '#009E73'},
  seal:     {label: 'Seal',          color: '#E69F00'},
  sealion:  {label: 'Sea lion',      color: '#D55E00'},
  otter:    {label: 'Otter',         color: '#CC79A7'},
  unknown:  {label: 'Marine mammal', color: '#6B7280'},
};

/**
 * Exhaustive over the distinct scientific names in the corpus as of 2026-08-26.
 * Matched longest-prefix-first, so a subspecies or a genus-only stub lands with
 * its species and 'Phocoenidae' beats 'Phoca'.
 *
 * Prefixes rather than exact names because iNaturalist identifies at every rank:
 * the corpus holds 'Megaptera', 'Megaptera novaeangliae' and 'Megaptera
 * novaeangliae kuzira', and all three are a baleen whale.
 */
const GROUP_PREFIXES: [string, GroupKey][] = [
  ['Orcinus', 'orca'],
  ['Megaptera', 'baleen'], ['Eschrichti', 'baleen'], ['Balaenoptera', 'baleen'],
  ['Balaenopteridae', 'baleen'], ['Eubalaena', 'baleen'], ['Mysticeti', 'baleen'],
  ['Physeter', 'toothed'], ['Kogia', 'toothed'], ['Berardius', 'toothed'],
  ['Hyperoodon', 'toothed'], ['Ziphius', 'toothed'], ['Odontoceti', 'toothed'],
  ['Delphin', 'dolphin'], ['Grampus', 'dolphin'], ['Sagmatias', 'dolphin'],
  // Longer than 'Delphin', and it has to be: Delphinapterus is the beluga, a
  // monodontid, and the shorter prefix would have coloured it as a dolphin and
  // called it one. Monodon and Mesoplodon are here for the same reason before
  // they arrive — a wrong bucket is worse than `unknown`, which at least says
  // "marine mammal" and means it.
  ['Delphinapterus', 'toothed'], ['Monodon', 'toothed'], ['Mesoplodon', 'toothed'],
  ['Aethalodelphis', 'dolphin'], ['Lissodelphi', 'dolphin'], ['Tursiops', 'dolphin'],
  ['Stenella', 'dolphin'], ['Globicephal', 'dolphin'],
  ['Phocoena', 'porpoise'], ['Phocoenoides', 'porpoise'], ['Phocoenidae', 'porpoise'],
  ['Phoca', 'seal'], ['Phocini', 'seal'], ['Phocidae', 'seal'], ['Mirounga', 'seal'],
  ['Zalophus', 'sealion'], ['Eumetopias', 'sealion'], ['Otariidae', 'sealion'],
  ['Arctocephalus', 'sealion'], ['Callorhinus', 'sealion'],
  ['Lontra', 'otter'], ['Enhydra', 'otter'], ['Lutrinae', 'otter'],
  // iNaturalist's 'Phocoidea' is labelled "Pinnipeds" upstream but is strictly
  // the true-seal superfamily (decision 027). Neither seal nor sea lion is
  // honest for it, so it is absent and falls through to `unknown`.
];

export function taxonGroup(scientificName: string | null): GroupKey {
  if (!scientificName)
    return 'unknown';
  let best: GroupKey = 'unknown';
  let bestLength = 0;
  for (const [prefix, group] of GROUP_PREFIXES) {
    if (prefix.length > bestLength && scientificName.startsWith(prefix)) {
      best = group;
      bestLength = prefix.length;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Short map forms (salish-ayb.6)
//
// The register asserts the name; we compose the display. ADR-0011 says so in as
// many words — the label is "input to display, not display", and the register
// "cannot know whether a consumer needs a dropdown entry, a map pin, a sentence
// fragment, a chart axis, or twenty characters on a phone". Truncation is named
// there as a consumer concern.
//
// KEYED ON THE SSA IDENTIFIER, never on a name. ADR-0002 makes the identifier
// opaque and therefore stable, while the name it shortens may be revised
// edition to edition — an override keyed on the string it overrides silently
// stops applying the moment the register improves the name.
//
// EVERY ENTRY IS A TRUNCATION, not a substitution. Dropping a regional
// qualifier that separates our records from nothing, or a trailing generic
// whose head word is already a noun, is presentation. Choosing a different name
// for the animal is minting a second opinion, which animals ADR-0012 exists to
// prevent — it is why a local `taxon_names` override table was rejected in 029.
//
// Which is why an unattributed killer whale reads "Killer whale" and not "Orca",
// though "Orca" is the commoner word. The register holds `orca` for SSA:0000900
// as a `hidden` name — evidence the string is in use, explicitly NOT a name it
// offers for display. Composing our way to the same string would route around
// that judgement. Four of the five forms below are likewise attested as hidden
// strings; the capitalisation is ours, and the shortening is the part ADR-0011
// delegates.
//
// Shortening is not a general rule. 'Humpback whale' -> 'Humpback' works because
// the modifier is a noun; 'Gray whale' -> 'Gray' does not, so Gray whale is
// absent here and displays in full. Most of the register's names are already the
// right length for a map pin — the clutter 029 set out to fix was
// "North American River Otter", and adopting the register fixed that on its own.
// ---------------------------------------------------------------------------

const SHORT_MAP_FORMS: Record<string, string> = {
  'SSA:0000901': 'Humpback',             // Humpback whale
  'SSA:0000914': 'White-sided dolphin',  // Pacific white-sided dolphin
  'SSA:0000917': 'Elephant seal',        // Northern elephant seal
  'SSA:0000927': 'Bottlenose dolphin',   // Common bottlenose dolphin
  'SSA:0000929': 'Right whale dolphin',  // Northern right whale dolphin
};

// ---------------------------------------------------------------------------
// There was a second table here, and its deletion is the point
//
// `SUBSPECIES_FORMS` mapped the two killer whale subspecies onto composed names
// — 'Orcinus orca ater' -> 'Resident killer whale' — and it was the only table
// in this file keyed on a scientific name rather than on an `SSA:` identifier,
// because those two animals had no identifier to key on. Its own comment gave
// the reason as permanent: animals ADR-0008 requires a `kind = taxon` entity to
// reference an external authority, and neither NCBI nor WoRMS holds a child of
// `Orcinus orca` to point at.
//
// The register found the other route. Edition 2026.09.2 crosswalks its two
// ECOTYPES to iNaturalist's two subspecies as `skos:closeMatch` — not exact,
// because an ecotype and a subspecies are different kinds of thing, but
// coextensive on the Society for Marine Mammalogy's authority — and edition
// 2026.09.3 gives SSA:0000003 the common name 'Resident killer whale' that this
// table used to compose. Migration 20260920220000 admits close matches to the
// crosswalk, so both names now arrive in `vernacular_name` like every other.
//
// Nothing a reader sees changed. What changed is who asserts the string:
// composing a name we could have read is the second opinion decision 033
// forbids, and it was only ever defensible while the register was silent.
// ---------------------------------------------------------------------------

/**
 * The name to show for a taxon, shortest honest form first.
 *
 * `vernacular_name` is already the register's common name wherever the crosswalk
 * reaches an entity (migrations 20260828110000, 20260828120000 and
 * 20260920220000); it falls back to iNaturalist's only where the register has no
 * entity, which is why this cannot simply read a register table. Where even that
 * is absent — a genus stub with no vernacular anywhere — the group's category
 * label claims less than the scientific name would and is more use to a reader.
 *
 * Every override here is keyed on the `SSA:` identifier and is a truncation of a
 * name the register asserts, never a substitute for one. We no longer compose a
 * name for any animal; see the note above.
 */
export function displayNameFor(taxon: Occurrence['taxon']): string {
  return (taxon.entity_id ? SHORT_MAP_FORMS[taxon.entity_id] : undefined)
    ?? taxon.vernacular_name
    ?? GROUPS[taxonGroup(taxon.scientific_name)].label;
}

/**
 * The identity line of a track's label, made from what the build published and nothing
 * else (decision 121): each report's `identifiers` and taxon. The pod, the population and
 * the codes a text names are in the identifiers already, as a bout's tags are, so the
 * label has no reader of text of its own.
 *
 * It takes the whole segment because an encounter posted as "J pod northbound" at 09:00
 * and "three orca" at 11:00 is one track whose head, the later point, which carries the
 * label, says nothing on its own. The reports are read in time order and each one's
 * identifiers in the order its text gives them, so the first named wins a tie.
 *
 * Killer whales are named, in this order, by:
 *   1. a pod: the first pod named ("J pod"), or the pod letter of the first code ("J27" is
 *      J pod, "T65A" is Biggs), the old pod letter of the Bigg's;
 *   2. otherwise a population named ("Bigg's" is Biggs, "Southern Resident" is SRKW);
 *   3. otherwise the taxon: the Southern Resident community is SRKW, `rectipinnus` is
 *      Biggs and `ater` is Resident.
 * Within each of the first two steps a name that any report gives plainly comes before one
 * that is only possibly there (decision 054), and a name taken from a possible identifier
 * keeps its "?": "J27?" alone gives "J pod?". A possible pod still comes before a plain
 * population, so a track can read "J pod? · Southern Resident".
 *
 * The two orca subspecies carry the ecotype themselves, so they answer even when no
 * identifier does: migration 20260828120000 deliberately exempts them from the subspecies
 * roll-up for exactly this reason. They are the weakest evidence and come last, because a
 * report naming J pod is more specific than a taxon saying "some resident".
 */
/** The Southern Resident community in the register — SSA:0000001's replacement since Q1. */
const SOUTHERN_RESIDENT = 'SSA:0000010';

/** What a published identifier names for the label's first step: a pod, or Biggs by a T code; null for any other. */
function podOf(identifier: string): string | null {
  const letter = /^([JKL]) pod$/.exec(identifier)?.[1] ?? /^[JKL](?=\d)/.exec(identifier)?.[0];
  if (letter)
    return `${letter} pod`;
  return /^T\d/.test(identifier) ? 'Biggs' : null;
}

/** What a published identifier names for the label's second step: a population, or null. */
function populationOf(identifier: string): string | null {
  switch (identifier) {
    case "Bigg's": return 'Biggs';
    case 'Southern Resident': return 'SRKW';
    default: return null;
  }
}

/**
 * The first name the identifiers give by `name`, in order, a plain one before one that is
 * only possible, and that one with its "?". The identifiers are in time order, each
 * report's in the order its text gives them.
 */
function firstNamed(identifiers: readonly string[], name: (identifier: string) => string | null): string | null {
  let possible: string | null = null;
  for (const identifier of identifiers) {
    const hedged = identifier.endsWith('?');
    const named = name(hedged ? identifier.slice(0, -1) : identifier);
    if (!named)
      continue;
    if (!hedged)
      return named;
    possible ??= `${named}?`;
  }
  return possible;
}

export function labelForSegment(occurrences: readonly Pick<Occurrence, 'identifiers' | 'taxon'>[]): string {
  const head = occurrences[occurrences.length - 1]!;
  if (taxonGroup(head.taxon.scientific_name) === 'orca') {
    const identifiers = occurrences.flatMap(({identifiers}) => identifiers ?? []);
    const pod = firstNamed(identifiers, podOf), population = firstNamed(identifiers, populationOf);
    // A T code only possibly there names Biggs as a population does: "T65A?" beside a plain
    // "Bigg's" is Biggs, not "Biggs? · Bigg's".
    if (pod?.endsWith('?') && population === pod.slice(0, -1))
      return population;
    const named = pod ?? population;
    if (named)
      return named;
    // A record identified as the Southern Resident community says so itself: Maplify
    // reports sent as "Southern Resident Killer Whale" resolve to SSA:0000010
    // (decision 049). Keyed on the identifier, and a pass of its own ahead of the
    // subspecies, because it is the more specific evidence — a track holding one
    // SRKW record and one plain `ater` record is Southern Residents, not "some
    // resident". This is not the narrowing refused below: here the record named them.
    if (occurrences.some(({taxon}) => taxon.entity_id === SOUTHERN_RESIDENT))
      return 'SRKW';
    for (const {taxon} of occurrences) {
      if (taxon.scientific_name === 'Orcinus orca rectipinnus')
        return 'Biggs';
      // NOT 'SRKW'. `ater` is the resident subspecies generally — Southern,
      // Northern and Alaskan residents alike — and SRKW is one population
      // within it, so calling every `ater` record Southern Resident is a
      // narrowing the record does not support (salish-frk, salish-0gb). The
      // argument is taxonomic, not geographic, but the geography agrees: 31 of
      // the 4,377 `ater` occurrences already fall outside `salishSeaExtent`
      // ([-126, 47, -122, 50.5]) — 27 south of it, 3 north — and salish-a4y
      // scopes ingest to killer whales range-wide, so the error grows by
      // design. A report that actually says "southern residents" names them in
      // its identifiers, which is checked above; that path still reads SRKW,
      // because there someone said so.
      // `rectipinnus` above narrows nothing: it and Bigg's are one population.
      if (taxon.scientific_name === 'Orcinus orca ater')
        return 'Resident';
    }
  }
  return displayNameFor(head.taxon);
}

/**
 * The identifiers a label lists after its name: those the name doesn't already say
 * (decision 121). "J pod" leaves out "J pod" and "J pod?", and, when the pod is plain,
 * the Southern Resident population too; "Biggs" or "Biggs?" leaves out "Bigg's" and
 * "Bigg's?"; "SRKW" or "SRKW?" leaves out "Southern Resident" and "Southern Resident?". A name that is only possible ("J pod?") leaves out the pod's two
 * forms and keeps "Southern Resident", which it doesn't say.
 */
export function identifiersBeyond(name: string, identifiers: readonly string[]): string[] {
  const said = new Set<string>();
  if (/^[JKL] pod\??$/.test(name)) {
    said.add(name.replace(/\?$/, '')).add(name.replace(/\?*$/, '?'));
    if (!name.endsWith('?'))
      said.add('Southern Resident').add('Southern Resident?');
  } else if (/^Biggs\??$/.test(name))
    said.add("Bigg's").add("Bigg's?");
  else if (/^SRKW\??$/.test(name))
    said.add('Southern Resident').add('Southern Resident?');
  return identifiers.filter(identifier => !said.has(identifier));
}

/** A lone occurrence is a segment of one. */
export function labelFor(occurrence: Pick<Occurrence, 'identifiers' | 'taxon'>): string {
  return labelForSegment([occurrence]);
}

/**
 * "Seen 3× over 10h" — the second line of a multi-point track's label.
 *
 * The unit is named deliberately. An earlier form read `Gray whale (3)`, and a
 * bare number beside an animal's name reads as a count of ANIMALS — which is
 * exactly what `count` means elsewhere on the same record. On a map whose job is
 * reporting how many animals are where, that is a misreading with consequences.
 */
export function trackSummary(points: number, spanHours: number): string {
  const span = spanHours < 1 ? 'in under an hour' : `over ${spanHours.toFixed(0)}h`;
  return `Seen ${points}× ${span}`;
}
