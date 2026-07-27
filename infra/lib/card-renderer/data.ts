// Supabase reads for the card renderer.
//
// The renderer fetches its own data rather than having the edge handler pass it
// in. That keeps the 128MB/5s viewer-request function thin — it only has to
// decide *which* card URL to name — and it keeps a card URL self-describing and
// cacheable by id alone.

import type { LonLat } from './mercator.js';

export interface Occurrence {
  id: string;
  location: LonLat | null;
  observedAt: string;
  species: string;
  count: number | null;
}

interface OccurrenceRow {
  id: string;
  location: { lon: number; lat: number } | null;
  observed_at: string;
  count: number | null;
  taxon: { vernacular_name?: string } | null;
}

const FETCH_TIMEOUT_MS = 4000;
const SELECT = 'id,location,observed_at,count,taxon';

export interface SupabaseConfig {
  url: string;
  key: string;
}

export function configFromEnv(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('card renderer needs SUPABASE_URL and SUPABASE_ANON_KEY');
  }
  return { url, key };
}

async function query(cfg: SupabaseConfig, path: string): Promise<unknown[]> {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`supabase ${res.status} for ${path}`);
  return await res.json() as unknown[];
}

function toOccurrence(row: OccurrenceRow): Occurrence {
  return {
    id: row.id,
    location: row.location ? { lon: row.location.lon, lat: row.location.lat } : null,
    observedAt: row.observed_at,
    species: row.taxon?.vernacular_name ?? 'Marine mammal',
    count: row.count,
  };
}

/** One occurrence, or null if the id is unknown. */
export async function fetchOccurrence(cfg: SupabaseConfig, id: string): Promise<Occurrence | null> {
  const rows = await query(cfg, `occurrences?id=eq.${encodeURIComponent(id)}&select=${SELECT}&limit=1`);
  const row = rows[0] as OccurrenceRow | undefined;
  return row ? toOccurrence(row) : null;
}

/**
 * Every located occurrence in a half-open instant range. `limit` is a safety
 * belt, not a product rule: the busiest day observed carries 153 occurrences, so
 * the default leaves generous headroom while still bounding the response.
 */
export async function fetchOccurrencesBetween(
  cfg: SupabaseConfig,
  startIso: string,
  endIso: string,
  limit = 500,
): Promise<Occurrence[]> {
  const rows = await query(
    cfg,
    `occurrences?observed_at=gte.${encodeURIComponent(startIso)}` +
    `&observed_at=lt.${encodeURIComponent(endIso)}` +
    `&location=not.is.null&select=${SELECT}&order=observed_at.desc&limit=${limit}`,
  );
  return (rows as OccurrenceRow[]).map(toOccurrence).filter(o => o.location !== null);
}
