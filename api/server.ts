/**
 * The write API (decision 065): what replaces Supabase for what salishsea.io's users
 * write — sign-in (salish-9uu.3.3), sightings, their photos and feedback (salish-9uu.3.4).
 *
 *   STORE_PATH=… SESSION_SIGNING_KEY=… node api/server.ts
 *
 * Plain node:http on loopback; Caddy proxies salishsea.io/api/* to it, so it shares the
 * site's origin. Routes:
 *
 *   POST   /api/session  {credential, nonce}  Google's ID token and the raw nonce (030):
 *                                             verified, the user found or made, a session
 *                                             cookie set; answers as GET /api/me does
 *   DELETE /api/session                       ends the session
 *   GET    /api/me                            {user_id, contributor} or 401
 *   GET    /api/sightings?since=<time>&until=<time>
 *                                             {sightings}: the signed-in contributor's own,
 *                                             as saved, for the map to lay over the files
 *                                             until a build publishes them; 401 signed out
 *   PUT    /api/sightings/<id>  a sighting      save it (sightings.ts): 401 signed out, 403 not
 *                                             the owner's or an editor's
 *   DELETE /api/sightings/<id>                 delete it, likewise; 404 if there is none
 *   POST   /api/photos?sighting=<id>&name=<file>  a JPEG's or JPEG 2000's bytes, at most
 *                                             8 MiB (photos.ts): put in the photo bucket;
 *                                             answers {url}, at salishsea.io/media/
 *   POST   /api/feedback        a message       anyone (039), a few per sender per window;
 *                                             notifier.ts files it as a GitHub issue
 *
 * A change to a sighting wakes the build (BUILD_COMMAND, coalesced as the change listener
 * coalesces Realtime's signal), so the published files follow within a build.
 *
 * Anything that changes state must come from an allowed origin: the cookie is SameSite=Lax,
 * and the Origin check is the second lock on the same door.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { WORKFLOW_AUTHOR } from '../scripts/feedback/filing.ts';
import { BuildCoalescer, commandBuild } from '../scripts/read-path/coalesce.ts';
import { parseFeedback, rateLimiter, submitFeedback } from './feedback.ts';
import { googleKeys, InvalidToken, verifyIdToken, type KeySource } from './google.ts';
import { startNotifier, storeQueue } from './notifier.ts';
import { MAX_PHOTO_BYTES, PHOTO_CACHE_CONTROL, photoFolder, photoName, photoType } from './photos.ts';
import { putObject } from './s3.ts';
import { deleteSighting, ownSightings, parseSighting, Refused, saveSighting } from './sightings.ts';
import { cookie, mint, readCookie, signingKey, verifySession } from './session.ts';
import { openStore } from './store/store.ts';
import { me, sessionEpoch, signIn, signOut, type Me } from './users.ts';

export const DEFAULT_ORIGINS = ['https://salishsea.io', 'https://salishsea-io.fly.dev'];
const MAX_BODY = 64 * 1024;

export type Api = {
    store: DatabaseSync, key: Buffer, keys: KeySource, origins: ReadonlySet<string>, clientId?: string,
    /** Told after a sighting changes: wakes the build. */
    changed?: () => void,
    /** Whether a sender may send feedback now. */
    feedbackAllowed?: (sender: string) => boolean,
    /**
     * The secret CloudFront adds to every request it forwards (an origin custom header,
     * x-origin-verify). Only a request carrying it is believed about the viewer's address.
     */
    edgeSecret?: string,
    /**
     * Where photos go: `put` stores an object, and a photo's URL is `base` and its key.
     * Without it, a photo upload answers 503.
     */
    photos?: {
        put: (key: string, body: Uint8Array<ArrayBuffer>, meta: {contentType: string, cacheControl: string}) => Promise<void>,
        base: string,
    },
};

/**
 * Who sent a request, by the client's address. Through CloudFront, the viewer address it
 * reports — but only when the request proves it came through CloudFront, since anyone can
 * reach the Fly app directly and send that header. Otherwise Fly-Client-IP, which Fly's
 * proxy sets and a client can't. Caddy's X-Forwarded-For is not used: it would be Fly's
 * proxy, the same for everyone.
 */
function sameSecret(given: string | string[] | undefined, secret: string): boolean {
    if (typeof given !== 'string') return false;
    const a = createHash('sha256').update(given).digest();
    const b = createHash('sha256').update(secret).digest();
    return timingSafeEqual(a, b);
}

export function sender(req: IncomingMessage, edgeSecret?: string): string {
    const cloudfront = req.headers['cloudfront-viewer-address'];
    if (edgeSecret && sameSecret(req.headers['x-origin-verify'], edgeSecret) && typeof cloudfront === 'string')
        return cloudfront.replace(/:\d+$/, '');
    const fly = req.headers['fly-client-ip'];
    if (typeof fly === 'string') return fly;
    return req.socket.remoteAddress ?? 'unknown';
}

class HttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function bytes(req: IncomingMessage, max: number): Promise<Buffer<ArrayBuffer>> {
    if (Number(req.headers['content-length'] ?? 0) > max) throw new HttpError(413, 'too large');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > max) throw new HttpError(413, 'too large');
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'send JSON');
    const raw = await bytes(req, MAX_BODY);
    try {
        const body = JSON.parse(raw.toString('utf8'));
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
        return body as Record<string, unknown>;
    } catch {
        throw new HttpError(400, 'not a JSON object');
    }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', ...headers});
    res.end(JSON.stringify(body));
}

/**
 * The signed-in user a request carries, or null: a session cookie that is ours, unexpired,
 * for a user still in the store, at the epoch the store has for them.
 */
export function currentUser(api: Api, req: IncomingMessage): Me | null {
    const session = verifySession(api.key, readCookie(req.headers['cookie']));
    if (session === null || sessionEpoch(api.store, session.userId) !== session.epoch) return null;
    return me(api.store, session.userId);
}

/** Handle one request. Exported for tests, which call it without a socket. */
export async function handle(api: Api, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const url = new URL(req.url ?? '/', 'http://api');
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') {
            const origin = req.headers['origin'];
            if (!origin || !api.origins.has(origin)) throw new HttpError(403, 'not from salishsea.io');
        }
        if (url.pathname === '/api/session' && method === 'POST') {
            const {credential, nonce} = await json(req);
            if (typeof credential !== 'string' || typeof nonce !== 'string') throw new HttpError(400, 'send {credential, nonce}');
            let identity;
            try {
                identity = await verifyIdToken(credential, nonce, api.keys, api.clientId ? {clientId: api.clientId} : {});
            } catch (error) {
                if (error instanceof InvalidToken) throw new HttpError(401, `sign-in refused: ${error.message}`);
                throw error;
            }
            const userId = signIn(api.store, identity);
            const epoch = sessionEpoch(api.store, userId)!;
            return send(res, 200, me(api.store, userId), {'set-cookie': cookie(mint(api.key, userId, epoch))});
        }
        if (url.pathname === '/api/session' && method === 'DELETE') {
            // Signing out ends the user's every session, not only this cookie.
            const who = currentUser(api, req);
            if (who !== null) signOut(api.store, who.user_id);
            return send(res, 200, {signed_in: false}, {'set-cookie': cookie(null)});
        }
        if (url.pathname === '/api/me' && method === 'GET') {
            const who = currentUser(api, req);
            if (who === null) return send(res, 401, {signed_in: false});
            return send(res, 200, who);
        }
        if (url.pathname === '/api/sightings' && method === 'GET') {
            const who = currentUser(api, req);
            if (who === null) throw new HttpError(401, 'sign in first');
            return send(res, 200, {sightings: ownSightings(api.store, who.contributor.id,
                url.searchParams.get('since'), url.searchParams.get('until'))});
        }
        const sighting = /^\/api\/sightings\/([^/]+)$/.exec(url.pathname);
        if (sighting && (method === 'PUT' || method === 'DELETE')) {
            const who = currentUser(api, req);
            if (who === null) throw new HttpError(401, 'sign in first');
            let id: string;
            try {
                id = decodeURIComponent(sighting[1]!);
            } catch {
                throw new HttpError(400, 'not a sighting id');
            }
            if (method === 'PUT') {
                const outcome = saveSighting(api.store, who, id, parseSighting(await json(req)));
                api.changed?.();
                return send(res, outcome === 'created' ? 201 : 200, {id, outcome});
            }
            if (!deleteSighting(api.store, who, id)) throw new HttpError(404, 'no such sighting');
            api.changed?.();
            return send(res, 200, {id, deleted: true});
        }
        if (url.pathname === '/api/photos' && method === 'POST') {
            const who = currentUser(api, req);
            if (who === null) throw new HttpError(401, 'sign in first');
            if (!api.photos) throw new HttpError(503, 'photo uploads are not configured');
            const folder = photoFolder(who.contributor.id, url.searchParams.get('sighting') ?? '');
            const body = await bytes(req, MAX_PHOTO_BYTES);
            const type = photoType(req.headers['content-type'], body);
            const key = `${folder}/${photoName(url.searchParams.get('name'), type)}`;
            await api.photos.put(key, body, {contentType: type, cacheControl: PHOTO_CACHE_CONTROL});
            return send(res, 201, {url: `${api.photos.base}/${key}`});
        }
        if (url.pathname === '/api/feedback' && method === 'POST') {
            const message = parseFeedback(await json(req));
            if (api.feedbackAllowed && !api.feedbackAllowed(sender(req, api.edgeSecret)))
                throw new HttpError(429, 'too much feedback; try again later');
            submitFeedback(api.store, currentUser(api, req)?.user_id ?? null, message);
            return send(res, 201, {received: true});
        }
        throw new HttpError(404, 'no such route');
    } catch (error) {
        if (error instanceof HttpError || error instanceof Refused) return send(res, error.status, {error: error.message});
        console.error(error);
        return send(res, 500, {error: 'internal error'});
    }
}

export function serve(api: Api, port: number): Server {
    return createServer((req, res) => {
        handle(api, req, res).catch(error => {
            console.error(error);
            if (!res.headersSent) send(res, 500, {error: 'internal error'});
        });
    }).listen(port, '127.0.0.1');
}

if (import.meta.main) {
    const store = process.env['STORE_PATH'];
    if (!store) {
        console.error('STORE_PATH is not set');
        process.exit(2);
    }
    const configured = (process.env['ALLOWED_ORIGINS'] ?? '').split(',').map(o => o.trim()).filter(Boolean);
    const origins = new Set(configured.length > 0 ? configured : DEFAULT_ORIGINS);
    const port = Number(process.env['API_PORT'] ?? 8082);
    // Read once, then gone from this process's environment, which the build it wakes
    // inherits: the key is the API's alone.
    const key = signingKey(process.env['SESSION_SIGNING_KEY']);
    delete process.env['SESSION_SIGNING_KEY'];
    const edgeSecret = process.env['EDGE_SECRET'] || undefined;
    delete process.env['EDGE_SECRET'];
    // The AWS key may only add photos (and keep Litestream's replica, which has its own
    // copy): no photos without it.
    const accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];
    delete process.env['AWS_ACCESS_KEY_ID'];
    delete process.env['AWS_SECRET_ACCESS_KEY'];
    const bucket = accessKeyId && secretAccessKey ? {
        name: process.env['MEDIA_BUCKET'] ?? 'salishsea-io-media',
        region: process.env['MEDIA_BUCKET_REGION'] ?? 'us-west-2',
        credentials: {accessKeyId, secretAccessKey},
    } : null;
    if (!bucket) console.warn('api: no AWS key, so photo uploads answer 503');
    // The feedback notifier's GitHub token (notifier.ts), likewise the API's alone. Without
    // it, feedback is kept and nobody is told.
    const githubToken = process.env['FEEDBACK_GITHUB_TOKEN'];
    delete process.env['FEEDBACK_GITHUB_TOKEN'];
    const issueAuthor = process.env['FEEDBACK_ISSUE_AUTHOR'];
    const build = process.env['BUILD_COMMAND']?.split(' ').filter(Boolean) ?? [];
    const coalescer = build.length > 0 ? new BuildCoalescer(commandBuild(build)) : null;
    const db = openStore(store);
    if (githubToken && issueAuthor) {
        startNotifier(storeQueue(db, store), {
            repo: process.env['GITHUB_REPOSITORY'] ?? 'salish-sea/salishsea-io',
            token: githubToken,
            authors: new Set([issueAuthor, WORKFLOW_AUTHOR]),
        });
    } else {
        console.warn('api: FEEDBACK_GITHUB_TOKEN or FEEDBACK_ISSUE_AUTHOR is not set, so feedback files no issues');
    }
    serve({
        store: db, key, keys: googleKeys(), origins,
        changed: coalescer ? () => coalescer.changed() : undefined,
        feedbackAllowed: rateLimiter(),
        edgeSecret,
        photos: bucket ? {
            put: (key, body, meta) => putObject(bucket, key, body, meta),
            base: process.env['MEDIA_BASE_URL'] ?? 'https://salishsea.io',
        } : undefined,
    }, port);
    console.log(`api: listening on 127.0.0.1:${port}`);
}
