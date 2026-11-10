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
  /** The taxon's species, so two names of one species ("Killer whale", "Southern Resident killer whale") can be told apart from two species. */
  speciesId?: number | null;
  /** The travel segment the build put it in (decision 111): the id of the segment's oldest report. */
  segment?: string;
  /** The route by sea from the segment's previous report, `[lon, lat]`, both ends included, where the straight line crosses land (decision 113). */
  leg?: [number, number][];
  /** The water region it was in, as the build names it ("Haro Strait", "off Vancouver Island"). */
  place?: string | null;
  /** The name reporters use nearest it, in that region ("Lime Kiln Point"); only with a place. */
  landmark?: string | null;
  /** The Southern Resident pods its text names, as letters. */
  pods?: string[];
  /** The animals it names (decision 109): codes, and a bout's tags; a possible one ends in '?'. */
  identifiers?: string[];
}

interface OccurrenceRow {
  id: string;
  location: { lon: number; lat: number } | null;
  observed_at: string;
  count: number | null;
  taxon: { vernacular_name?: string; species_id?: number | null } | null;
  segment?: string;
  leg?: [number, number][];
  place?: string | null;
  landmark?: string | null;
  pods?: string[];
  identifiers?: string[] | null;
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
    speciesId: row.taxon?.species_id ?? null,
    ...(row.segment !== undefined && { segment: row.segment }),
    ...(row.leg && { leg: row.leg }),
    place: row.place ?? null,
    landmark: row.landmark ?? null,
    pods: row.pods ?? [],
    identifiers: row.identifiers ?? [],
  };
}

/**
 * The Maplify id form used before decision 112: `maplify:` and the number alone. Maplify
 * numbers sightings within a source, so a current id is `maplify:<source>:<number>`; the
 * build's aliases (`aliases/<shard>.json`) say which current id an old one named, where
 * exactly one source uses the number. Mirrors isLegacyMaplifyId in src/read-path-shard.ts,
 * which this bundle cannot import.
 */
const LEGACY_MAPLIFY_ID = /^maplify:\d+$/;

/** A sighting the build's files hold: the id index names its day, and the day's file has it. */
async function fromFiles(id: string): Promise<OccurrenceRow | null> {
  const shard = await readPath(`ids/${idShard(id)}.json`);
  if (!shard.ok && shard.status !== 404) throw new Error(`read path ids: HTTP ${shard.status}`);
  const days = shard.ok ? await shard.json() as Record<string, unknown> : {};
  // The id comes from the URL: `constructor` must not find an inherited property.
  const day = Object.hasOwn(days, id) ? days[id] : undefined;
  return typeof day === 'string' ? (await fetchDay(day)).find(r => r.id === id) ?? null : null;
}

/** The current id an old-form Maplify id names, or null. */
async function legacyAlias(id: string): Promise<string | null> {
  const res = await readPath(`aliases/${idShard(id)}.json`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read path aliases: HTTP ${res.status}`);
  const aliases = await res.json() as Record<string, unknown>;
  const current = Object.hasOwn(aliases, id) ? aliases[id] : undefined;
  return typeof current === 'string' ? current : null;
}

/**
 * One occurrence, or null if the id is unknown: from the build's files, where the id
 * index names its day and the day's file holds it; for a Maplify id in the old form
 * that the index lacks, through the alias to the current id; failing that, for a native
 * sighting (a bare uuid; an upstream id carries its source, `maplify:…`), from the
 * write API, which holds what people save here until a build publishes it. Without
 * that arm a link shared the moment a sighting was saved rendered no card, and the
 * miss was cached for minutes after the files had caught up.
 */
export async function fetchOccurrence(id: string): Promise<Occurrence | null> {
  let row = await fromFiles(id);
  if (!row && LEGACY_MAPLIFY_ID.test(id)) {
    const current = await legacyAlias(id);
    if (current) row = await fromFiles(current);
  }
  if (row) return toOccurrence(row);
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
