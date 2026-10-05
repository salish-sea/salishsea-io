/**
 * The write API (decision 065): what replaces Supabase for what salishsea.io's users
 * write. This step is sign-in (salish-9uu.3.3); the writes follow (salish-9uu.3.4).
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
 *
 * Anything that changes state must come from an allowed origin: the cookie is SameSite=Lax,
 * and the Origin check is the second lock on the same door.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { googleKeys, InvalidToken, verifyIdToken, type KeySource } from './google.ts';
import { cookie, mint, readCookie, signingKey, verifySession } from './session.ts';
import { openStore } from './store/store.ts';
import { me, signIn } from './users.ts';

export const DEFAULT_ORIGINS = ['https://salishsea.io', 'https://salishsea-io.fly.dev'];
const MAX_BODY = 64 * 1024;

export type Api = {store: DatabaseSync, key: Buffer, keys: KeySource, origins: ReadonlySet<string>, clientId?: string};

class HttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'send JSON');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY) throw new HttpError(413, 'too large');
        chunks.push(chunk as Buffer);
    }
    try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

/** Handle one request. Exported for tests, which call it without a socket. */
export async function handle(api: Api, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const url = new URL(req.url ?? '/', 'http://api');
        const method = req.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') {
            const origin = req.headers['origin'];
            if (!origin || !api.origins.has(origin)) throw new HttpError(403, 'not from salishsea.io');
        }
        const session = () => verifySession(api.key, readCookie(req.headers['cookie']));
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
            return send(res, 200, me(api.store, userId), {'set-cookie': cookie(mint(api.key, userId))});
        }
        if (url.pathname === '/api/session' && method === 'DELETE')
            return send(res, 200, {signed_in: false}, {'set-cookie': cookie(null)});
        if (url.pathname === '/api/me' && method === 'GET') {
            const userId = session();
            const who = userId === null ? null : me(api.store, userId);
            if (who === null) return send(res, 401, {signed_in: false});
            return send(res, 200, who);
        }
        throw new HttpError(404, 'no such route');
    } catch (error) {
        if (error instanceof HttpError) return send(res, error.status, {error: error.message});
        console.error(error);
        return send(res, 500, {error: 'internal error'});
    }
}

export function serve(api: Api, port: number): Server {
    return createServer((req, res) => void handle(api, req, res)).listen(port, '127.0.0.1');
}

if (import.meta.main) {
    const store = process.env['STORE_PATH'];
    if (!store) {
        console.error('STORE_PATH is not set');
        process.exit(2);
    }
    const origins = new Set(process.env['ALLOWED_ORIGINS']?.split(',').map(o => o.trim()).filter(Boolean) ?? DEFAULT_ORIGINS);
    const port = Number(process.env['API_PORT'] ?? 8082);
    serve({store: openStore(store), key: signingKey(process.env['SESSION_SIGNING_KEY']), keys: googleKeys(), origins}, port);
    console.log(`api: listening on 127.0.0.1:${port}`);
}
