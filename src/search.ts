/**
 * What the site's search field finds, and how it ranks it (GH #640). Pure, so the build
 * that writes the index (scripts/read-path/search-index.ts) and the field that reads it
 * (src/site-search.ts) share one definition, and a test can hold both to it.
 *
 * Search is a way in for someone who already knows a name: a designation (T65A, J31),
 * a nickname, a matriline (T065As), a population, a region of the map, a haul-out site.
 * Each result is a place to go. An animal offers two: its page, and its most recent
 * sighting on the map, the day it was reported with the report focused (Peter,
 * 2026-10-07). A region is a view, so it opens the map filtered to it.
 */

import { fold } from './fold.ts';

export type SearchKind = 'individual' | 'matriline' | 'population' | 'haulout' | 'region';

/** One thing the field can find, as the build writes it. */
export interface SearchEntry {
  kind: SearchKind;
  /** What the result says first: a designation, a name. */
  label: string;
  /** A second line saying what it is: "Bigg's killer whale · Fingers", "Haul-out site". */
  note: string;
  /** Every name it answers to, folded as the register compares names (src/fold.ts). */
  keys: string[];
  /** Where choosing it goes: a profile page, or the map. */
  href: string;
  /** An animal's most recent sighting: its date and the map focused on it. */
  latest?: { date: string; href: string };
}

/** The index the build writes to /read-path/search-index.json. */
export interface SearchIndex {
  entries: SearchEntry[];
}

/** Which kind shows first among results that match equally well: animals before places. */
const KIND_ORDER: readonly SearchKind[] = ['individual', 'matriline', 'population', 'region', 'haulout'];

/**
 * The entries a query finds, best first: a name matched whole, then one it begins, then
 * one it begins a word of, then one it is inside; equally good matches by kind, then by
 * label. Nothing for a blank query.
 */
export function search(entries: readonly SearchEntry[], query: string, limit = 8): SearchEntry[] {
  const q = fold(query);
  if (!q) return [];
  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of entries) {
    let score = Infinity;
    for (const key of entry.keys) {
      if (key === q) score = Math.min(score, 0);
      else if (key.startsWith(q)) score = Math.min(score, 1);
      else if (key.includes(` ${q}`)) score = Math.min(score, 2);
      else if (key.includes(q)) score = Math.min(score, 3);
    }
    if (score < Infinity) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => a.score - b.score
      || KIND_ORDER.indexOf(a.entry.kind) - KIND_ORDER.indexOf(b.entry.kind)
      || a.entry.label.localeCompare(b.entry.label, 'en', { numeric: true }))
    .slice(0, limit)
    .map(s => s.entry);
}
