// The card renderer's reads: the read-path build's files (decisions 056, 061), and
// Supabase only for a sighting saved here since the last build.
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

// Where the read-path build's files are served: through the site's distribution, so a
// read is usually a cache hit.
const READ_PATH = 'https://salishsea.io/read-path/';

/**
 * Which file of the read-path id index holds an id: a hand copy of
 * src/read-path-shard.ts (FNV-1a over UTF-16 code units, 256 shards), as the edge
 * handler keeps one. data.test.ts pins it to the values the original gives.
 */
export function idShard(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ((hash >>> 0) % 256).toString(16).padStart(2, '0');
}

async function readPath(path: string): Promise<Response> {
  return await fetch(`${READ_PATH}${path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

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

/**
 * One occurrence, or null if the id is unknown: from the build's files, where the id
 * index names its day and the day's file holds it; failing that, for a native
 * sighting (a bare uuid; an upstream id carries its source, `maplify:…`), from
 * Supabase, which holds what people save here until a build publishes it.
 */
export async function fetchOccurrence(cfg: SupabaseConfig, id: string): Promise<Occurrence | null> {
  const shard = await readPath(`ids/${idShard(id)}.json`);
  if (!shard.ok && shard.status !== 404) throw new Error(`read path ids: HTTP ${shard.status}`);
  const days = shard.ok ? await shard.json() as Record<string, unknown> : {};
  // The id comes from the URL: `constructor` must not find an inherited property.
  const day = Object.hasOwn(days, id) ? days[id] : undefined;
  if (typeof day === 'string') {
    const row = (await fetchDay(day)).find(r => r.id === id);
    if (row) return toOccurrence(row);
  }
  if (id.includes(':')) return null;
  const rows = await query(cfg,
    `occurrences?id=eq.${encodeURIComponent(id)}&contributor_id=not.is.null&select=${SELECT}&limit=1`);
  const row = rows[0] as OccurrenceRow | undefined;
  return row ? toOccurrence(row) : null;
}

/** A Pacific day's file, newest first; a day with none has no file. */
async function fetchDay(date: string): Promise<OccurrenceRow[]> {
  const res = await readPath(`days/${date}.json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`read path day ${date}: HTTP ${res.status}`);
  return await res.json() as OccurrenceRow[];
}

/**
 * Every located occurrence on a Pacific day, from its file. `limit` is a safety belt,
 * not a product rule: the busiest day observed carries 153 occurrences.
 */
export async function fetchDayOccurrences(date: string, limit = 500): Promise<Occurrence[]> {
  return (await fetchDay(date)).map(toOccurrence).filter(o => o.location !== null).slice(0, limit);
}
