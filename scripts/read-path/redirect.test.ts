/**
 * The redirect server's answers, as Caddy sees them: a 301 it passes on, a 404 it
 * replaces with the not-in-catalog page, a 503 while no build has written a map.
 */

import { describe, expect, test } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { handler } from './redirect.ts';
import type { Redirects } from './redirect-keys.ts';

const REDIRECTS: Redirects = {individuals: {'t65a': '/individuals/0010193/T065A'}, matrilines: {}, populations: {}};

async function answer(map: () => Promise<Redirects>, url: string) {
    let status = 0;
    let headers: Record<string, string> = {};
    const res = {
        writeHead(s: number, h: Record<string, string> = {}) { status = s; headers = h; },
        end() {},
    };
    await handler(map)({url} as IncomingMessage, res as unknown as ServerResponse);
    return {status, headers};
}

describe('handler', () => {
    test('a known designation: 301 to its page, cacheable for a day as on AWS', async () => {
        expect(await answer(async () => REDIRECTS, '/individuals/T065A')).toEqual({
            status: 301, headers: {'Location': '/individuals/0010193/T065A', 'Cache-Control': 'public, max-age=86400'},
        });
    });

    test('an unknown one: 404', async () => {
        expect((await answer(async () => REDIRECTS, '/individuals/J35')).status).toBe(404);
    });

    test('no map yet: 503, not a claim that the animal is not catalogued', async () => {
        expect((await answer(async () => { throw new Error('ENOENT'); }, '/individuals/T065A')).status).toBe(503);
    });
});
