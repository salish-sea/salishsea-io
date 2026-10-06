/**
 * The write API (decision 065), from the browser: what a signed-in contributor does,
 * sent to salishsea.io/api/ instead of Supabase, when the build sets
 * VITE_WRITE_SOURCE=api (salish-9uu.3.7). Unset, everything goes to Supabase as before.
 *
 * Same origin as the page, so the session cookie the API sets travels with every call
 * and the CSP's connect-src 'self' already admits it.
 */

import { detectIndividuals } from './identifiers.ts';
import { readSource, type ReadSource } from './read-path.ts';
import type { Contributor, Occurrence, UpsertObservationArgs } from './types.ts';

export type WriteSource = 'supabase' | 'api';

export function writeSource(): WriteSource {
  return parseWriteSource(import.meta.env.VITE_WRITE_SOURCE, readSource());
}

/**
 * As parseReadSource: a value that is neither is a typo in a deploy, and fails loudly.
 * So does the API with Supabase's reads: the API's overlay lays a contributor's own
 * sightings over the published files, and a build reading Supabase has none.
 */
export function parseWriteSource(value: string | undefined, reads: ReadSource): WriteSource {
  if (value === undefined || value === '' || value === 'supabase') return 'supabase';
  if (value !== 'api') throw new Error(`VITE_WRITE_SOURCE must be 'supabase' or 'api', not '${value}'`);
  if (reads !== 'static') throw new Error('VITE_WRITE_SOURCE=api needs VITE_READ_SOURCE=static');
  return 'api';
}

/** Who is signed in, as GET /api/me answers. */
export type Me = {
  user_id: string,
  contributor: {id: number, name: string, picture: string | null, editor: boolean, orcid: string | null},
};

/** A sighting as the store holds it (api/sightings.ts's OwnSighting). */
export type OwnSighting = {
  id: string, observed_at: string, location: {lon: number, lat: number},
  observed_from: {lon: number, lat: number} | null, body: string | null, count: number | null,
  direction: string | null, url: string | null, entity_id: string,
  photos: {src: string, license: string}[], contributor_id: number, updated_at: string,
};

/** What the form shows of a species, as the build publishes it (animal-names.json). */
export type SpeciesNames = {common_name: string | null, taxon_common_name: string | null, inaturalist_scientific_name: string | null};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, path: string, init: {json?: unknown, body?: Blob, contentType?: string} = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.body) {
    headers['content-type'] = init.contentType ?? init.body.type;
    body = init.body;
  }
  const response = await fetch(path, {method, headers, body, credentials: 'same-origin'});
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON: the status says it */ }
  if (!response.ok) {
    const message = (parsed as {error?: string} | null)?.error ?? `${method} ${path}: HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return parsed as T;
}

/** The signed-in user, or null when nobody is. */
export async function fetchMe(): Promise<Me | null> {
  try {
    return await call<Me>('GET', '/api/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Sign in with Google's ID token and the raw nonce whose hash Google signed (030). */
export const signIn = (credential: string, nonce: string) => call<Me>('POST', '/api/session', {json: {credential, nonce}});

/** Sign out: the API ends every session the user has. */
export const signOut = () => call<unknown>('DELETE', '/api/session');

export const saveSighting = (sighting: UpsertObservationArgs) =>
  call<{id: string, outcome: 'created' | 'updated'}>('PUT', `/api/sightings/${encodeURIComponent(sighting.id)}`, {json: sighting});

export const deleteSighting = (id: string) => call<unknown>('DELETE', `/api/sightings/${encodeURIComponent(id)}`);

/** Upload a photo for a sighting; resolves to its URL at salishsea.io/media/. */
export async function uploadPhoto(file: File, sightingId: string): Promise<string> {
  const params = new URLSearchParams({sighting: sightingId, name: file.name ?? ''});
  const {url} = await call<{url: string}>('POST', `/api/photos?${params}`, {body: file, contentType: file.type || 'image/jpeg'});
  return url;
}

export const submitFeedback = (feedback: {name: string, email: string | null, message: string, page_url: string,
  user_agent: string, release: string}) => call<unknown>('POST', '/api/feedback', {json: feedback});

/** The signed-in contributor's own sightings observed in [since, until). */
export async function fetchOwnSightings(since: Date, until: Date): Promise<OwnSighting[]> {
  const params = new URLSearchParams({since: since.toISOString(), until: until.toISOString()});
  return (await call<{sightings: OwnSighting[]}>('GET', `/api/sightings?${params}`)).sightings;
}

/**
 * A sighting as saved, shaped as the map's occurrence, until a build publishes the
 * build's own version of it. What the build derives is approximated from what the page
 * has: the species' names from the published names, identifiers as the form detects
 * them, the attribution from the contributor's name.
 */
export function ownOccurrence(sighting: OwnSighting, contributor: Pick<Contributor, 'name'>,
  names: ReadonlyMap<string, SpeciesNames> | undefined): Occurrence {
  const species = names?.get(sighting.entity_id);
  return {
    id: sighting.id,
    url: sighting.url,
    attribution: `${contributor.name} on SalishSea.io`,
    body: sighting.body,
    count: sighting.count,
    direction: sighting.direction as Occurrence['direction'],
    location: sighting.location,
    accuracy: null,
    photos: sighting.photos.map(p => ({src: p.src, thumb: null, license: p.license as Occurrence['photos'][number]['license'],
      mimetype: null, attribution: 'someone'})),
    observed_at: sighting.observed_at,
    observed_at_ms: Date.parse(sighting.observed_at),
    observed_from: sighting.observed_from,
    taxon: {
      entity_id: sighting.entity_id,
      species_id: null,
      scientific_name: species?.inaturalist_scientific_name ?? null,
      vernacular_name: species?.common_name ?? species?.taxon_common_name ?? null,
    } as Occurrence['taxon'],
    identifiers: detectIndividuals(sighting.body ?? ''),
    contributor_id: sighting.contributor_id,
    observer: contributor.name,
    collection: null,
    source_url: null,
    organization: null,
    organization_url: null,
    provider: null,
    provider_slug: null,
    observed_until: null,
    certainty: null,
  };
}

/**
 * The day's file rows with the contributor's own sightings laid over them: every file row
 * that is theirs goes (a sighting since deleted or changed must not linger), and their
 * sightings as saved come in, newest first as the files are.
 */
export function overlayOwn<T extends {contributor_id: number | null, observed_at: string}>(
  file: T[], own: T[], contributorId: number): T[] {
  return [...file.filter(o => o.contributor_id !== contributorId), ...own]
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
}
