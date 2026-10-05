/**
 * A photo for a sighting (decision 065, salish-9uu.3.4): what Supabase's `media` bucket
 * and its storage policies did, ported. A signed-in contributor sends the image's bytes;
 * the API checks them, puts them in the photo bucket under the contributor's folder and
 * the sighting's, and answers with the photo's URL at salishsea.io/media/, which the
 * sighting then carries when it is saved.
 *
 * Supabase's limits hold: JPEG or JPEG 2000, at most 8 MiB. The type is read from the
 * bytes as well as the request's Content-Type, and the two must agree, so a file is
 * stored as what it is. A contributor writes only under their own folder, as the storage
 * policy kept each user to theirs; the same name for the same sighting replaces the
 * photo, as Supabase's upsert did (the bucket keeps the old version a year).
 *
 * Uploading a photo changes no sighting, so it wakes no build: the save that follows
 * does.
 */

import { randomUUID } from 'node:crypto';

import { Refused } from './sightings.ts';

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** As Supabase was asked to serve them: three days. */
export const PHOTO_CACHE_CONTROL = 'max-age=259200';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JP2_SIGNATURE = Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);

/** What the bytes are, by their signature, or null if neither JPEG nor JPEG 2000. */
export function sniff(bytes: Uint8Array): 'image/jpeg' | 'image/jp2' | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= JP2_SIGNATURE.length && JP2_SIGNATURE.equals(bytes.subarray(0, JP2_SIGNATURE.length))) return 'image/jp2';
    return null;
}

/**
 * A file name as the browser always made it: trimmed, every character but letters,
 * digits, `-`, `.` and `_` made `_`, lower case. One with no letter or digit in it (`..`
 * among them, which a URL would resolve away) is replaced by a fresh one.
 */
export function photoName(name: string | null, type: 'image/jpeg' | 'image/jp2'): string {
    const clean = (name ?? '').trim().replace(/[^-a-z0-9._]/gi, '_').toLowerCase().slice(-200);
    if (/[a-z0-9]/.test(clean)) return clean;
    return `${randomUUID()}.${type === 'image/jpeg' ? 'jpg' : 'jp2'}`;
}

/** Where a contributor's photos of a sighting go: under media/, their folder, then the sighting's. */
export function photoFolder(contributorId: number, sightingId: string): string {
    if (!UUID.test(sightingId)) throw new Refused(400, 'a sighting id is a UUID');
    return `media/${contributorId}/${sightingId.toLowerCase()}`;
}

/** The checked photo: its type, from its bytes and agreeing with what the sender said. */
export function photoType(declared: string | undefined, bytes: Uint8Array): 'image/jpeg' | 'image/jp2' {
    const said = (declared ?? '').split(';')[0]!.trim().toLowerCase();
    if (said !== 'image/jpeg' && said !== 'image/jp2') throw new Refused(415, 'a photo is a JPEG or a JPEG 2000');
    if (bytes.length === 0) throw new Refused(400, 'the photo is empty');
    const is = sniff(bytes);
    if (is !== said) throw new Refused(415, `the photo is not the ${said} it says it is`);
    return is;
}
