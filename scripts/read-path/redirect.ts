/**
 * Redirects a designation-shaped profile path to the page's canonical address
 * (decision 057, step 5), from the map the read-path build writes — no database.
 *
 *   node scripts/read-path/redirect.ts <redirects.json> <port>
 *
 * Caddy sends it /individuals/<designation>, /matrilines/<designation> and
 * /ecotypes/<designation>: legacy links from before decision 034, and typed ones.
 * A known designation gets a 301 to the canonical address, as the Lambda@Edge
 * function gives on AWS; an unknown one gets a 404, which Caddy answers with the
 * not-in-catalog page. The typed segment is folded as the register compares names
 * (src/fold.ts), so T65A, t065a and T065A find the same animal.
 *
 * The map is reread when the build replaces it, so a renamed animal redirects from
 * the next build on. Listens on localhost only: it has nothing to say to anyone but
 * Caddy.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';

import { designationKey, matrilineKey, type Redirects } from './redirect-keys.ts';

/** How a browser may cache the redirect: a day bounds how long a mistaken mapping survives a fix, as on AWS. */
const REDIRECT_CACHE = 'public, max-age=86400';

const KEYS: Record<keyof Redirects, (segment: string) => string> = {
    individuals: designationKey,
    matrilines: matrilineKey,
    ecotypes: designationKey,
};

/** Where a request path redirects to, with its query kept; null if it names nothing we have. */
export function redirectFor(redirects: Redirects, url: string): string | null {
    const [pathname, query] = splitOnce(url, '?');
    const match = pathname.match(/^\/(individuals|matrilines|ecotypes)\/([^/]+)\/?$/);
    if (!match) return null;
    const kind = match[1] as keyof Redirects;
    let segment: string;
    try {
        segment = decodeURIComponent(match[2]!);
    } catch {
        return null;
    }
    // Own keys only: /individuals/constructor is not Object.prototype's.
    const key = KEYS[kind](segment);
    const target = Object.hasOwn(redirects[kind], key) ? redirects[kind][key] : undefined;
    return typeof target === 'string' ? target + (query !== undefined ? `?${query}` : '') : null;
}

function splitOnce(s: string, sep: string): [string, string | undefined] {
    const at = s.indexOf(sep);
    return at < 0 ? [s, undefined] : [s.slice(0, at), s.slice(at + 1)];
}

/** The map, reread when its file changes; the last good one while it can't be read. */
export function redirectMap(file: string): () => Promise<Redirects> {
    let loaded: {mtimeMs: number, redirects: Redirects} | null = null;
    return async () => {
        try {
            const {mtimeMs} = await stat(file);
            if (loaded?.mtimeMs !== mtimeMs)
                loaded = {mtimeMs, redirects: JSON.parse(await readFile(file, 'utf8')) as Redirects};
        } catch (error) {
            if (!loaded) throw error;
            console.error('redirect: could not reread the map; keeping the last one', error);
        }
        return loaded.redirects;
    };
}

export function handler(map: () => Promise<Redirects>) {
    return async (req: IncomingMessage, res: ServerResponse) => {
        try {
            const target = redirectFor(await map(), req.url ?? '/');
            if (target) {
                res.writeHead(301, {'Location': target, 'Cache-Control': REDIRECT_CACHE});
            } else {
                res.writeHead(404);
            }
        } catch (error) {
            // No map yet (a fresh volume, before the first build): say so, and let
            // Caddy show its error rather than claim the animal isn't catalogued.
            console.error('redirect: no map', error);
            res.writeHead(503);
        }
        res.end();
    };
}

export async function main(): Promise<void> {
    const [file, port] = process.argv.slice(2);
    if (!file || !port) {
        console.error('usage: redirect.ts <redirects.json> <port>');
        process.exit(2);
    }
    createServer(handler(redirectMap(file))).listen(Number(port), '127.0.0.1', () =>
        console.log(`redirect: listening on 127.0.0.1:${port}, from ${file}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
