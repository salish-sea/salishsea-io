import partnersRaw from './partners.csv?raw';

interface Partner {
  name: string;
  url: string;
}

function parsePartnersCSV(raw: string): Partner[] {
  return raw
    .trim()
    .split('\n')
    .slice(1)                         // skip header row
    .filter(line => line.trim())      // skip blank lines
    .map(line => {
      const comma = line.indexOf(',');
      return {
        name: line.slice(0, comma).trim(),
        url: line.slice(comma + 1).trim(),
      };
    });
}

// Parsed once at module load — not re-parsed on each render
export const partners: Partner[] = parsePartnersCSV(partnersRaw);

// Splits body into alternating segments: [plain text, existing-link, plain text, ...]
// Odd-indexed segments are existing markdown links — leave them untouched.
const EXISTING_LINK_RE = /(\[.*?\]\(.*?\))/g;

function injectOrgLink(body: string, name: string, url: string): string {
  const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // regex-escape

  // Guard: skip if already linked — [Name]( exists (case-insensitive)
  if (new RegExp('\\[' + e + '\\]\\(', 'i').test(body)) return body;

  // Single pass on plain-text segments only: bare [Name] (not followed by '(')
  // OR word-boundary plain name (not inside [])
  const re = new RegExp(
    '(\\[' + e + '\\](?!\\())|(?<!\\[)\\b(' + e + ')\\b(?!\\])',
    'gi'
  );

  // Split on existing markdown links so we never process URL segments
  return body
    .split(EXISTING_LINK_RE)
    .map((segment, i) => {
      // Odd indices are existing markdown links — pass through untouched
      if (i % 2 === 1) return segment;
      // Replace callback always uses canonical CSV name (preserves brand capitalization)
      return segment.replace(re, () => '[' + name + '](' + url + ')');
    })
    .join('');
}

export function injectPartnerLinks(body: string): string {
  // Longest names first: prevents short names matching inside long names
  const sorted = [...partners].sort((a, b) => b.name.length - a.name.length);
  return sorted.reduce((text, {name, url}) => injectOrgLink(text, name, url), body);
}
