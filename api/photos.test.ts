import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { photoFolder, photoName, photoType, sniff } from './photos.ts';
import { amzDate, authorization, encodePath } from './s3.ts';
import { serve } from './server.ts';
import { mint } from './session.ts';
import { openStore } from './store/store.ts';
import { me, signIn, type Me } from './users.ts';

const JPEG: Buffer<ArrayBuffer> = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const JP2: Buffer<ArrayBuffer> = Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a, 0x00]);
const PNG: Buffer<ArrayBuffer> = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SIGHTING = '01977c2a-b313-77a9-8433-ffccbd56bf57';

describe('SigV4, as AWS documents it', () => {
    // "Example: PUT Object" in Amazon S3's "Signature Calculations for the Authorization
    // Header: Transferring Payload in a Single Chunk": its keys, request and signature.
    test("AWS's own PUT Object example signs to AWS's own signature", () => {
        const body = 'Welcome to Amazon S3.';
        const payloadHash = createHash('sha256').update(body).digest('hex');
        expect(payloadHash).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
        const auth = authorization('PUT', '/test$file.text', {
            date: 'Fri, 24 May 2013 00:00:00 GMT',
            host: 'examplebucket.s3.amazonaws.com',
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': '20130524T000000Z',
            'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        }, payloadHash, 'us-east-1', {
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        });
        expect(auth).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
            + 'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, '
            + 'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
    });

    test('a path keeps its slashes and escapes the rest as S3 does; a date is compact', () => {
        expect(encodePath("/media/1/a b(1)!*'~.jpg")).toBe('/media/1/a%20b%281%29%21%2A%27~.jpg');
        expect(amzDate(new Date('2026-10-05T17:04:05.678Z'))).toBe('20261005T170405Z');
    });
});

describe('a photo, as the media bucket and its policies took one', () => {
    test('JPEG and JPEG 2000 are known by their bytes; anything else is not', () => {
        expect([sniff(JPEG), sniff(JP2), sniff(PNG), sniff(Buffer.alloc(0))]).toEqual(['image/jpeg', 'image/jp2', null, null]);
    });

    test('the type said and the bytes must agree, and be one of the two', () => {
        expect(photoType('image/jpeg', JPEG)).toBe('image/jpeg');
        expect(photoType('image/JP2; x=y', JP2)).toBe('image/jp2');
        expect(() => photoType('image/png', PNG)).toThrow(/JPEG or a JPEG 2000/);
        expect(() => photoType('image/jpeg', PNG)).toThrow(/not the image\/jpeg it says/);
        expect(() => photoType('image/jpeg', Buffer.alloc(0))).toThrow(/empty/);
    });

    test('a name is cleaned as the browser cleaned it; one with nothing left is made', () => {
        expect(photoName(' IMG 0042 (1).JPG ', 'image/jpeg')).toBe('img_0042__1_.jpg');
        expect(photoName('..', 'image/jpeg')).toMatch(/^[0-9a-f-]{36}\.jpg$/);
        expect(photoName(null, 'image/jp2')).toMatch(/\.jp2$/);
    });

    test("a photo goes under its contributor's folder and its sighting's", () => {
        expect(photoFolder(7, SIGHTING.toUpperCase())).toBe(`media/7/${SIGHTING}`);
        expect(() => photoFolder(7, '../8')).toThrow(/UUID/);
    });
});

describe('POST /api/photos', () => {
    let dir: string;
    let store: DatabaseSync;
    let owner: Me;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'photos-'));
        store = openStore(path.join(dir, 'store.db'));
        owner = me(store, signIn(store, {sub: 'g1', name: 'Owner', email: null, email_verified: false, picture: null}))!;
    });
    afterEach(async () => {
        store.close();
        await rm(dir, {recursive: true, force: true});
    });

    test('signed out is 401; a photo is put and its URL returned; a wrong one is refused before S3 sees it', async () => {
        const put: {key: string, size: number, contentType: string, cacheControl: string}[] = [];
        const key = Buffer.alloc(32, 2);
        const server = serve({
            store, key, keys: async () => new Map(), origins: new Set(['https://salishsea.io']),
            photos: {
                base: 'https://salishsea.io',
                put: async (k, body, meta) => { put.push({key: k, size: body.length, ...meta}); },
            },
        }, 0);
        await new Promise(r => server.once('listening', r));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const session = `salishsea_session=${mint(key, owner.user_id, 0)}`;
        const upload = (body: Buffer<ArrayBuffer>, type: string, query: string, cookie: string | null = session) =>
            fetch(`${base}/api/photos?${query}`, {
                method: 'POST', body,
                headers: {'content-type': type, origin: 'https://salishsea.io', ...(cookie ? {cookie} : {})},
            });
        const good = `sighting=${SIGHTING}&name=IMG_1.JPG`;
        try {
            expect((await upload(JPEG, 'image/jpeg', good, null)).status).toBe(401);
            const ok = await upload(JPEG, 'image/jpeg', good);
            expect(ok.status).toBe(201);
            const url = `https://salishsea.io/media/${owner.contributor.id}/${SIGHTING}/img_1.jpg`;
            expect(await ok.json()).toEqual({url});
            expect(put).toEqual([{key: `media/${owner.contributor.id}/${SIGHTING}/img_1.jpg`, size: JPEG.length,
                contentType: 'image/jpeg', cacheControl: 'max-age=259200'}]);
            expect((await upload(PNG, 'image/png', good)).status).toBe(415);
            expect((await upload(PNG, 'image/jpeg', good)).status).toBe(415);
            expect((await upload(JPEG, 'image/jpeg', 'sighting=nope&name=a.jpg')).status).toBe(400);
            const big = Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024)]);
            expect((await upload(big, 'image/jpeg', good)).status).toBe(413);
            expect(put).toHaveLength(1);
        } finally {
            server.close();
        }
    });

    test('with no bucket configured, an upload is 503', async () => {
        const key = Buffer.alloc(32, 2);
        const server = serve({store, key, keys: async () => new Map(), origins: new Set(['https://salishsea.io'])}, 0);
        await new Promise(r => server.once('listening', r));
        try {
            const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/photos?sighting=${SIGHTING}`, {
                method: 'POST', body: JPEG,
                headers: {'content-type': 'image/jpeg', origin: 'https://salishsea.io', cookie: `salishsea_session=${mint(key, owner.user_id, 0)}`},
            });
            expect(response.status).toBe(503);
        } finally {
            server.close();
        }
    });
});
