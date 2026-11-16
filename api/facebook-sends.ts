/**
 * Posts sent from a Facebook group (decision 117, bd salish-i1a.3.3): a sender clicks the
 * bookmarklet on the day's post, and the window it opens on salishsea.io sends the post's
 * HTML here. Only a contributor marked as a sender may send (005-facebook-sends.sql), and
 * only a post of a group we read.
 *
 * Each send is read at once (facebook-post.ts), so the sender learns in the window whether
 * it worked: a post that can't be read answers 422, and the first such send in a day also
 * files an issue through the feedback notifier, since Facebook has probably changed its
 * markup and every send will fail until the reader is fixed.
 *
 * The HTML is kept as a gzipped file in a directory of its own, so that a fixed reader can
 * be run over recent sends again: a week for a send that was read, a month for one that
 * couldn't be, since that is the one a fix is for, and never more than MAX_KEPT_BYTES in
 * all. Not in the store: a busy post is 700 KB, and the build copies the whole store every
 * five minutes, while Litestream keeps its pages for 30 days. A file also holds what the
 * store needn't: the comments of members who report nothing, and the sender's own name in
 * Facebook's page around the post.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';

import { NotOnePost, permalinkAddress, postAddress, readFacebookPost, UnreadablePost, type FacebookPost } from './facebook-post.ts';
import { isoMicros, Refused } from './sightings.ts';
import type { Me } from './users.ts';

const gzip = promisify(gzipCallback);

/** The groups whose posts we read: the Orca Network Community Group, with Orca Network's agreement (117). */
export const READ_GROUPS: ReadonlySet<string> = new Set(['564701038927716']);

/** The largest request: the biggest post sent to the demo was 701 KB, which took 113 ms to read on Maderas. */
export const MAX_SEND_BYTES = 2 * 1024 * 1024;

const DAY_MS = 86_400_000;
export const KEEP_READ_MS = 7 * DAY_MS;
export const KEEP_UNREADABLE_MS = 30 * DAY_MS;
/** At most this much HTML in all, gzipped: about 2,000 sends. The volume had 985 MB free on 2026-11-16. */
export const MAX_KEPT_BYTES = 200 * 1024 * 1024;

/**
 * How far the time the bookmarklet took the post, by the sender's clock, may be from when
 * it arrives. Ten minutes allows for a sender who has to sign in first, or a clock that is
 * a few minutes out; beyond that, Facebook's "2 hours ago" would be counted from a moment
 * we can't trust, so the sender is asked to send again.
 */
const CAPTURED_WITHIN_MS = 10 * 60_000;

/** The name an unreadable send is reported under, in the feedback table; the issue doesn't show it. */
const REPORTER = 'SalishSea.io write API';

export type SendInput = {html: string, url: string, capturedAt: Date};

export type SendAnswer =
    | {status: 201, body: {send_id: number, post_id: string, lines: number, comments: number, collapsed: number, sort: string | null}}
    | {status: 422, body: {send_id: number, error: string}};

export function isFacebookSender(store: DatabaseSync, who: Me): boolean {
    const row = store.prepare('SELECT facebook_sender FROM contributors WHERE id = ?').get(who.contributor.id) as
        {facebook_sender: number} | undefined;
    return row?.facebook_sender === 1;
}

/** What the window sent: {html, url, sent_at}, sent_at being when the bookmarklet took the post. */
export function parseSend(body: Record<string, unknown>, receivedAt: Date): SendInput {
    const {html, url, sent_at: sentAt} = body;
    if (typeof html !== 'string' || !html || typeof url !== 'string' || !url || typeof sentAt !== 'string')
        throw new Refused(400, 'send {html, url, sent_at}');
    if (url.length > 2000) throw new Refused(400, 'the address is too long');
    const capturedAt = new Date(sentAt);
    if (Number.isNaN(capturedAt.getTime())) throw new Refused(400, 'sent_at is not a time');
    const early = receivedAt.getTime() - capturedAt.getTime();
    if (early > CAPTURED_WITHIN_MS) throw new Refused(400, 'this post was taken from Facebook more than ten minutes ago: send it again');
    if (early < -CAPTURED_WITHIN_MS) throw new Refused(400, 'sent_at is in the future: check the clock of the computer that sent it');
    return {html, url, capturedAt};
}

/**
 * Read a send, keep its HTML and record it. Refuses a post of a group we don't read, and a
 * readable post whose id it can't tell; keeps an unreadable one whose group it can tell.
 */
export async function receiveSend(store: DatabaseSync, dir: string, who: Me, input: SendInput,
    receivedAt: Date): Promise<SendAnswer> {
    // "2 hours ago" counts back from when the post was taken, by the sender's clock; a
    // clock that is a little fast must not date comments in the future.
    const takenAt = Math.min(input.capturedAt.getTime(), receivedAt.getTime());
    let read: FacebookPost | null = null;
    let error: string | null = null;
    try {
        read = readFacebookPost(input.html, Math.floor(takenAt / 1000));
    } catch (e) {
        if (e instanceof NotOnePost) throw new Refused(400, 'this page shows more than one post: open the post itself, and send it again');
        if (!(e instanceof UnreadablePost)) throw e;
        error = e.message;
    }

    // The comments' permalinks say which post this is better than the page's address,
    // which is the feed when the post was opened over it, and may name the group by a
    // chosen name rather than its number. The address is the fallback, and must agree.
    // A post that can't be read still has permalinks, read from its text.
    const fromUrl = postAddress(input.url);
    const fromPermalinks = read ? read.address : permalinkAddress(input.html);
    if (fromPermalinks && fromUrl && fromPermalinks.post !== fromUrl.post)
        throw new Refused(400, 'the page\'s address names a different post from its comments');
    const group = fromPermalinks?.group ?? fromUrl?.group ?? groupIn(input.url);
    const postId = fromPermalinks?.post ?? fromUrl?.post ?? null;
    if (!group || !READ_GROUPS.has(group))
        throw new Refused(400, 'SalishSea.io reads only the Orca Network Community Group, from the post\'s own page');
    if (read && !postId) throw new Refused(400, 'open the post on its own page, and send it again');
    // Over the feed, the bookmarklet takes the post's dialog; without one it took the whole
    // feed, whose lines are every post's.
    if (!fromUrl && !/^\s*<\w+[^>]*\brole="dialog"/.test(input.html))
        throw new Refused(400, 'open the post on its own page, and send it again');

    const html = Buffer.from(input.html, 'utf8');
    const file = `${receivedAt.toISOString().replace(/[-:]|\.\d+/g, '')}-${postId ?? 'unknown'}-${read ? 'read' : 'unreadable'}-${randomUUID().slice(0, 8)}.html.gz`;
    // Written whole and then renamed, so a file is either all there or not at all; a file
    // whose row never lands is deleted with the others by its age.
    await mkdir(dir, {recursive: true});
    const temporary = path.join(dir, `${file}.tmp`);
    await writeFile(temporary, await gzip(html));
    await rename(temporary, path.join(dir, file));

    // The row, and whether this is the day's first report of an unreadable send, together:
    // with nothing awaited between them, two sends at once can't each leave it to the other.
    let id: number;
    store.exec('BEGIN IMMEDIATE');
    try {
        const report = error !== null && !reportedSince(store, new Date(receivedAt.getTime() - DAY_MS));
        ({id} = store.prepare(`INSERT INTO facebook_sends (received_at, captured_at, user_id, url, group_id, post_id,
                html_bytes, html_sha256, file, lines, comments, error, reported)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(
            isoMicros(receivedAt), isoMicros(input.capturedAt), who.user_id, input.url, group, postId,
            html.length, createHash('sha256').update(html).digest('hex'), file,
            read?.lines.length ?? null, read?.comments.length ?? null, error, report ? 1 : 0) as {id: number});
        if (report) reportUnreadable(store, error!, receivedAt);
        store.exec('COMMIT');
    } catch (e) {
        store.exec('ROLLBACK');
        throw e;
    }

    // Each write is followed by a sweep, so the cap holds however fast sends come.
    await sweepSends(dir, receivedAt).catch(e => console.error('api: sweeping sent posts:', e));

    if (!read) {
        return {status: 422, body: {send_id: id, error: `SalishSea.io couldn't read this post: ${error}. Facebook may have changed its page; we've been told.`}};
    }
    return {status: 201, body: {send_id: id, post_id: postId!, lines: read.lines.length, comments: read.comments.length,
        collapsed: read.collapsed, sort: read.sort}};
}

/** The group a page on Facebook belongs to, from /groups/<group>/…, for a page that isn't a post's. */
function groupIn(url: string): string | null {
    try {
        const u = new URL(url);
        if (!/^(www\.|web\.|m\.)?facebook\.com$/.test(u.hostname)) return null;
        return /^\/groups\/([\w.]+)(\/|$)/.exec(u.pathname)?.[1] ?? null;
    } catch {
        return null;
    }
}

/**
 * Whether an unreadable send has been reported since `since`. Known by the sends that were
 * reported, not by feedback, which anyone may write under any name, nor by every unreadable
 * send, which would let unreported ones put the next report off for ever.
 */
function reportedSince(store: DatabaseSync, since: Date): boolean {
    return store.prepare('SELECT 1 FROM facebook_sends WHERE reported = 1 AND received_at > ?').get(isoMicros(since)) !== undefined;
}

/**
 * Feedback, which the notifier files as a public GitHub issue, for the first unreadable
 * send in a day. The message carries the reader's error, which names no member.
 */
function reportUnreadable(store: DatabaseSync, error: string, now: Date): void {
    store.prepare('INSERT INTO feedback (created_at, name, message) VALUES (?, ?, ?)').run(isoMicros(now), REPORTER,
        `A post sent from Facebook couldn't be read: ${error}. Facebook has probably changed its markup, so every send ` +
        'will fail until api/facebook-post.ts is fixed (bd salish-i1a.3.4). The sends are kept on the Fly volume, under ' +
        '/data/facebook-sends, for 30 days; facebook_sends in the store lists them. Further failures today are not reported.');
}

/**
 * Delete the HTML no longer kept: a read send's after KEEP_READ_MS, an unreadable one's
 * after KEEP_UNREADABLE_MS, and then the oldest until at most MAX_KEPT_BYTES remain. By the
 * files in the directory, so a file whose row never landed goes too. Returns how many it deleted.
 */
export async function sweepSends(dir: string, now = new Date(), maxBytes = MAX_KEPT_BYTES): Promise<number> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw e;
    }
    const files = [];
    for (const name of names) {
        let mtimeMs: number, size: number;
        try {
            ({mtimeMs, size} = await stat(path.join(dir, name)));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; // renamed or deleted since the listing
            throw e;
        }
        const keep = name.endsWith('.tmp') ? 3_600_000 : name.includes('-unreadable-') ? KEEP_UNREADABLE_MS : KEEP_READ_MS;
        files.push({name, mtimeMs, size, expired: now.getTime() - mtimeMs > keep});
    }
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let total = files.reduce((sum, f) => sum + (f.expired ? 0 : f.size), 0);
    let deleted = 0;
    for (const f of files) {
        if (!f.expired && total <= maxBytes) continue;
        if (!f.expired) total -= f.size;
        await rm(path.join(dir, f.name), {force: true});
        deleted++;
    }
    return deleted;
}
