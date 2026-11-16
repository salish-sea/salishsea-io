/**
 * Receiving a post sent from Facebook, against a real store and a real directory, on
 * made-up posts in the shape of Facebook's markup of November 2026.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { KEEP_READ_MS, KEEP_UNREADABLE_MS, parseSend, receiveSend, sweepSends } from './facebook-sends.ts';
import { rateLimiter } from './feedback.ts';
import { serve } from './server.ts';
import { mint } from './session.ts';
import { openStore } from './store/store.ts';
import { me, signIn, type Me } from './users.ts';

const GROUP = '564701038927716';
const POST = '1490225183041959';
const PAGE = `https://www.facebook.com/groups/${GROUP}/posts/${POST}/`;
const permalink = (c: number, post = POST, group = GROUP) =>
    `<a href="https://www.facebook.com/groups/${group}/posts/${post}/?comment_id=${c}&amp;__cft__=x">2h</a>`;
const html = (comments = `<div role="article" aria-label="Comment by Pat Example 2 hours ago">${permalink(101)}<div dir="auto">1145 off Alki</div></div>`) =>
    `<div role="dialog"><div dir="auto">Monday, November 16th - ORCAS (Puget Sound)</div>${comments}</div>`;
const UNREADABLE = html(`<div role="article" aria-label="Kommentar von Pat Example">${permalink(101)}<div dir="auto">x</div></div>`);

let dir: string, sends: string;
let store: DatabaseSync;
let sender: Me, stranger: Me;
beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'facebook-sends-'));
    sends = path.join(dir, 'sends');
    store = openStore(path.join(dir, 'store.db'));
    sender = me(store, signIn(store, {sub: 'g1', name: 'Sender', email: null, email_verified: false, picture: null}))!;
    stranger = me(store, signIn(store, {sub: 'g2', name: 'Stranger', email: null, email_verified: false, picture: null}))!;
    store.prepare('UPDATE contributors SET facebook_sender = 1 WHERE id = ?').run(sender.contributor.id);
});
afterEach(async () => {
    store.close();
    await rm(dir, {recursive: true, force: true});
});

const NOW = new Date('2026-11-16T20:00:00Z');
const input = (over: {html?: string, url?: string, capturedAt?: Date} = {}) =>
    ({html: html(), url: PAGE, capturedAt: new Date(NOW.getTime() - 5000), ...over});
const rows = () => store.prepare('SELECT * FROM facebook_sends ORDER BY id').all() as Record<string, unknown>[];
const feedback = () => store.prepare('SELECT message FROM feedback').all() as {message: string}[];

describe('parseSend', () => {
    const body = (sentAt: string) => ({html: '<div></div>', url: PAGE, sent_at: sentAt});
    test('takes the time the bookmarklet took the post', () => {
        expect(parseSend(body('2026-11-16T19:55:00Z'), NOW).capturedAt).toEqual(new Date('2026-11-16T19:55:00Z'));
    });
    test('refuses a post taken more than ten minutes before, or later than a minute after', () => {
        expect(() => parseSend(body('2026-11-16T19:49:00Z'), NOW)).toThrow(/send it again/);
        expect(() => parseSend(body('2026-11-16T20:02:00Z'), NOW)).toThrow(/future/);
    });
    test('refuses what isn\'t a send', () => {
        expect(() => parseSend({html: '', url: PAGE, sent_at: NOW.toISOString()}, NOW)).toThrow(/send \{html, url, sent_at\}/);
        expect(() => parseSend(body('yesterday'), NOW)).toThrow(/not a time/);
    });
});

describe('receiveSend', () => {
    test('a readable post is recorded, its HTML kept gzipped, and the sender told what was read', async () => {
        const answer = await receiveSend(store, sends, sender, input(), NOW);
        expect(answer).toEqual({status: 201, body: {send_id: 1, post_id: POST, lines: 1, comments: 1, collapsed: 0, sort: null}});
        const [row] = rows();
        expect(row).toMatchObject({user_id: sender.user_id, group_id: GROUP, post_id: POST, lines: 1, comments: 1, error: null,
            received_at: '2026-11-16T20:00:00.000000Z', captured_at: '2026-11-16T19:59:55.000000Z'});
        expect(await readdir(sends)).toEqual([row!['file']]);
        expect(gunzipSync(await readFile(path.join(sends, row!['file'] as string))).toString()).toBe(html());
        expect(feedback()).toEqual([]);
    });

    test('a post opened over the group\'s feed is known by its comments\' permalinks', async () => {
        const answer = await receiveSend(store, sends, sender, input({url: `https://www.facebook.com/groups/${GROUP}/`}), NOW);
        expect(answer.status).toBe(201);
        expect(rows()[0]).toMatchObject({group_id: GROUP, post_id: POST});
    });

    test('a group known by its chosen name in the address is known by its number in the permalinks', async () => {
        const answer = await receiveSend(store, sends, sender, input({url: `https://www.facebook.com/groups/orcanetwork/posts/${POST}/`}), NOW);
        expect(answer.status).toBe(201);
    });

    test('refuses another group\'s post, and keeps nothing of it', async () => {
        await expect(receiveSend(store, sends, sender, input({
            html: html(`<div role="article" aria-label="Comment by Pat Example 2 hours ago">${permalink(1, '9', '42')}<div dir="auto">x</div></div>`),
            url: 'https://www.facebook.com/groups/42/posts/9/',
        }), NOW)).rejects.toThrow(/reads only the Orca Network Community Group/);
        expect(rows()).toEqual([]);
        await expect(readdir(sends)).rejects.toThrow();
    });

    test('refuses an address and permalinks that name different posts', async () => {
        await expect(receiveSend(store, sends, sender, input({url: `https://www.facebook.com/groups/${GROUP}/posts/1/`}), NOW))
            .rejects.toThrow(/different post/);
    });

    test('refuses a readable post with no comments over the feed, whose id it can\'t tell', async () => {
        await expect(receiveSend(store, sends, sender, input({html: html(''), url: `https://www.facebook.com/groups/${GROUP}/`}), NOW))
            .rejects.toThrow(/open the post on its own page/);
    });

    test('an unreadable post is kept, answered 422, and reported once a day', async () => {
        const answer = await receiveSend(store, sends, sender, input({html: UNREADABLE}), NOW);
        expect(answer).toMatchObject({status: 422, body: {send_id: 1, error: expect.stringMatching(/couldn't read this post: an article's label/)}});
        expect(rows()[0]).toMatchObject({lines: null, comments: null, post_id: POST, error: expect.stringMatching(/^an article's label/)});
        expect((await readdir(sends))[0]).toMatch(/-unreadable-/);
        await receiveSend(store, sends, sender, input({html: UNREADABLE}), new Date(NOW.getTime() + 3_600_000));
        expect(feedback()).toHaveLength(1);
        expect(feedback()[0]!.message).not.toMatch(/Pat|Example/);
        await receiveSend(store, sends, sender, input({html: UNREADABLE, capturedAt: new Date(NOW.getTime() + 25 * 3_600_000)}),
            new Date(NOW.getTime() + 25 * 3_600_000));
        expect(feedback()).toHaveLength(2);
    });
});

describe('sweepSends', () => {
    const file = async (name: string, ageMs: number, bytes = 10) => {
        await writeFile(path.join(sends, name), Buffer.alloc(bytes));
        const t = new Date(NOW.getTime() - ageMs);
        await utimes(path.join(sends, name), t, t);
    };
    test('keeps a read send a week and an unreadable one a month; deletes a stray temporary file after an hour', async () => {
        await mkdir(sends);
        await file('a-1-read-x.html.gz', KEEP_READ_MS - 1000);
        await file('b-1-read-x.html.gz', KEEP_READ_MS + 1000);
        await file('c-1-unreadable-x.html.gz', KEEP_READ_MS + 1000);
        await file('d-1-unreadable-x.html.gz', KEEP_UNREADABLE_MS + 1000);
        await file('e.html.gz.tmp', 2 * 3_600_000);
        expect(await sweepSends(sends, NOW)).toBe(3);
        expect((await readdir(sends)).sort()).toEqual(['a-1-read-x.html.gz', 'c-1-unreadable-x.html.gz']);
    });

    test('deletes the oldest beyond the cap', async () => {
        await mkdir(sends);
        await file('old-read-x.html.gz', 3000, 100);
        await file('mid-unreadable-x.html.gz', 2000, 100);
        await file('new-read-x.html.gz', 1000, 100);
        expect(await sweepSends(sends, NOW, 250)).toBe(1);
        expect((await readdir(sends)).sort()).toEqual(['mid-unreadable-x.html.gz', 'new-read-x.html.gz']);
    });

    test('a directory not made yet has nothing to sweep', async () => {
        expect(await sweepSends(sends, NOW)).toBe(0);
    });
});

describe('POST /api/facebook-posts', () => {
    test('401 signed out, 403 not a sender, 201 read, 422 not, 413 too large, 429 a flood', async () => {
        const key = Buffer.alloc(32, 2);
        const server = serve({store, key, keys: async () => new Map(), origins: new Set(['https://salishsea.io']),
            facebookSends: {dir: sends, allowed: rateLimiter(3, 60_000)}}, 0);
        await new Promise(r => server.once('listening', r));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const post = (who: Me | null, body: unknown) => fetch(`${base}/api/facebook-posts`, {
            method: 'POST',
            headers: {'content-type': 'application/json', origin: 'https://salishsea.io',
                ...(who ? {cookie: `salishsea_session=${mint(key, who.user_id, 0)}`} : {})},
            body: JSON.stringify(body),
        });
        const send = (h = html()) => ({html: h, url: PAGE, sent_at: new Date().toISOString()});
        try {
            expect((await post(null, send())).status).toBe(401);
            expect((await post(stranger, send())).status).toBe(403);
            const read = await post(sender, send());
            expect([read.status, await read.json()]).toEqual([201, {send_id: 1, post_id: POST, lines: 1, comments: 1, collapsed: 0, sort: null}]);
            expect((await post(sender, send(UNREADABLE))).status).toBe(422);
            expect((await post(sender, send('x'.repeat(3 * 1024 * 1024)))).status).toBe(413);
            expect((await post(sender, send())).status).toBe(201);
            expect((await post(sender, send())).status).toBe(429);
        } finally {
            server.close();
        }
    });

    test('503 when nowhere to keep sends is configured', async () => {
        const key = Buffer.alloc(32, 2);
        const server = serve({store, key, keys: async () => new Map(), origins: new Set(['https://salishsea.io'])}, 0);
        await new Promise(r => server.once('listening', r));
        try {
            const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/facebook-posts`, {
                method: 'POST',
                headers: {'content-type': 'application/json', origin: 'https://salishsea.io',
                    cookie: `salishsea_session=${mint(key, sender.user_id, 0)}`},
                body: JSON.stringify({html: html(), url: PAGE, sent_at: new Date().toISOString()}),
            });
            expect(res.status).toBe(503);
        } finally {
            server.close();
        }
    });
});
