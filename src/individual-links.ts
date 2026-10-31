import { isPopulation, populationPath, individualPath, matrilinePath, podLabel, podPath } from './catalog.ts';
import { fold } from './fold.ts';
import { READ_PATH_BASE } from './read-path.ts';

// Same shape as public.extract_identifiers (20250924160210_detect_individuals.sql):
// pod/catalog prefix, optional separator, leading zeros, digit + hex block, and a
// trailing 's' marking a matriline ("T65As"). Group codes are matched so they are
// linked to the matriline's page (or left alone when unresolved), not half-linked
// as the embedded individual code.
const CODE_RE = /\b(j|k|l|t|crc)[- ]?0*(\d[\da-f]+)(s?)\b/gi;

// Population names written out in sighting prose ("Biggs T46Bs southbound", "SRKWs
// northbound"). Unlike codes these aren't in the catalog as designations, so the small
// set of known terms maps to a population's designation in code (mirrors
// POPULATION_LABELS in catalog.ts). "Resident" alone names no population the catalogue
// has: the Northern Residents are residents too. Straight and curly apostrophes both.
const POPULATION_TERM_RE = /\b(bigg['’]?s|transients?|srkw(?:['’]?s)?|southern residents?)\b/gi;

function populationForTerm(term: string): string | null {
  const t = fold(term);
  if (t === 'biggs' || t === 'transient' || t === 'transients') return 'biggs';
  if (t.startsWith('srkw') || t.startsWith('southern resident')) return 'southern resident';
  return null;
}

// A Southern Resident pod by its letter: "J pod", "J-pod", "Jpod", "K pods". The word
// pod is what makes it a pod, so "J" alone is a letter, and "J31s" is a matriline that
// CODE_RE has already linked.
const POD_RE = /\b([jkl])[- ]?pods?\b/gi;

// The pods' plural shorthand, "Js and Ks", in capitals only, so that "ls" and "js"
// in ordinary text stay text.
const POD_PLURAL_RE = /\b([JKL])['’]?s\b/g;

// Splits body into alternating segments: [plain text, existing-link, plain text, ...]
// Odd-indexed segments are existing markdown links, inline ("[text](url)") or by
// reference ("[text][ref]") — leave them untouched. Neither part crosses a closing
// bracket, so a bracketed provenance tag ("[Orca Network] SRKWs ...") ahead of a link
// doesn't make the text between them part of it.
const EXISTING_LINK_RE = /(\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\[[^\]]*\])/g;

// Applies a replacement to the text outside markdown links only, so that each pass
// leaves alone what the source linked and what an earlier pass linked.
function replaceOutsideLinks(body: string, re: RegExp, replacer: (match: string, ...groups: string[]) => string): string {
  return body
    .split(EXISTING_LINK_RE)
    .map((segment, i) => i % 2 === 1 ? segment : segment.replace(re, replacer))
    .join('');
}

// What a link needs to know about its target: the register identifier that
// keys the URL (decision 034) and the designation that becomes its slug.
export interface IndividualRef {
  entity_id: string | null;
  primary_designation: string;
}

// A matriline, a population or a pod: the register identifier, and our designation.
export interface GroupRef {
  entity_id: string | null;
  designation: string;
}

// Turn catalog-resolvable identifier codes in a markdown body into links to the
// individual's profile page, matriline codes ("T65As") into links to the
// matriline's page, population names in prose ("Biggs", "transients", "SRKWs") into
// links to the population's page, and pod names ("J pod", "Ks") into links to the
// pod's page. Codes are compared by the register's fold (animals ADR-0019): `codes`
// maps a folded designation (e.g. 't65a5') to the individual it names; `matrilines`
// maps a folded group code (e.g. 't65as') to the matriline; `populations` maps a
// folded population designation ('biggs', 'southern resident') to the population;
// `pods` maps a folded pod label ('j pod') to the pod. Codes and terms that resolve to
// nothing (CRC, uncataloged) pass through as plain text — linking is a navigation
// aid, never an identification claim.
export function injectIndividualLinks(
  body: string,
  codes: Map<string, IndividualRef>,
  matrilines: Map<string, GroupRef> = new Map(),
  populations: Map<string, GroupRef> = new Map(),
  pods: Map<string, GroupRef> = new Map(),
): string {
  const linkPod = (match: string, letter: string) => {
    const pod = pods.get(fold(`${letter} pod`));
    return pod ? `[${match}](${podPath(pod)})` : match;
  };
  let linked = replaceOutsideLinks(body, CODE_RE, (match, prefix, block, matriline) => {
    // Separator and leading zeros dropped, as public.extract_identifiers does,
    // then folded; the s stays, so a matriline code only ever finds a group.
    const folded = fold(`${prefix}${block}${matriline}`);
    if (matriline) {
      const group = matrilines.get(folded);
      return group ? `[${match}](${matrilinePath(group)})` : match;
    }
    const individual = codes.get(folded);
    return individual ? `[${match}](${individualPath(individual)})` : match;
  });
  linked = replaceOutsideLinks(linked, POPULATION_TERM_RE, match => {
    const designation = populationForTerm(match);
    const population = designation ? populations.get(designation) : undefined;
    return population ? `[${match}](${populationPath(population)})` : match;
  });
  linked = replaceOutsideLinks(linked, POD_RE, linkPod);
  return replaceOutsideLinks(linked, POD_PLURAL_RE, linkPod);
}

/**
 * The page of the population a sighting's taxon is, when it is one with a page: an SRKW
 * report's taxon is the Southern Resident community (SSA:0000010), so its card's name
 * links there, whatever its text says. Only what the record asserts is linked.
 */
export function populationPage(entityId: string | null, populations: Map<string, GroupRef>): string | null {
  if (!entityId) return null;
  for (const population of populations.values())
    if (population.entity_id === entityId) return populationPath(population);
  return null;
}

/** One of the animals or groups a sighting names, and its page when the catalogue knows it. */
export interface NamedAnimal {
  label: string;
  href: string | null;
  /** Tagged as only possibly heard: a bout's tag that ends in '?' (decision 054). */
  possibly: boolean;
}

/**
 * The animals and groups a sighting names, once each, in the order they come, for
 * the row of chips on its card. Two kinds of name arrive here: the catalogue codes
 * the build reads from a report's text (T65A5, T34As), and the register's labels an
 * Orcasound bout is tagged with (J35, J pod, Bigg's), where a tag only possibly heard
 * ends in '?' (decision 054). Each is looked up by the register's fold with the '?'
 * set aside and reported as `possibly`, and links to its page: an individual, a matriline, a
 * population by its name, or a pod by its label ("J pod", salish-fwyt.3). Names for one
 * animal are one chip, under the first name written: T46A and T122 are the same
 * individual, and a tag given both as heard and as possibly heard counts as heard. A
 * name the catalogue doesn't know stays, unlinked: it is still what was written.
 */
export function namedAnimals(
  identifiers: readonly string[] | null,
  codes: Map<string, IndividualRef>,
  matrilines: Map<string, GroupRef> = new Map(),
  populations: Map<string, GroupRef> = new Map(),
  pods: Map<string, GroupRef> = new Map(),
): NamedAnimal[] {
  const byKey = new Map<string, NamedAnimal>();
  for (const identifier of identifiers ?? []) {
    const possibly = identifier.endsWith('?');
    const label = possibly ? identifier.slice(0, -1) : identifier;
    const folded = fold(label);
    const matriline = matrilines.get(folded);
    const individual = codes.get(folded);
    const population = populations.get(folded);
    const pod = pods.get(folded);
    const href = matriline ? matrilinePath(matriline)
      : individual ? individualPath(individual)
      : population ? populationPath(population)
      : pod ? podPath(pod)
      : null;
    const key = href ?? folded;
    const already = byKey.get(key);
    if (already) already.possibly &&= possibly;
    else byKey.set(key, {label, href, possibly});
  }
  return [...byKey.values()];
}

/** An animal a segment's reports name, and how many of them name it (salish-fwyt.5). */
export interface PooledAnimal extends NamedAnimal {
  /** How many of the reports name it: the start of a reliability mark (salish-0420). */
  support: number;
}

/**
 * The animals a travel segment's reports name, as one set of chips: each animal once,
 * in the order first named, with how many reports name it. Heard by any report outranks
 * possibly heard, as within one report (namedAnimals).
 */
export function pooledAnimals(
  reports: readonly (readonly string[] | null)[],
  codes: Map<string, IndividualRef>,
  matrilines: Map<string, GroupRef> = new Map(),
  populations: Map<string, GroupRef> = new Map(),
  pods: Map<string, GroupRef> = new Map(),
): PooledAnimal[] {
  const byKey = new Map<string, PooledAnimal>();
  for (const identifiers of reports) {
    for (const animal of namedAnimals(identifiers, codes, matrilines, populations, pods)) {
      const key = animal.href ?? fold(animal.label);
      const already = byKey.get(key);
      if (already) {
        already.support++;
        already.possibly &&= animal.possibly;
      } else {
        byKey.set(key, {...animal, support: 1});
      }
    }
  }
  return [...byKey.values()];
}

let codeMap: Map<string, IndividualRef> | null = null;
let matrilineMap: Map<string, GroupRef> | null = null;
let populationMap: Map<string, GroupRef> | null = null;
let podMap: Map<string, GroupRef> | null = null;
let loading: Promise<Map<string, IndividualRef>> | null = null;

/**
 * The rows the lookup is built from, in the shape the Supabase query returns and the
 * read-path build writes to `catalog-codes.json` (decision 057): every designation an
 * individual has carried, and the matriline, population and pod designations.
 */
export interface CatalogCodeRows {
  designations: { code: string; individual: IndividualRef | null }[];
  groups: { kind: string; designation: string; entity_id: string | null }[];
}

/** Sets the lookup from its rows, whichever source they came from. */
export function setCatalogCodes({ designations, groups }: CatalogCodeRows): Map<string, IndividualRef> {
  codeMap = new Map(designations.flatMap(({ code, individual }) => individual ? [[fold(code), individual]] : []));
  matrilineMap = new Map(groups.filter(g => g.kind === 'matriline').map(g => [fold(`${g.designation}s`), g]));
  populationMap = new Map(groups.filter(isPopulation).map(g => [fold(g.designation), g]));
  podMap = new Map(groups.filter(g => g.kind === 'pod').map(g => [fold(podLabel(g)), g]));
  return codeMap;
}

async function fetchCatalogCodeRows(): Promise<CatalogCodeRows> {
  // The build's file (decision 056), at most one build behind.
  const url = `${READ_PATH_BASE}catalog-codes.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return await response.json() as CatalogCodeRows;
}

// Fetch the designation -> individual lookup (plus the matriline, population and
// pod designations) once per session. The whole catalog is ~1k tiny rows; callers
// re-render when the promise settles.
export function loadCatalogCodes(): Promise<Map<string, IndividualRef>> {
  loading ??= (async () => {
    try {
      return setCatalogCodes(await fetchCatalogCodeRows());
    } catch (error) {
      loading = null; // allow a later retry rather than caching the failure
      throw error;
    }
  })();
  return loading;
}

export function catalogCodes(): Map<string, IndividualRef> | null {
  return codeMap;
}

export function matrilineCodes(): Map<string, GroupRef> | null {
  return matrilineMap;
}

/** The populations a bout's tags and a sighting's text can name, ecotypes and communities, keyed by their folded designation. */
export function populationCodes(): Map<string, GroupRef> | null {
  return populationMap;
}

/** The Southern Resident pods, keyed by their folded label as a bout's tags give it ("j pod"). */
export function podCodes(): Map<string, GroupRef> | null {
  return podMap;
}
