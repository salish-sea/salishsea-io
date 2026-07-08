import { supabase } from './supabase.ts';
import { ecotypePath, individualPath, matrilinePath, normalizeDesignation } from './catalog.ts';

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

// Turn catalog-resolvable identifier codes in a markdown body into links to the
// individual's profile page, matriline codes ("T65As") into links to the
// matriline's page, and ecotype names in prose ("Biggs", "transients") into
// links to the ecotype page. `codes` maps a normalized designation (e.g.
// 'T065A5') to the individual's primary designation; `matrilines` maps a
// normalized matriarch designation (e.g. 'T065A') to the matriline's
// designation. Codes that resolve to nothing (SRKW, CRC, uncataloged) pass
// through as plain text — linking is a navigation aid, never an identification
// claim.
export function injectIndividualLinks(
  body: string,
  codes: Map<string, string>,
  matrilines: Map<string, string> = new Map(),
): string {
  return body
    .split(EXISTING_LINK_RE)
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      const linked = segment.replace(CODE_RE, (match, prefix: string, block: string, matriline: string) => {
        const normalized = normalizeDesignation(`${prefix}${block}`.toUpperCase());
        if (matriline) {
          const designation = matrilines.get(normalized);
          return designation ? `[${match}](${matrilinePath(designation)})` : match;
        }
        const designation = codes.get(normalized);
        return designation ? `[${match}](${individualPath(designation)})` : match;
      });
      // Codes never contain an ecotype word and ecotype links never contain a
      // code, so this second pass can't collide with the one above.
      return linked.replace(ECOTYPE_TERM_RE, match => {
        const designation = ecotypeForTerm(match);
        return designation ? `[${match}](${ecotypePath(designation)})` : match;
      });
    })
    .join('');
}

let codeMap: Map<string, string> | null = null;
let matrilineMap: Map<string, string> | null = null;
let loading: Promise<Map<string, string>> | null = null;

// Fetch the designation -> primary_designation lookup (plus the matriline
// designations) once per session. The whole catalog is ~1k tiny rows; callers
// re-render when the promise settles.
export function loadCatalogCodes(): Promise<Map<string, string>> {
  loading ??= (async () => {
    try {
      const [{ data: designations }, { data: groups }] = await Promise.all([
        supabase()
          .from('designations')
          .select('code, individual:individuals (primary_designation)')
          .throwOnError(),
        supabase()
          .from('social_groups')
          .select('designation')
          .eq('kind', 'matriline')
          .throwOnError(),
      ]);
      codeMap = new Map(designations.map(({ code, individual }) => [code, individual.primary_designation]));
      matrilineMap = new Map(groups.map(({ designation }) => [designation, designation]));
      return codeMap;
    } catch (error) {
      loading = null; // allow a later retry rather than caching the failure
      throw error;
    }
  })();
  return loading;
}

export function catalogCodes(): Map<string, string> | null {
  return codeMap;
}

export function matrilineCodes(): Map<string, string> | null {
  return matrilineMap;
}
