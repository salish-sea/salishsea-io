/**
 * The cutover's photo move (decision 065, salish-9uu.3.8): every photo a sighting keeps
 * in Supabase Storage, from the nightly backup's mirror of that bucket (decision 038)
 * into the photo bucket, under the folders the write API uses, and the sighting's URL
 * rewritten to salishsea.io/media/. Photos anywhere else (older S3 buckets, iNaturalist)
 * are left as they are.
 *
 *   node api/store/move-photos.ts <store.db> plan     a TSV: backup key, photo key, content type
 *   node api/store/move-photos.ts <store.db> rewrite  the store's URLs rewritten, in one transaction
 *
 * The copy itself is the AWS CLI's, between the two buckets, with an identity that can
 * read the backups (the store-writer can't): see docs/runbook/read-path-build.md.
 *
 * Supabase kept a photo at <user uuid>/<sighting>/<file>; the API keeps it at
 * media/<contributor>/<sighting>/<file>, so a user's folder becomes their contributor's.
 * The sighting segment is the folder's, not the row's: a cloned sighting points at the
 * photos of the one it was cloned from.
 */

import type { DatabaseSync } from 'node:sqlite';

import { openStore } from './store.ts';

export const SUPABASE_MEDIA = 'https://grztmjpzamcxlzecmqca.supabase.co/storage/v1/object/public/media/';
export const SITE_MEDIA = 'https://salishsea.io/media/';

export type Move = {from: string, to: string, type: string};

const TYPES: Record<string, string> = {jpg: 'image/jpeg', jpeg: 'image/jpeg', jp2: 'image/jp2'};

/** Where each Supabase-kept photo goes, one per distinct object. Throws on one it can't place. */
export function planMoves(store: DatabaseSync): Move[] {
    const hrefs = store.prepare('SELECT DISTINCT href FROM observation_photos WHERE substr(href, 1, ?) = ? ORDER BY href')
        .all(SUPABASE_MEDIA.length, SUPABASE_MEDIA) as {href: string}[];
    const contributorOf = store.prepare('SELECT contributor_id FROM users WHERE id = ?');
    return hrefs.map(({href}) => {
        const path = href.slice(SUPABASE_MEDIA.length);
        const [user, sighting, ...rest] = path.split('/');
        const file = rest.join('/');
        if (!user || !sighting || !file) throw new Error(`${href}: not <user>/<sighting>/<file>`);
        const row = contributorOf.get(user) as {contributor_id: number} | undefined;
        if (!row) throw new Error(`${href}: user ${user} is not in the store`);
        const type = TYPES[file.split('.').pop()!.toLowerCase()];
        if (!type) throw new Error(`${href}: not a JPEG or JPEG 2000 by its name`);
        return {from: `media/${path}`, to: `media/${row.contributor_id}/${sighting}/${file}`, type};
    });
}

/** Rewrite every Supabase-kept photo's URL to its place at salishsea.io/media/. Returns how many rows. */
export function rewriteHrefs(store: DatabaseSync): number {
    const moves = planMoves(store);
    const update = store.prepare('UPDATE observation_photos SET href = ? WHERE href = ?');
    let rows = 0;
    store.exec('BEGIN IMMEDIATE');
    try {
        for (const {from, to} of moves)
            rows += Number(update.run(`${SITE_MEDIA}${to.slice('media/'.length)}`, `${SUPABASE_MEDIA}${from.slice('media/'.length)}`).changes);
        store.exec('COMMIT');
    } catch (error) {
        store.exec('ROLLBACK');
        throw error;
    }
    return rows;
}

if (import.meta.main) {
    const [file, mode] = process.argv.slice(2);
    if (!file || (mode !== 'plan' && mode !== 'rewrite')) {
        console.error('usage: move-photos.ts <store.db> plan|rewrite');
        process.exit(2);
    }
    const store = openStore(file);
    try {
        if (mode === 'plan') for (const m of planMoves(store)) console.log(`${m.from}\t${m.to}\t${m.type}`);
        else console.error(`rewrote ${rewriteHrefs(store)} photo URLs`);
    } finally {
        store.close();
    }
}
