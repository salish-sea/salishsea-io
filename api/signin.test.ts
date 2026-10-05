import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { nonceHash, verifyIdToken, type KeySource } from './google.ts';
import { serve } from './server.ts';
import { mint, verifySession } from './session.ts';
import { openStore } from './store/store.ts';
import { me, signIn } from './users.ts';

const CLIENT = 'test-client.apps.googleusercontent.com';
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const other = generateKeyPairSync('rsa', {modulusLength: 2048});
const keys: KeySource = async () => new Map([['k1', {...publicKey.export({format: 'jwk'}), kid: 'k1', alg: 'RS256'}]]);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>, {kid = 'k1', alg = 'RS256', key = privateKey}: {kid?: string, alg?: string, key?: KeyObject} = {}) {
    const head = `${b64({alg, kid, typ: 'JWT'})}.${b64(claims)}`;
    return `${head}.${sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
}
const now = Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
    iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234', exp: now + 600, iat: now,
    nonce: nonceHash('raw-nonce'), email: 'scott@example.org', email_verified: true, name: 'Scott', picture: 'https://p/1',
    ...over,
});
const verifyAs = (t: string, nonce = 'raw-nonce') => verifyIdToken(t, nonce, keys, {clientId: CLIENT});

describe("a Google ID token (decision 065, 030's nonce)", () => {
    test('a token Google signed for us, unexpired and bound to our nonce, names who signed in', async () => {
        await expect(verifyAs(token(claims()))).resolves.toMatchObject({sub: '1234', email_verified: true, name: 'Scott'});
    });

    test.each([
        ['another client', claims({aud: 'someone-else'}), /another client/],
        ['expired', claims({exp: now - 3600}), /expired/],
        ['another issuer', claims({iss: 'https://evil.example'}), /not issued by Google/],
        ['another nonce', claims({nonce: nonceHash('other')}), /nonce/],
        ['no subject', claims({sub: ''}), /no subject/],
    ])('is refused if issued for %s', async (_, c, error) => {
        await expect(verifyAs(token(c))).rejects.toThrow(error);
    });

    test("is refused if not signed by Google's current key, or not RS256", async () => {
        await expect(verifyAs(token(claims(), {key: other.privateKey}))).rejects.toThrow(/bad signature/);
        await expect(verifyAs(token(claims(), {kid: 'gone'}))).rejects.toThrow(/no current Google key/);
        await expect(verifyAs(token(claims(), {alg: 'none'}))).rejects.toThrow(/RS256/);
        await expect(verifyAs('not.a.jwt.at.all')).rejects.toThrow(/not a JWT/);
    });

    test('is refused when sent with a nonce other than the one Google was given the hash of', async () => {
        await expect(verifyAs(token(claims()), 'another-raw-nonce')).rejects.toThrow(/nonce/);
    });
});

describe('the session cookie', () => {
    const key = Buffer.alloc(32, 7);
    test('names its user until it expires, and only if signed with our key', () => {
        const value = mint(key, 'user-1', 0);
        expect(verifySession(key, value, 1000)).toBe('user-1');
        expect(verifySession(Buffer.alloc(32, 8), value, 1000)).toBeNull();
        expect(verifySession(key, value.replace('user-1', 'user-2'), 1000)).toBeNull();
        expect(verifySession(key, value, 31 * 24 * 3600 * 1000)).toBeNull();
        expect(verifySession(key, undefined)).toBeNull();
    });
});

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'api-')); });
afterEach(async () => { await rm(dir, {recursive: true, force: true}); });

describe("signing in, as Postgres's trigger did", () => {
    const identity = (over: Partial<Parameters<typeof signIn>[1]> = {}) =>
        ({sub: 'g1', email: 'scott@example.org', email_verified: true, name: 'Scott', picture: null, ...over});

    test('a first sign-in makes a contributor and records a verified email; the next finds the same user', () => {
        const store = openStore(path.join(dir, 'store.db'));
        const id = signIn(store, identity());
        expect(me(store, id)).toMatchObject({contributor: {name: 'Scott', editor: false}});
        expect(store.prepare('SELECT count(*) AS n FROM contributor_email_addresses').get()).toMatchObject({n: 1});
        expect(signIn(store, identity())).toBe(id);
        store.close();
    });

    test('another account with a verified email already known joins its contributor', () => {
        const store = openStore(path.join(dir, 'store.db'));
        const first = me(store, signIn(store, identity()))!;
        const second = me(store, signIn(store, identity({sub: 'g2', email: 'SCOTT@example.org', name: 'S.'})))!;
        expect(second.contributor.id).toBe(first.contributor.id);
        store.close();
    });

    test('an unverified email joins nothing and is not recorded; no name is Anonymous', () => {
        const store = openStore(path.join(dir, 'store.db'));
        signIn(store, identity());
        const stranger = me(store, signIn(store, identity({sub: 'g3', email_verified: false, name: null})))!;
        expect(stranger.contributor.name).toBe('Anonymous');
        expect(store.prepare('SELECT count(*) AS n FROM contributors').get()).toMatchObject({n: 2});
        expect(store.prepare('SELECT count(*) AS n FROM contributor_email_addresses').get()).toMatchObject({n: 1});
        store.close();
    });
});

describe('the API over HTTP', () => {
    test('sign in, ask who I am, sign out; and nothing changes from another origin', async () => {
        const store = openStore(path.join(dir, 'store.db'));
        const origins = new Set(['https://salishsea.io']);
        const server = serve({store, key: Buffer.alloc(32, 1), keys, origins, clientId: CLIENT}, 0);
        await new Promise(r => server.once('listening', r));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const post = (origin?: string) => fetch(`${base}/api/session`, {
            method: 'POST',
            headers: {'content-type': 'application/json', ...(origin ? {origin} : {})},
            body: JSON.stringify({credential: token(claims()), nonce: 'raw-nonce'}),
        });
        try {
            expect((await post()).status).toBe(403);
            expect((await post('https://evil.example')).status).toBe(403);
            const signedIn = await post('https://salishsea.io');
            expect(signedIn.status).toBe(200);
            const setCookie = signedIn.headers.get('set-cookie')!;
            expect(setCookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
            const session = setCookie.split(';')[0]!;
            const who = await fetch(`${base}/api/me`, {headers: {cookie: session}});
            expect(who.status).toBe(200);
            expect(await who.json()).toMatchObject({contributor: {name: 'Scott'}});
            expect((await fetch(`${base}/api/me`)).status).toBe(401);
            const out = await fetch(`${base}/api/session`, {method: 'DELETE', headers: {origin: 'https://salishsea.io'}});
            expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
            const refused = await fetch(`${base}/api/session`, {
                method: 'POST', headers: {'content-type': 'application/json', origin: 'https://salishsea.io'},
                body: JSON.stringify({credential: token(claims({aud: 'other'})), nonce: 'raw-nonce'}),
            });
            expect(refused.status).toBe(401);
        } finally {
            server.close();
            store.close();
        }
    });
});
