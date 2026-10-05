/**
 * Saving and deleting a sighting (decision 065, salish-9uu.3.4): Postgres's
 * upsert_observation and its row-level security, ported.
 *
 * A save inserts a sighting the caller owns, or updates one the caller may change: its
 * owner, or an editor. The owner (user and contributor) is stamped when the sighting is
 * made and never changes, so an editor's correction leaves it attributed to whoever saw
 * it. The body is trimmed, and an empty one is none. Photos are the sighting's photos in
 * order, merged by position from 1: a photo at a position kept is updated, one past the
 * end added, one no longer sent removed. `accuracy` is accepted and, as Postgres did,
 * not stored.
 *
 * The browser makes a sighting's id, as it did for Postgres, so a save it retries is the
 * same sighting.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { Me } from './users.ts';

const DIRECTIONS = new Set(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTOS = 20;

export class Refused extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

type LonLat = {lon: number, lat: number};
export type SightingInput = {
    body: string | null,
    count: number | null,
    direction: string | null,
    observed_at: string,
    observed_from: LonLat | null,
    location: LonLat,
    photos: {src: string, license: string}[],
    entity_id: string,
    url: string | null,
};

const bad = (message: string) => new Refused(400, message);

function lonLat(value: unknown, what: string): LonLat {
    const v = value as {lon?: unknown, lat?: unknown} | null;
    if (typeof v !== 'object' || v === null || typeof v.lon !== 'number' || typeof v.lat !== 'number'
        || !Number.isFinite(v.lon) || !Number.isFinite(v.lat) || Math.abs(v.lon) > 180 || Math.abs(v.lat) > 90)
        throw bad(`${what} must be {lon, lat}`);
    return {lon: v.lon, lat: v.lat};
}

const optionalText = (value: unknown, what: string): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw bad(`${what} must be text`);
    return value;
};

/** A request body as a sighting, or a 400 naming what is wrong with it. */
export function parseSighting(body: Record<string, unknown>): SightingInput {
    const observed = typeof body['observed_at'] === 'string' ? new Date(body['observed_at']) : null;
    if (!observed || Number.isNaN(observed.getTime())) throw bad('observed_at must be a time');
    const count = body['count'] ?? null;
    if (count !== null && (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 32767))
        throw bad('count must be a whole number from 1');
    const direction = body['direction'] ?? null;
    if (direction !== null && (typeof direction !== 'string' || !DIRECTIONS.has(direction)))
        throw bad('direction must be a compass point');
    const entity = body['entity_id'];
    if (typeof entity !== 'string' || !/^SSA:[0-9]{7}$/.test(entity)) throw bad('entity_id must be an SSA identifier');
    const photos = body['photos'] ?? [];
    if (!Array.isArray(photos) || photos.length > MAX_PHOTOS) throw bad(`photos must be a list of at most ${MAX_PHOTOS}`);
    return {
        body: optionalText(body['body'], 'body'),
        count: count as number | null,
        direction: direction as string | null,
        observed_at: observed.toISOString(),
        observed_from: body['observed_from'] === undefined || body['observed_from'] === null
            ? null : lonLat(body['observed_from'], 'observed_from'),
        location: lonLat(body['location'], 'location'),
        photos: photos.map((p: unknown, i: number) => {
            const photo = p as {src?: unknown, license?: unknown} | null;
            if (typeof photo !== 'object' || photo === null || typeof photo.src !== 'string'
                || !/^https:\/\/\S+$/.test(photo.src) || typeof photo.license !== 'string' || photo.license === ''
                || photo.license.length > 100)
                throw bad(`photo ${i + 1} must be {src: an https URL, license}`);
            return {src: photo.src, license: photo.license};
        }),
        entity_id: entity,
        url: optionalText(body['url'], 'url'),
    };
}

/** May `who` change the sighting `id`? Its owner may, and any editor. */
function mayChange(store: DatabaseSync, who: Me, id: string): 'absent' | 'yes' | 'no' {
    const row = store.prepare('SELECT user_id FROM observations WHERE id = ?').get(id) as {user_id: string} | undefined;
    if (!row) return 'absent';
    return row.user_id === who.user_id || who.contributor.editor ? 'yes' : 'no';
}

/** Save a sighting as `who`: made if new, changed if theirs to change. */
export function saveSighting(store: DatabaseSync, who: Me, id: string, input: SightingInput, now = new Date()): 'created' | 'updated' {
    if (!UUID.test(id)) throw bad('a sighting id is a UUID');
    const stamp = now.toISOString();
    const body = input.body?.trim() || null;
    store.exec('BEGIN IMMEDIATE');
    try {
        const may = mayChange(store, who, id);
        if (may === 'no') throw new Refused(403, 'only its owner or an editor may change a sighting');
        const values = [input.observed_at, input.location.lon, input.location.lat,
            input.observed_from?.lon ?? null, input.observed_from?.lat ?? null,
            body, input.count, input.url, input.direction, input.entity_id, stamp] as const;
        if (may === 'absent') {
            store.prepare(`INSERT INTO observations
                (observed_at, subject_lon, subject_lat, observer_lon, observer_lat, body, count, url, direction, entity_id,
                 updated_at, id, created_at, contributor_id, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(...values, id, stamp, who.contributor.id, who.user_id);
        } else {
            store.prepare(`UPDATE observations SET
                observed_at = ?, subject_lon = ?, subject_lat = ?, observer_lon = ?, observer_lat = ?, body = ?, count = ?,
                url = ?, direction = ?, entity_id = ?, updated_at = ?
                WHERE id = ?`).run(...values, id);
        }
        // photos by position from 1, as the MERGE in upsert_observation did
        const upsert = store.prepare(`INSERT INTO observation_photos (observation_id, seq, href, license_code) VALUES (?, ?, ?, ?)
            ON CONFLICT (observation_id, seq) DO UPDATE SET href = excluded.href, license_code = excluded.license_code`);
        input.photos.forEach((p, i) => upsert.run(id, i + 1, p.src, p.license));
        store.prepare('DELETE FROM observation_photos WHERE observation_id = ? AND seq > ?').run(id, input.photos.length);
        store.exec('COMMIT');
        return may === 'absent' ? 'created' : 'updated';
    } catch (error) {
        store.exec('ROLLBACK');
        if (error instanceof Error && /CHECK constraint failed/.test(error.message)) throw bad(error.message);
        throw error;
    }
}

/** Delete a sighting as `who`, its photos with it. False if there was none. */
export function deleteSighting(store: DatabaseSync, who: Me, id: string): boolean {
    const may = mayChange(store, who, id);
    if (may === 'absent') return false;
    if (may === 'no') throw new Refused(403, 'only its owner or an editor may delete a sighting');
    store.prepare('DELETE FROM observations WHERE id = ?').run(id);
    return true;
}
