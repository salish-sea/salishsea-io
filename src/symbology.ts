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
import { detectEcotype, detectPod } from './identifiers.ts';

// ---------------------------------------------------------------------------
// Taxon groups
// ---------------------------------------------------------------------------

export type GroupKey =
  | 'orca' | 'baleen' | 'toothed' | 'dolphin' | 'porpoise'
  | 'seal' | 'sealion' | 'otter' | 'unknown';

/**
 * The palette is Okabe–Ito, chosen for separation under the common forms of
 * colour vision deficiency and for holding up against the pale Esri ocean
 * basemap. Orca is near-black because that is what an orca looks like.
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

/**
 * The name to show for a taxon, shortest honest form first.
 *
 * `vernacular_name` is already the register's common name wherever it has an
 * exact match (migrations 20260828110000 and 20260828120000); it falls back to
 * iNaturalist's only where the register has no entity, which is why this cannot
 * simply read a register table. Where even that is absent — a genus stub with no
 * vernacular anywhere — the group's category label claims less than the
 * scientific name would and is more use to a reader.
 */
export function displayNameFor(taxon: Occurrence['taxon']): string {
  const short = taxon.entity_id ? SHORT_MAP_FORMS[taxon.entity_id] : undefined;
  return short
    ?? taxon.vernacular_name
    ?? GROUPS[taxonGroup(taxon.scientific_name)].label;
}

/**
 * The identity line of a marker's label.
 *
 * Killer whales keep their pod letter. That part of the old scheme was never
 * broken — a J/K/L or a Biggs is the distinction this audience actually draws,
 * and decision 029 keeps it while retiring the rest of `symbolFor()`. It reads
 * from the sighting's prose, which is where a pod is reported.
 *
 * The two orca subspecies carry the ecotype themselves, so they answer even when
 * the prose does not: migration 20260828120000 deliberately exempts them from
 * the subspecies roll-up for exactly this reason.
 */
export function labelFor(occurrence: Pick<Occurrence, 'body' | 'taxon'>): string {
  const {taxon} = occurrence;
  if (taxonGroup(taxon.scientific_name) === 'orca') {
    const body = occurrence.body || '';
    const pod = detectPod(body);
    if (pod)
      return pod === 'T' ? 'Biggs' : `${pod} pod`;
    // A report that says "southern residents" without naming a matriline still
    // said which whales it saw. detectPod only answers this for Biggs, via the
    // T that was their old pod letter, so the ecotype is asked separately.
    const ecotype = detectEcotype(body);
    if (ecotype)
      return ecotype;
    if (taxon.scientific_name === 'Orcinus orca rectipinnus')
      return 'Biggs';
    if (taxon.scientific_name === 'Orcinus orca ater')
      return 'SRKW';
  }
  return displayNameFor(taxon);
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
