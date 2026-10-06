/**
 * The write API (decision 065), from the browser: what a signed-in contributor does,
 * sent to salishsea.io/api/ instead of Supabase, when the build sets
 * VITE_WRITE_SOURCE=api (salish-9uu.3.7). Unset, everything goes to Supabase as before.
 *
 * Same origin as the page, so the session cookie the API sets travels with every call
 * and the CSP's connect-src 'self' already admits it.
 */

import { readSource, type ReadSource } from './read-path.ts';
import type { Occurrence, UpsertObservationArgs } from './types.ts';

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

import type { OwnSighting } from './own-occurrence.ts';
export { ownOccurrence, type OwnSighting, type SpeciesNames } from './own-occurrence.ts';

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
    return await call<Me | null>('GET', '/api/me');
  } catch (error) {
    // An API from before null meant signed out answered 401.
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Sign in with Google's ID token and the raw nonce whose hash Google signed (030). */
export const signIn = (credential: string, nonce: string) => call<Me>('POST', '/api/session', {json: {credential, nonce}});

/** Sign out: the API ends every session the user has. */
export const signOut = () => call<unknown>('DELETE', '/api/session');

/**
 * What the API reads of a sighting the form saves. Each photo goes as its URL and license
 * alone: the form also carries a thumbnail, which is the whole image as a data URL, and
 * would take a save with one photo past the API's 64 KB limit on a request.
 */
export function sightingBody(sighting: UpsertObservationArgs) {
  const {body, count, direction, observed_at, observed_from, location, entity_id, url, photos} = sighting;
  return {body, count, direction, observed_at, observed_from, location, entity_id, url,
    photos: photos.map(({src, license}) => ({src, license}))};
}

export const saveSighting = (sighting: UpsertObservationArgs) =>
  call<{id: string, outcome: 'created' | 'updated'}>('PUT', `/api/sightings/${encodeURIComponent(sighting.id)}`,
    {json: sightingBody(sighting)});

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
 * A sighting anyone may read by id, as the build will publish it (salish-9uu.5): for a
 * `?o=` link to one saved since the last build, which no file holds yet. Null when the
 * API has no such sighting (404), or when the id is no sighting id at all (400: a native
 * id is a uuid) — both the quiet "we don't have it" the link has always fallen back to;
 * any other failure throws, as a file read's does.
 */
export async function fetchPublicSighting(id: string): Promise<Occurrence | null> {
  try {
    return (await call<{occurrence: Occurrence}>('GET', `/api/sightings/${encodeURIComponent(id)}`)).occurrence;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
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
