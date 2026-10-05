/**
 * The API's own session (decision 065, salish-9uu.3.3): after a Google sign-in is
 * verified, a cookie naming the user, signed with a key only the API holds, so later
 * requests need no Google token. HMAC-SHA256 over `<user id>.<epoch>.<expiry>`; the cookie is
 * HttpOnly (no script reads it), Secure, SameSite=Lax, and scoped to /api.
 *
 * Holds no role: whether a user may edit is read from the store on every write, so taking
 * someone's editor flag away takes effect at once. It does hold the user's session epoch,
 * which the server compares with the store's: signing out moves the epoch, ending every
 * session that user has.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'salishsea_session';
/** Thirty days, then sign in again. */
export const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function signingKey(env: string | undefined): Buffer {
    const key = Buffer.from(env ?? '', 'base64');
    if (key.length < 32) throw new Error('SESSION_SIGNING_KEY must be at least 32 random bytes, base64');
    return key;
}

const mac = (key: Buffer, payload: string) => createHmac('sha256', key).update(payload).digest('base64url');

/** A session value for `userId` at `epoch`, good until `now` plus MAX_AGE_SECONDS. */
export function mint(key: Buffer, userId: string, epoch: number, now = Date.now()): string {
    const payload = `${userId}.${epoch}.${Math.floor(now / 1000) + MAX_AGE_SECONDS}`;
    return `${payload}.${mac(key, payload)}`;
}

/** The user and epoch a session value names, if it is ours and unexpired; null otherwise. */
export function verifySession(key: Buffer, value: string | undefined, now = Date.now()): {userId: string, epoch: number} | null {
    if (!value) return null;
    const cut = value.lastIndexOf('.');
    if (cut < 0) return null;
    const payload = value.slice(0, cut);
    const given = Buffer.from(value.slice(cut + 1));
    const expected = Buffer.from(mac(key, payload));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    // <user id>.<epoch>.<expiry>: the id may itself hold dots, so split from the right
    const fields = payload.split('.');
    const expiry = Number(fields.pop());
    const epoch = Number(fields.pop());
    if (!Number.isInteger(expiry) || !Number.isInteger(epoch) || expiry * 1000 < now) return null;
    return {userId: fields.join('.'), epoch};
}

/** The Set-Cookie header value for a session, or for ending one. */
export function cookie(value: string | null): string {
    const attributes = 'Path=/api; HttpOnly; Secure; SameSite=Lax';
    return value === null
        ? `${COOKIE}=; ${attributes}; Max-Age=0`
        : `${COOKIE}=${value}; ${attributes}; Max-Age=${MAX_AGE_SECONDS}`;
}

/** The session value from a request's Cookie header. */
export function readCookie(header: string | undefined): string | undefined {
    for (const part of (header ?? '').split(';')) {
        const [name, ...rest] = part.trim().split('=');
        if (name === COOKIE) return rest.join('=');
    }
    return undefined;
}
