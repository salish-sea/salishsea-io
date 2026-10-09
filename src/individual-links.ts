import { populationPath, individualPath, matrilinePath } from './catalog.ts';
import { fold } from './fold.ts';
import { READ_PATH_BASE } from './read-path.ts';

// Same shape as public.extract_identifiers (20250924160210_detect_individuals.sql):
// pod/catalog prefix, optional separator, leading zeros, digit + hex block, and a
// trailing 's' marking a matriline ("T65As"). Group codes are matched so they are
// linked to the matriline's page (or left alone when unresolved), not half-linked
// as the embedded individual code.
const CODE_RE = /\b(j|k|l|t|crc)[- ]?0*(\d[\da-f]+)(s?)\b/gi;

// Ecotype names written out in sighting prose ("Biggs T46Bs southbound"). Unlike
// codes these aren't in the catalog as designations, so the small set of known
// terms maps to an ecotype designation in code (mirrors ECOTYPE_LABELS in
// ecotype-page.ts / the edge handler). Straight and curly apostrophes both.
const ECOTYPE_TERM_RE = /\b(bigg['’]?s|transients?)\b/gi;

function ecotypeForTerm(term: string): string | null {
  const t = term.toLowerCase().replace(/[’]/g, "'");
  if (t === 'biggs' || t === "bigg's" || t === 'transient' || t === 'transients') return 'Biggs';
  return null;
}

// Splits body into alternating segments: [plain text, existing-link, plain text, ...]
// Odd-indexed segments are existing markdown links — leave them untouched.
const EXISTING_LINK_RE = /(\[.*?\]\(.*?\))/g;

// What a link needs to know about its target: the register identifier that
// keys the URL (decision 034) and the designation that becomes its slug.
export interface IndividualRef {
  entity_id: string | null;
  primary_designation: string;
}

// A matriline or an ecotype: the register identifier, and our designation.
export interface GroupRef {
  entity_id: string | null;
  designation: string;
}

// Turn catalog-resolvable identifier codes in a markdown body into links to the
// individual's profile page, matriline codes ("T65As") into links to the
// matriline's page, and ecotype names in prose ("Biggs", "transients") into
// links to the ecotype page. Codes are compared by the register's fold
// (animals ADR-0019): `codes` maps a folded designation (e.g. 't65a5') to the
// individual it names; `matrilines` maps a folded group code (e.g. 't65as') to
// the matriline; `ecotypes` maps an ecotype designation ('Biggs') to the ecotype. Codes and
// terms that resolve to nothing (SRKW, CRC, uncataloged) pass through as plain
// text — linking is a navigation aid, never an identification claim.
export function injectIndividualLinks(
  body: string,
  codes: Map<string, IndividualRef>,
  matrilines: Map<string, GroupRef> = new Map(),
  ecotypes: Map<string, GroupRef> = new Map(),
): string {
  return body
    .split(EXISTING_LINK_RE)
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      const linked = segment.replace(CODE_RE, (match, prefix: string, block: string, matriline: string) => {
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
      // Codes never contain an ecotype word and ecotype links never contain a
      // code, so this second pass can't collide with the one above.
      return linked.replace(ECOTYPE_TERM_RE, match => {
        const designation = ecotypeForTerm(match);
        const ecotype = designation ? ecotypes.get(designation) : undefined;
        return ecotype ? `[${match}](${populationPath(ecotype)})` : match;
      });
    })
    .join('');
}

let codeMap: Map<string, IndividualRef> | null = null;
let matrilineMap: Map<string, GroupRef> | null = null;
let ecotypeMap: Map<string, GroupRef> | null = null;
let loading: Promise<Map<string, IndividualRef>> | null = null;

/**
 * The rows the lookup is built from, in the shape the Supabase query returns and the
 * read-path build writes to `catalog-codes.json` (decision 057): every designation an
 * individual has carried, and the matriline and ecotype designations.
 */
export interface CatalogCodeRows {
  designations: { code: string; individual: IndividualRef | null }[];
  groups: { kind: string; designation: string; entity_id: string | null }[];
}

/** Sets the lookup from its rows, whichever source they came from. */
export function setCatalogCodes({ designations, groups }: CatalogCodeRows): Map<string, IndividualRef> {
  codeMap = new Map(designations.flatMap(({ code, individual }) => individual ? [[fold(code), individual]] : []));
  matrilineMap = new Map(groups.filter(g => g.kind === 'matriline').map(g => [fold(`${g.designation}s`), g]));
  ecotypeMap = new Map(groups.filter(g => g.kind === 'ecotype').map(g => [g.designation, g]));
  return codeMap;
}

async function fetchCatalogCodeRows(): Promise<CatalogCodeRows> {
  // The build's file (decision 056), at most one build behind.
  const url = `${READ_PATH_BASE}catalog-codes.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return await response.json() as CatalogCodeRows;
}

// Fetch the designation -> individual lookup (plus the matriline and ecotype
// designations) once per session. The whole catalog is ~1k tiny rows; callers
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

export function ecotypeCodes(): Map<string, GroupRef> | null {
  return ecotypeMap;
}
