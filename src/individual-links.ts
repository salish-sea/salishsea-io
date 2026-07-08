import { supabase } from './supabase.ts';
import { individualPath, matrilinePath, normalizeDesignation } from './catalog.ts';

// Same shape as public.extract_identifiers (20250924160210_detect_individuals.sql):
// pod/catalog prefix, optional separator, leading zeros, digit + hex block, and a
// trailing 's' marking a matriline ("T65As"). Group codes are matched so they are
// linked to the matriline's page (or left alone when unresolved), not half-linked
// as the embedded individual code.
const CODE_RE = /\b(j|k|l|t|crc)[- ]?0*(\d[\da-f]+)(s?)\b/gi;

// Splits body into alternating segments: [plain text, existing-link, plain text, ...]
// Odd-indexed segments are existing markdown links — leave them untouched.
const EXISTING_LINK_RE = /(\[.*?\]\(.*?\))/g;

// Turn catalog-resolvable identifier codes in a markdown body into links to the
// individual's profile page, and matriline codes ("T65As") into links to the
// matriline's page. `codes` maps a normalized designation (e.g. 'T065A5') to
// the individual's primary designation; `matrilines` maps a normalized
// matriarch designation (e.g. 'T065A') to the matriline's designation. Codes
// that resolve to nothing (SRKW, CRC, uncataloged) pass through as plain text —
// linking is a navigation aid, never an identification claim.
export function injectIndividualLinks(
  body: string,
  codes: Map<string, string>,
  matrilines: Map<string, string> = new Map(),
): string {
  return body
    .split(EXISTING_LINK_RE)
    .map((segment, i) => {
      if (i % 2 === 1) return segment;
      return segment.replace(CODE_RE, (match, prefix: string, block: string, matriline: string) => {
        const normalized = normalizeDesignation(`${prefix}${block}`.toUpperCase());
        if (matriline) {
          const designation = matrilines.get(normalized);
          return designation ? `[${match}](${matrilinePath(designation)})` : match;
        }
        const designation = codes.get(normalized);
        return designation ? `[${match}](${individualPath(designation)})` : match;
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
