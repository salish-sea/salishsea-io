// The card renderer's reads: the read-path build's files (decisions 056, 061), and
// the write API only for a sighting saved here since the last build (salish-9uu.5).
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

// Where the read-path build's files are served: through the site's distribution, so a
// read is usually a cache hit.
const READ_PATH = 'https://salishsea.io/read-path/';
// The write API (decision 065), which answers anyone's read of one sighting by id as the
// build will publish it: the bridge between a save and the build that carries it.
const API = 'https://salishsea.io/api/';

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
 * sighting (a bare uuid; an upstream id carries its source, `maplify:…`), from the
 * write API, which holds what people save here until a build publishes it. Without
 * that arm a link shared the moment a sighting was saved rendered no card, and the
 * miss was cached for minutes after the files had caught up.
 */
export async function fetchOccurrence(id: string): Promise<Occurrence | null> {
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
  const res = await fetch(`${API}sightings/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  // 404: no such sighting. 400: not a sighting id at all (a native id is a uuid), which is
  // as much a miss as an unknown one, and a cacheable one rather than a 500 per crawler.
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`api sighting ${id}: HTTP ${res.status}`);
  const { occurrence } = await res.json() as { occurrence: OccurrenceRow | null };
  return occurrence ? toOccurrence(occurrence) : null;
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
