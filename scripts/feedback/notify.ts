/**
 * File a GitHub issue for each new piece of feedback in Postgres — imperative
 * shell (decision 039; decision 011's two tiers). The filing itself is
 * filing.ts's, shared with the notifier on the machine (api/notifier.ts), which
 * takes over at the cutover, when feedback moves to the store (decision 065).
 *
 * Feedback lands in `public.feedback`, which nothing but this reads. Without a
 * notifier it would sit there unseen, which is the same outcome as the widget
 * that dropped reports on the floor — the failure decision 039 exists to end.
 *
 * Rows are claimed where `notified_at IS NULL` and stamped as each issue is
 * created (filing.ts), so re-running is always safe.
 *
 * Security: NEVER log the DSN (same rule as scripts/dwca/guard.ts and
 * scripts/ingest/heartbeat.ts), and never put a reporter's name or email in an
 * issue — see issue.ts for why.
 */

import postgres from 'postgres';
import type { Sql } from 'postgres';
import { fileFeedback, WORKFLOW_AUTHOR } from './filing.ts';
import type { FeedbackRow } from './issue.ts';

/** Arbitrary but fixed; only this script uses it. See main() for why. */
const ADVISORY_LOCK_KEY = 8_390_217_004_113_705;

function maskDsn(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/postgres(?:ql)?:\/\/[^\s]*/gi, 'postgres://<redacted>');
}

/**
 * The reports waiting to be filed, oldest first.
 *
 * Ids stay strings, all the way through — see `FeedbackRow.id`. They were
 * declared `number` while postgres.js was handing back strings, so
 * `filed.has(row.id)` asked a `Set<number>` about a string and was always told
 * no; every already-filed report was filed again. TypeScript could not see it,
 * because the declaration lied about what the driver returns, and it survived a
 * green suite into production, where it duplicated the first real report this
 * channel ever received (issues #440 and #442 on 2026-09-10).
 */
export async function unnotified(sql: Sql, limit: number): Promise<FeedbackRow[]> {
    const rows = await sql<FeedbackRow[]>`
        SELECT id, created_at, message, page_url, user_agent, release,
               (user_uuid IS NOT NULL) AS signed_in
        FROM public.feedback
        WHERE notified_at IS NULL
        ORDER BY created_at
        LIMIT ${limit}`;
    return rows;
}

/**
 * Mark rows notified. `issue` is null when an earlier run already filed them.
 *
 * The `::bigint[]` cast is load-bearing. Without it postgres.js sends the array
 * as `text[]` and Postgres refuses with "operator does not exist: bigint =
 * text" — which is not a type-checking failure, so nothing catches it until it
 * runs against a real database. It went to production unnoticed on 2026-09-10
 * because every test of this file mocked `fetch` and none of them touched
 * Postgres; the end-to-end run caught it, after the issue had been filed and
 * before the row was stamped.
 */
export async function stamp(sql: Sql, ids: readonly string[], issue: number | null): Promise<void> {
    await sql`
        UPDATE public.feedback
        SET notified_at = now(), github_issue = ${issue}
        WHERE id = ANY(${sql.array(ids as string[])}::bigint[])`;
}

async function main(): Promise<void> {
    const dsn = process.env['SUPABASE_DB_URL'];
    const token = process.env['GITHUB_TOKEN'];
    const repo = process.env['GITHUB_REPOSITORY'];
    if (!dsn || !token || !repo)
        throw new Error('SUPABASE_DB_URL, GITHUB_TOKEN and GITHUB_REPOSITORY are all required');

    const sql = postgres(dsn, {prepare: false, max: 1});
    try {
        // Only one notifier at a time, enforced where it actually matters.
        //
        // The workflow's concurrency group stops two *scheduled* runs
        // overlapping, but not a scheduled run and someone running this by hand
        // — and two runs would read the same unstamped rows, both find nothing
        // in alreadyFiled(), and file everything twice. A session-level advisory
        // lock covers every caller, and it needs no cleanup: it is released when
        // the connection closes, including when a runner is killed outright, so
        // a crash cannot strand the lock and block every later run.
        const [lock] = await sql<{acquired: boolean}[]>`
            SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS acquired`;
        if (!lock!.acquired) {
            console.log('[feedback] another notifier holds the lock; leaving these rows to it');
            return;
        }

        await fileFeedback({
            unnotified: (limit) => unnotified(sql, limit),
            stamp: (ids, issue) => stamp(sql, ids, issue),
            readThem: (ids) => `SELECT id, created_at, message FROM public.feedback WHERE id IN (${ids.join(', ')});`,
        }, {repo, token, authors: new Set([WORKFLOW_AUTHOR])});
    } finally {
        await sql.end({timeout: 5});
    }
}

// Only when run as a script; importing this module for tests must not connect.
if (process.argv[1]?.endsWith('notify.ts')) {
    main().catch((error: unknown) => {
        console.error(`[feedback] failed: ${maskDsn(error)}`);
        process.exitCode = 1;
    });
}
