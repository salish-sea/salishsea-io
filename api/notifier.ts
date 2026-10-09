/**
 * The feedback notifier on the machine (decision 065, salish-9uu.3.4): 039's
 * notifier, filing an issue for each new piece of feedback, reading the store
 * instead of Postgres. The filing is scripts/feedback/filing.ts's, the same code
 * the GitHub workflow runs against Postgres until the cutover.
 *
 * It runs inside the API, on a timer, because the API is the one process that
 * owns the store: one run at a time is then a flag, where Postgres needed an
 * advisory lock. Every fifteen minutes, as the workflow ran, because the digest
 * that bounds a flood at one issue per run counts on runs being that far apart.
 *
 * The store's feedback rows carried on Postgres's ids when the cutover copied them
 * (stamps included), so a row's marker never names a row the workflow filed.
 */

import type { DatabaseSync } from 'node:sqlite';

import { fileFeedback, type FeedbackQueue, type IssueTracker } from '../scripts/feedback/filing.ts';
import type { FeedbackRow } from '../scripts/feedback/issue.ts';
import { isoMicros } from './sightings.ts';

export const NOTIFY_EVERY_MS = 15 * 60_000;

/** The store as a feedback queue. `where` names the store for a digest's reader. */
export function storeQueue(store: DatabaseSync, where: string, now = () => new Date()): FeedbackQueue {
    return {
        async unnotified(limit) {
            const rows = store.prepare(`SELECT id, created_at, message, page_url, user_agent, release,
                    user_id IS NOT NULL AS signed_in
                FROM feedback WHERE notified_at IS NULL ORDER BY created_at, id LIMIT ?`).all(limit) as
                {id: number, created_at: string, message: string, page_url: string | null, user_agent: string | null,
                    release: string | null, signed_in: number}[];
            // ids as strings, as FeedbackRow keeps them, and signed_in a boolean
            return rows.map((r): FeedbackRow => ({...r, id: String(r.id), signed_in: r.signed_in === 1}));
        },
        async stamp(ids, issue) {
            if (ids.length === 0) return;
            store.prepare(`UPDATE feedback SET notified_at = ?, github_issue = ?
                WHERE id IN (SELECT value FROM json_each(?))`)
                .run(isoMicros(now()), issue, JSON.stringify(ids.map(Number)));
        },
        readThem: (ids) => `sqlite3 -readonly ${where} 'SELECT id, created_at, message FROM feedback WHERE id IN (${ids.join(', ')})'`,
    };
}

/**
 * Run `fileFeedback` now and every `everyMs`, never two at once. A failed run is
 * logged and its rows left for the next. Returns a stop function.
 */
export function startNotifier(queue: FeedbackQueue, tracker: IssueTracker, everyMs = NOTIFY_EVERY_MS): () => void {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await fileFeedback(queue, tracker);
        } catch (error) {
            // never the token: fileFeedback's errors name a status, not a request
            console.error(`[feedback] failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            running = false;
        }
    };
    void run();
    const timer = setInterval(() => void run(), everyMs);
    timer.unref();
    return () => clearInterval(timer);
}
