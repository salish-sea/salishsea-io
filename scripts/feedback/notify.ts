/**
 * File a GitHub issue for each new piece of feedback — imperative shell
 * (decision 039; decision 011's two tiers).
 *
 * Feedback lands in `public.feedback`, which nothing but this reads. Without a
 * notifier it would sit there unseen, which is the same outcome as the widget
 * that dropped reports on the floor — the failure decision 039 exists to end.
 *
 * Idempotent by construction: it claims rows where `notified_at IS NULL` and
 * stamps each one immediately after its issue is created, so a crash halfway
 * through re-files nothing. Re-running is always safe.
 *
 * Security: NEVER log the DSN (same rule as scripts/dwca/guard.ts and
 * scripts/ingest/heartbeat.ts), and never put a reporter's name or email in an
 * issue — see issue.ts for why.
 */

import postgres from 'postgres';
import type { Sql } from 'postgres';
import { issueForFeedback, type FeedbackRow } from './issue.ts';

/** Most a single run will file, so a spam flood cannot open 500 issues. */
const MAX_PER_RUN = 20;

function maskDsn(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/postgres(?:ql)?:\/\/[^\s]*/gi, 'postgres://<redacted>');
}

export async function unnotified(sql: Sql, limit: number): Promise<FeedbackRow[]> {
    return sql<FeedbackRow[]>`
        SELECT id, created_at, message, page_url, user_agent, release,
               (user_uuid IS NOT NULL) AS signed_in
        FROM public.feedback
        WHERE notified_at IS NULL
        ORDER BY created_at
        LIMIT ${limit}`;
}

async function createIssue(repo: string, token: string, issue: {title: string; body: string}): Promise<number> {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-github-api-version': '2022-11-28',
        },
        // `feedback` to find them; `needs-triage` because nobody has read it
        // yet and it should join the same queue as everything else unreviewed.
        body: JSON.stringify({...issue, labels: ['feedback', 'needs-triage']}),
    });
    if (!response.ok) {
        throw new Error(`GitHub refused the issue: ${response.status} ${await response.text()}`);
    }
    const created = await response.json() as {number: number};
    return created.number;
}

async function main(): Promise<void> {
    const dsn = process.env['SUPABASE_DB_URL'];
    const token = process.env['GITHUB_TOKEN'];
    const repo = process.env['GITHUB_REPOSITORY'];
    if (!dsn || !token || !repo)
        throw new Error('SUPABASE_DB_URL, GITHUB_TOKEN and GITHUB_REPOSITORY are all required');

    const sql = postgres(dsn, {prepare: false, max: 1});
    try {
        const rows = await unnotified(sql, MAX_PER_RUN);
        if (rows.length === 0) {
            console.log('[feedback] nothing new');
            return;
        }
        console.log(`[feedback] ${rows.length} to file`);

        for (const row of rows) {
            const number = await createIssue(repo, token, issueForFeedback(row));
            // Stamped one at a time, immediately: if the next call throws, the
            // rows already filed stay filed and are never duplicated.
            await sql`
                UPDATE public.feedback
                SET notified_at = now(), github_issue = ${number}
                WHERE id = ${row.id}`;
            console.log(`[feedback] row ${row.id} -> #${number}`);
        }
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
