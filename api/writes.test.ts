import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { parseFeedback, rateLimiter, submitFeedback } from './feedback.ts';
import { sender, serve } from './server.ts';
import { mint } from './session.ts';
import { deleteSighting, isoMicros, ownSightings, parseSighting, saveSighting } from './sightings.ts';
import { openStore } from './store/store.ts';
import { me, signIn, type Me } from './users.ts';

let dir: string;
let store: DatabaseSync;
let owner: Me, stranger: Me, editor: Me;
beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'writes-'));
    store = openStore(path.join(dir, 'store.db'));
    const user = (sub: string, name: string) =>
        me(store, signIn(store, {sub, name, email: null, email_verified: false, picture: null}))!;
    owner = user('g1', 'Owner');
    stranger = user('g2', 'Stranger');
    editor = user('g3', 'Editor');
    store.prepare('UPDATE contributors SET editor = 1 WHERE id = ?').run(editor.contributor.id);
    editor = me(store, editor.user_id)!;
});
afterEach(async () => {
    store.close();
    await rm(dir, {recursive: true, force: true});
});

const ID = '01977c2a-b313-77a9-8433-ffccbd56bf57';
const input = (over: Record<string, unknown> = {}) => parseSighting({
    body: '  Three orcas heading north  ', count: 3, direction: 'north', observed_at: '2026-10-05T17:00:00Z',
    observed_from: null, location: {lon: -123.1, lat: 48.5}, entity_id: 'SSA:0000900', url: null, accuracy: 50,
    photos: [{src: 'https://salishsea.io/media/a.jpg', license: 'cc-by'}, {src: 'https://salishsea.io/media/b.jpg', license: 'cc-by'}],
    ...over,
});
const row = () => store.prepare('SELECT * FROM observations WHERE id = ?').get(ID) as Record<string, unknown>;
const photos = () => store.prepare('SELECT seq, href FROM observation_photos WHERE observation_id = ? ORDER BY seq').all(ID);

describe("saving a sighting, as upsert_observation and its row-level security did", () => {
    test('a new sighting is the saver\'s: owner stamped, body trimmed, photos from 1', () => {
        expect(saveSighting(store, owner, ID, input())).toBe('created');
        expect(row()).toMatchObject({user_id: owner.user_id, contributor_id: owner.contributor.id, body: 'Three orcas heading north'});
        expect(photos()).toEqual([{seq: 1, href: 'https://salishsea.io/media/a.jpg'}, {seq: 2, href: 'https://salishsea.io/media/b.jpg'}]);
    });

    test('its owner may change it, a stranger may not, an editor may and leaves the owner as it was', () => {
        saveSighting(store, owner, ID, input());
        expect(saveSighting(store, owner, ID, input({count: 4}))).toBe('updated');
        expect(() => saveSighting(store, stranger, ID, input({count: 9}))).toThrow(/only its owner or an editor/);
        expect(row()['count']).toBe(4);
        saveSighting(store, editor, ID, input({body: 'corrected'}));
        expect(row()).toMatchObject({body: 'corrected', user_id: owner.user_id, contributor_id: owner.contributor.id});
    });

    test('photos merge by position: one kept is updated, one no longer sent removed', () => {
        saveSighting(store, owner, ID, input());
        saveSighting(store, owner, ID, input({photos: [{src: 'https://salishsea.io/media/c.jpg', license: 'cc0'}]}));
        expect(photos()).toEqual([{seq: 1, href: 'https://salishsea.io/media/c.jpg'}]);
    });

    test('an empty body is none, and accuracy is not stored, as Postgres did', () => {
        saveSighting(store, owner, ID, input({body: '   '}));
        expect(row()).toMatchObject({body: null, accuracy: null});
    });

    test.each([
        [{entity_id: 'SSA:900'}, /SSA identifier/],
        [{count: 0}, /whole number/],
        [{direction: 'up'}, /compass point/],
        [{location: {lon: 200, lat: 0}}, /location/],
        [{observed_at: 'yesterday'}, /a time/],
        [{photos: [{src: 'javascript:alert(1)', license: 'cc-by'}]}, /https URL/],
    ])('a sighting that Postgres would refuse is refused: %j', (over, error) => {
        expect(() => input(over)).toThrow(error);
    });

    test("Postgres's varchar limits hold, an empty url is none, and times carry microseconds", () => {
        expect(() => input({body: 'x'.repeat(2001)})).toThrow(/at most 2000/);
        expect(() => input({photos: [{src: 'https://salishsea.io/media/a.jpg', license: 'x'.repeat(21)}]})).toThrow(/https URL, license/);
        saveSighting(store, owner, ID, input({url: '  '}));
        expect(row()).toMatchObject({url: null, observed_at: '2026-10-05T17:00:00.000000Z'});
        expect(isoMicros(new Date('2026-10-05T17:00:00.123Z'))).toBe('2026-10-05T17:00:00.123000Z');
    });

    test('a sighting id must be a UUID', () => {
        expect(() => saveSighting(store, owner, 'not-a-uuid', input())).toThrow(/UUID/);
    });
});

describe('deleting a sighting', () => {
    test('its owner or an editor may; a stranger may not; one that is gone is reported', () => {
        saveSighting(store, owner, ID, input());
        expect(() => deleteSighting(store, stranger, ID)).toThrow(/only its owner or an editor/);
        expect(deleteSighting(store, editor, ID)).toBe(true);
        expect(photos()).toEqual([]);
        expect(deleteSighting(store, owner, ID)).toBe(false);
    });
});

describe("a contributor's own sightings, for the map to lay over the files", () => {
    const OTHER = '01977c2a-b313-77a9-8433-ffccbd56bf58';
    const DAY = ['2026-10-05T07:00:00Z', '2026-10-06T07:00:00Z'] as const;

    test('only theirs, only the span asked, as saved, newest first, with photos in order', () => {
        saveSighting(store, owner, ID, input());
        saveSighting(store, owner, OTHER, input({observed_at: '2026-10-05T19:00:00Z', photos: [], observed_from: {lon: -123.2, lat: 48.6}}));
        saveSighting(store, owner, '01977c2a-b313-77a9-8433-ffccbd56bf59', input({observed_at: '2026-10-04T19:00:00Z'}));
        saveSighting(store, stranger, '01977c2a-b313-77a9-8433-ffccbd56bf5a', input());
        // an editor's correction leaves it the owner's
        saveSighting(store, editor, ID, input({body: 'corrected'}));
        const own = ownSightings(store, owner.contributor.id, ...DAY);
        expect(own.map(s => s.id)).toEqual([OTHER, ID]);
        expect(own[1]).toMatchObject({
            observed_at: '2026-10-05T17:00:00.000000Z', location: {lon: -123.1, lat: 48.5}, observed_from: null,
            body: 'corrected', count: 3, direction: 'north', entity_id: 'SSA:0000900', contributor_id: owner.contributor.id,
            photos: [{src: 'https://salishsea.io/media/a.jpg', license: 'cc-by'}, {src: 'https://salishsea.io/media/b.jpg', license: 'cc-by'}],
        });
        expect(own[0]).toMatchObject({observed_from: {lon: -123.2, lat: 48.6}, photos: []});
        expect(ownSightings(store, editor.contributor.id, ...DAY)).toEqual([]);
    });

    test('a span must be two times in order, and not too long', () => {
        expect(() => ownSightings(store, owner.contributor.id, null, DAY[1])).toThrow(/since and until/);
        expect(() => ownSightings(store, owner.contributor.id, DAY[1], DAY[0])).toThrow(/since the earlier/);
        expect(() => ownSightings(store, owner.contributor.id, '2020-01-01T00:00:00Z', DAY[1])).toThrow(/400 days/);
    });
});

describe('feedback (039)', () => {
    test('trimmed, an empty optional field none, the sender stamped when signed in', () => {
        submitFeedback(store, owner.user_id, parseFeedback({name: ' Ann ', message: ' Hello ', email: ' ', page_url: 'https://salishsea.io/'}));
        submitFeedback(store, null, parseFeedback({name: 'Bob', message: 'Hi'}));
        expect(store.prepare('SELECT name, message, email, page_url, user_id FROM feedback ORDER BY id').all()).toEqual([
            {name: 'Ann', message: 'Hello', email: null, page_url: 'https://salishsea.io/', user_id: owner.user_id},
            {name: 'Bob', message: 'Hi', email: null, page_url: null, user_id: null},
        ]);
    });

    test('no name or message, or one too long, is refused', () => {
        expect(() => parseFeedback({name: ' ', message: 'x'})).toThrow(/a name and a message/);
        expect(() => submitFeedback(store, null, parseFeedback({name: 'x'.repeat(201), message: 'x'}))).toThrow(/too long/);
    });

    test('a sender is held to a few messages in a window', () => {
        const allow = rateLimiter(2, 1000);
        expect([allow('a', 0), allow('a', 1), allow('a', 2), allow('b', 2), allow('a', 1001)]).toEqual([true, true, false, true, true]);
    });
});

describe("a feedback sender is the client's address, as the edge saw it", () => {
    const req = (headers: Record<string, string>) => ({headers, socket: {remoteAddress: '10.0.0.1'}}) as never;
    test("CloudFront's viewer address only with CloudFront's secret; otherwise Fly's client address", () => {
        expect(sender(req({'cloudfront-viewer-address': '203.0.113.5:443', 'x-origin-verify': 's3cret'}), 's3cret')).toBe('203.0.113.5');
        // forged: anyone reaching the Fly app directly could send the header
        expect(sender(req({'cloudfront-viewer-address': '203.0.113.5:443', 'fly-client-ip': '198.51.100.9'}), 's3cret')).toBe('198.51.100.9');
        expect(sender(req({'cloudfront-viewer-address': '203.0.113.5:443', 'x-origin-verify': 'guess', 'fly-client-ip': '198.51.100.9'}), 's3cret')).toBe('198.51.100.9');
        expect(sender(req({'x-forwarded-for': '1.2.3.4'}))).toBe('10.0.0.1');
    });
});

describe('the writes over HTTP', () => {
    test('signed out is 401; a save is 201 then 200 and wakes the build; feedback is open; a flood is 429', async () => {
        let woken = 0;
        const key = Buffer.alloc(32, 2);
        const server = serve({store, key, keys: async () => new Map(), origins: new Set(['https://salishsea.io']),
            changed: () => { woken++; }, feedbackAllowed: rateLimiter(1, 60_000)}, 0);
        await new Promise(r => server.once('listening', r));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const session = `salishsea_session=${mint(key, owner.user_id, 0)}`;
        const put = (cookie?: string) => fetch(`${base}/api/sightings/${ID}`, {
            method: 'PUT',
            headers: {'content-type': 'application/json', origin: 'https://salishsea.io', ...(cookie ? {cookie} : {})},
            body: JSON.stringify({observed_at: '2026-10-05T17:00:00Z', location: {lon: -123.1, lat: 48.5}, entity_id: 'SSA:0000900'}),
        });
        const feedback = () => fetch(`${base}/api/feedback`, {
            method: 'POST', headers: {'content-type': 'application/json', origin: 'https://salishsea.io'},
            body: JSON.stringify({name: 'Ann', message: 'Hi'}),
        });
        try {
            expect((await put()).status).toBe(401);
            expect((await put(session)).status).toBe(201);
            expect((await put(session)).status).toBe(200);
            expect(woken).toBe(2);
            const del = await fetch(`${base}/api/sightings/${ID}`, {method: 'DELETE', headers: {origin: 'https://salishsea.io', cookie: session}});
            expect(del.status).toBe(200);
            expect(woken).toBe(3);
            const span = 'since=2026-10-05T07:00:00Z&until=2026-10-06T07:00:00Z';
            expect((await fetch(`${base}/api/sightings?${span}`)).status).toBe(401);
            const mine = await fetch(`${base}/api/sightings?${span}`, {headers: {cookie: session}});
            expect(mine.status).toBe(200);
            expect(await mine.json()).toEqual({sightings: []});
            expect((await fetch(`${base}/api/sightings?since=x&until=y`, {headers: {cookie: session}})).status).toBe(400);
            expect((await feedback()).status).toBe(201);
            expect((await feedback()).status).toBe(429);
            const malformed = await fetch(`${base}/api/sightings/%E0%A4%A`, {method: 'DELETE', headers: {origin: 'https://salishsea.io', cookie: session}});
            expect(malformed.status).toBe(400);
        } finally {
            server.close();
        }
    });
});
