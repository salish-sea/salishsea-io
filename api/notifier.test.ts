/**
 * The notifier on the machine, against a real store: the seam where the Postgres
 * notifier broke twice (ids that never matched a marker, a stamp that never ran) is
 * the one between the queue and the filing, so these run both, with only GitHub faked.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { fileFeedback } from '../scripts/feedback/filing.ts';
import { rowMarker } from '../scripts/feedback/issue.ts';
import { parseFeedback, submitFeedback } from './feedback.ts';
import { startNotifier, storeQueue } from './notifier.ts';
import { openStore } from './store/store.ts';
import { me, signIn } from './users.ts';

let dir: string;
let store: DatabaseSync;
beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'notifier-'));
    store = openStore(path.join(dir, 'store.db'));
});
afterEach(async () => {
    vi.unstubAllGlobals();
    store.close();
    await rm(dir, {recursive: true, force: true});
});

const send = (message: string, userId: string | null = null, at = new Date('2026-10-05T17:00:00Z')) =>
    submitFeedback(store, userId, parseFeedback({name: 'Ann', email: 'ann@example.org', message}), at);
const rows = () => store.prepare('SELECT id, notified_at IS NOT NULL AS stamped, github_issue FROM feedback ORDER BY id').all();
const tracker = {repo: 'o/r', token: 't', authors: new Set(['salishsea-bot'])};

/** A fake GitHub: `existing` issues listed, each POST recorded and numbered from 100. */
function fakeGitHub(existing: {body: string, login: string}[] = []) {
    const posted: {title: string, body: string}[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            posted.push(JSON.parse(String(init.body)));
            return {ok: true, json: async () => ({number: 99 + posted.length})};
        }
        return {ok: true, json: async () => existing.map(e => ({body: e.body, created_at: '2026-10-05T18:00:00Z', user: {login: e.login}}))};
    });
    return posted;
}

describe('the store as a feedback queue', () => {
    test('what waits, oldest first, ids as strings, signed in as a yes or no, never the name or email', async () => {
        const user = signIn(store, {sub: 'g1', name: 'Owner', email: null, email_verified: false, picture: null});
        send('second', me(store, user)!.user_id, new Date('2026-10-05T18:00:00Z'));
        send('first');
        const waiting = await storeQueue(store, '/data/store/salishsea.db').unnotified(10);
        expect(waiting.map(r => [r.id, r.message, r.signed_in])).toEqual([['2', 'first', false], ['1', 'second', true]]);
        expect(waiting[0]).not.toHaveProperty('name');
        expect(waiting[0]).not.toHaveProperty('email');
    });

    test('each row filed becomes its own issue and is stamped with it; a second run files nothing', async () => {
        send('one');
        send('two');
        const posted = fakeGitHub();
        const queue = storeQueue(store, '/data/store/salishsea.db');
        await fileFeedback(queue, tracker);
        expect(posted.map(p => p.title)).toEqual(['Feedback: one', 'Feedback: two']);
        expect(posted[0]!.body).not.toMatch(/Ann|example\.org/);
        expect(rows()).toEqual([{id: 1, stamped: 1, github_issue: 100}, {id: 2, stamped: 1, github_issue: 101}]);
        await fileFeedback(queue, tracker);
        expect(posted).toHaveLength(2);
    });

    test("a row an earlier run filed but didn't stamp is stamped, not filed again, if the issue is ours", async () => {
        send('one');
        send('two');
        const posted = fakeGitHub([
            {body: `ours\n${rowMarker('1')}`, login: 'salishsea-bot'},
            {body: `a human's\n${rowMarker('2')}`, login: 'someone'},
        ]);
        await fileFeedback(storeQueue(store, '/data/store/salishsea.db'), tracker);
        expect(posted.map(p => p.title)).toEqual(['Feedback: two']);
        expect(rows()).toEqual([{id: 1, stamped: 1, github_issue: null}, {id: 2, stamped: 1, github_issue: 100}]);
    });

    test('a flood is one digest, which says how to read the rows in the store', async () => {
        for (let i = 0; i < 9; i++) send(`spam ${i}`);
        const posted = fakeGitHub();
        await fileFeedback(storeQueue(store, '/data/store/salishsea.db'), tracker);
        expect(posted).toHaveLength(1);
        expect(posted[0]!.body).toContain("sqlite3 -readonly /data/store/salishsea.db 'SELECT id, created_at, message FROM feedback WHERE id IN (1, 2, 3, 4, 5, 6, 7, 8, 9)'");
        expect(rows().every(r => (r as {github_issue: number}).github_issue === 100)).toBe(true);
    });
});

describe('the notifier on a timer', () => {
    test('runs at once, and a failed run is logged and leaves its rows for the next', async () => {
        send('one');
        vi.stubGlobal('fetch', async () => ({ok: false, status: 502, json: async () => []}));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const stop = startNotifier(storeQueue(store, 'x'), tracker, 60_000);
        await vi.waitFor(() => expect(errors).toHaveBeenCalledWith(expect.stringMatching(/\[feedback\] failed: .*502/)));
        stop();
        errors.mockRestore();
        expect(rows()).toEqual([{id: 1, stamped: 0, github_issue: null}]);
    });
});
