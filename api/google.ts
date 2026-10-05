/**
 * Verify a Google Sign-In ID token ourselves, as Supabase's GoTrue did (decision 065,
 * salish-9uu.3.3; the nonce is decision 030's).
 *
 * The browser gets an ID token from Google Identity Services, signed with one of Google's
 * published keys, and sends it with the raw nonce it made; Google was given the nonce's
 * SHA-256 in hex and put that in the token. A token is accepted only if it is an RS256
 * JWT signed by a current Google key, issued by Google for salishsea's client, unexpired,
 * and carrying the hash of the nonce sent with it — so a token lifted from another site,
 * or replayed with another nonce, is refused.
 */

import { createHash, createPublicKey, verify, type JsonWebKeyInput } from 'node:crypto';

export const GOOGLE_CLIENT_ID = '129212631591-b6ba75aevcbifjpea2cap2vja91a6te8.apps.googleusercontent.com';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
/** Clocks disagree; a minute either way. */
const SKEW_SECONDS = 60;

/** What a verified token says about who signed in. */
export type GoogleIdentity = {
    sub: string,
    email: string | null,
    email_verified: boolean,
    name: string | null,
    picture: string | null,
};

type Jwk = JsonWebKeyInput['key'] & {kid?: string, alg?: string};
/**
 * Google's current signing keys, by key id. `refresh` asks again even if the cache is
 * fresh: Google may rotate a key early, and a token signed by a key not yet cached
 * would otherwise be refused until the cache expired.
 */
export type KeySource = (refresh?: boolean) => Promise<Map<string, Jwk>>;
/** At most one forced refetch a minute, so a stream of junk key ids can't hammer Google. */
const REFRESH_COOLDOWN_MS = 60_000;

/** Google's published keys, fetched once and kept as long as Google's Cache-Control says. */
export function googleKeys(fetcher: typeof fetch = fetch): KeySource {
    let cached: {keys: Map<string, Jwk>, until: number, fetched: number} | null = null;
    return async (refresh = false) => {
        const forced = refresh && cached !== null && Date.now() - cached.fetched > REFRESH_COOLDOWN_MS;
        if (cached && Date.now() < cached.until && !forced) return cached.keys;
        const res = await fetcher(CERTS, {signal: AbortSignal.timeout(10_000)});
        if (!res.ok) throw new Error(`Google's keys: ${res.status}`);
        const body = await res.json() as {keys: Jwk[]};
        const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
        cached = {keys: new Map(body.keys.map(k => [k.kid!, k])), until: Date.now() + maxAge * 1000, fetched: Date.now()};
        return cached.keys;
    };
}

/** The SHA-256 of a nonce, in lowercase hex: what Google was given and echoes. */
export const nonceHash = (raw: string) => createHash('sha256').update(raw).digest('hex');

export class InvalidToken extends Error {}

/** The identity in `token`, if it is a valid Google ID token for us, bound to `nonce`. Throws InvalidToken otherwise. */
export async function verifyIdToken(
    token: string, nonce: string, keys: KeySource,
    {clientId = GOOGLE_CLIENT_ID, now = Date.now()}: {clientId?: string, now?: number} = {},
): Promise<GoogleIdentity> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new InvalidToken('not a JWT');
    const [head, body, signature] = parts as [string, string, string];
    let header: {alg?: string, kid?: string};
    let claims: Record<string, unknown>;
    const object = (segment: string) => {
        const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
        return value as Record<string, unknown>;
    };
    try {
        header = object(head) as {alg?: string, kid?: string};
        claims = object(body);
    } catch {
        throw new InvalidToken('not a JWT');
    }
    if (header.alg !== 'RS256' || !header.kid) throw new InvalidToken('not an RS256 token with a key id');
    const jwk = (await keys()).get(header.kid) ?? (await keys(true)).get(header.kid);
    if (!jwk) throw new InvalidToken('signed by no current Google key');
    const signed = verify('RSA-SHA256', Buffer.from(`${head}.${body}`), createPublicKey({key: jwk, format: 'jwk'}),
        Buffer.from(signature, 'base64url'));
    if (!signed) throw new InvalidToken('bad signature');
    if (!ISSUERS.has(String(claims['iss']))) throw new InvalidToken('not issued by Google');
    if (claims['aud'] !== clientId) throw new InvalidToken('issued for another client');
    const seconds = now / 1000;
    if (typeof claims['exp'] !== 'number' || claims['exp'] + SKEW_SECONDS < seconds) throw new InvalidToken('expired');
    if (typeof claims['iat'] === 'number' && claims['iat'] - SKEW_SECONDS > seconds) throw new InvalidToken('issued in the future');
    if (typeof claims['nonce'] !== 'string' || claims['nonce'] !== nonceHash(nonce)) throw new InvalidToken('nonce does not match');
    if (typeof claims['sub'] !== 'string' || claims['sub'] === '') throw new InvalidToken('no subject');
    const text = (k: string) => typeof claims[k] === 'string' && claims[k] !== '' ? claims[k] as string : null;
    return {
        sub: claims['sub'],
        email: text('email'),
        // Google sends a boolean, and once sent the string 'true'; anything else is unverified
        email_verified: claims['email_verified'] === true || claims['email_verified'] === 'true',
        name: text('name'),
        picture: text('picture'),
    };
}
