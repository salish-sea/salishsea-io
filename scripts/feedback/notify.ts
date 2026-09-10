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
import { filedRowIds, issueForFeedback, rowMarker, type FeedbackRow } from './issue.ts';

/** Most rows a single run will look at. */
const MAX_PER_RUN = 50;

/**
 * Above this many at once, file one issue instead of one each.
 *
 * The submit endpoint is open to anonymous callers by design — asking someone
 * to sign in before they can say the site is broken defeats the point — so
 * nothing stops a script filling the table. One issue per row would turn that
 * into an unusable tracker. A digest bounds the damage at one issue per run
 * whatever arrives, and it is the better outcome for the honest burst too: when
 * a bad deploy makes twenty people write in, one issue listing twenty reports
 * is what you actually want to read. Nothing is discarded either way — every
 * row is stamped, and the full text is in the table.
 */
const DIGEST_THRESHOLD = 8;

/** Arbitrary but fixed; only this script uses it. See main() for why. */
const ADVISORY_LOCK_KEY = 8_390_217_004_113_705;

/**
 * How long to wait on GitHub before giving up.
 *
 * Both calls happen while the advisory lock is held, so a request that hangs
 * holds it — and the workflow's concurrency slot — until the job's own timeout,
 * which is hours. Aborting turns that into a failed run whose rows are simply
 * picked up fifteen minutes later.
 */
const GITHUB_TIMEOUT_MS = 30_000;

/**
 * Who files these issues — `secrets.GITHUB_TOKEN` posts as this.
 *
 * If the workflow ever authenticates as something else, alreadyFiled() stops
 * recognising its own work and the worst case is a duplicated issue, never a
 * swallowed report. That is the right way round for this to break.
 */
const WORKFLOW_AUTHOR = 'github-actions[bot]';

/**
 * A stop, not a budget.
 *
 * The loop above ends when it reaches issues older than the oldest row in hand,
 * which in normal operation is the first page. This only exists so a surprise
 * cannot turn the walk into thousands of requests.
 */
const MAX_ISSUE_PAGES = 20;

/** GitHub's maximum, and what the walk asks for. */
const ISSUES_PER_PAGE = 100;

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
 * Row ids we have already filed an issue for.
 *
 * Listed rather than searched: GitHub's search index lags by seconds to
 * minutes, and the window this closes is a re-run moments after a crash —
 * exactly when search would still be blind.
 */
export async function alreadyFiled(repo: string, token: string, oldestRow: Date): Promise<Set<string>> {
    const ids = new Set<string>();

    // Walk back only as far as the oldest row we are about to consider.
    //
    // An issue is always created after the row it reports, so nothing older
    // than `oldestRow` can be one of ours, and there is no reason to read the
    // years of feedback issues behind it. That makes the work bounded by how
    // long a report has been waiting rather than by how many we have ever
    // filed — which is the property worth having, because the alternative
    // arguments ("one page is surely enough") are the kind that hold until
    // quietly they do not.
    //
    // Stopping early can only ever make this return FEWER ids, and the cost of
    // that is a duplicate issue. Reading too few would cost a lost report. The
    // asymmetry is why the loop errs towards stopping.
    for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
        const response = await fetch(
            `https://api.github.com/repos/${repo}/issues`
                + `?labels=feedback&state=all&per_page=${ISSUES_PER_PAGE}&sort=created&direction=desc&page=${page}`,
            {headers: githubHeaders(token), signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS)},
        );
        if (!response.ok) {
            // Proceeding blind risks duplicates, and a duplicate is noise while
            // a missed report is a loss — but so is filing nothing. Stop and
            // let the next run try: the rows stay unstamped, so nothing is lost.
            throw new Error(`Could not list existing feedback issues: ${response.status}`);
        }
        const issues = await response.json() as {
            body: string | null;
            created_at: string;
            user: {login: string} | null;
        }[];
        // A short page is the end of the results — the ordinary way this stops.
        const lastPage = issues.length < ISSUES_PER_PAGE;
        if (issues.length === 0) break;

        // Only markers in issues WE wrote count. The label is applied by hand as
        // often as by us — a maintainer triaging a user's issue as `feedback` is
        // the ordinary case — and a body ending in a marker would then let that
        // issue claim a row, so the row would be stamped with nothing filed for
        // it. Hand-labelled issues still occupy places in the listing, which is
        // the other reason not to reason about page counts.
        const ours = issues.filter((issue) => issue.user?.login === WORKFLOW_AUTHOR);
        for (const id of filedRowIds(ours.map((issue) => issue.body))) ids.add(id);

        const oldestOnPage = new Date(issues[issues.length - 1]!.created_at);
        if (lastPage || Number.isNaN(oldestOnPage.getTime()) || oldestOnPage < oldestRow) break;
    }
    return ids;
}

function githubHeaders(token: string): Record<string, string> {
    return {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
    };
}

async function createIssue(repo: string, token: string, issue: {title: string; body: string}): Promise<number> {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: 'POST',
        headers: githubHeaders(token),
        // `feedback` to find them — alreadyFiled() lists by this label, so it is
        // load-bearing, not decoration; `needs-triage` because nobody has read
        // it yet and it should join the queue with everything else unreviewed.
        body: JSON.stringify({...issue, labels: ['feedback', 'needs-triage']}),
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`GitHub refused the issue: ${response.status} ${await response.text()}`);
    }
    const created = await response.json() as {number: number};
    return created.number;
}

/**
 * One issue for many reports, when many arrive at once.
 *
 * The bodies are not quoted here — a flood is the case where quoting anonymous
 * text into a public issue is least advisable, and the reports are all in the
 * table. This is a pointer with enough shape to judge whether it is a spam run
 * or twenty people hitting the same broken deploy.
 */
export function digestFor(rows: readonly FeedbackRow[]): {title: string; body: string} {
    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    return {
        title: `Feedback: ${rows.length} reports arrived at once`,
        body: [
            `${rows.length} pieces of feedback arrived between ${String(first.created_at)} and ${String(last.created_at)} — more than the ${DIGEST_THRESHOLD} this notifier will file individually, so they are collected here.`,
            '',
            'This is either a burst of real reports (a bad deploy will do it) or an automated flood. Nothing is lost either way: every report is in the `feedback` table in full.',
            '',
            'Read them:',
            '',
            '```',
            `SELECT id, created_at, message FROM public.feedback WHERE id IN (${rows.map((r) => r.id).join(', ')});`,
            '```',
            '',
            'No submitted text is quoted here, deliberately — a flood is the worst case in which to paste anonymous input into a public issue. 🤖',
            ...rows.map((row) => rowMarker(row.id)),
        ].join('\n'),
    };
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

        const claimed = await unnotified(sql, MAX_PER_RUN);
        if (claimed.length === 0) {
            console.log('[feedback] nothing new');
            return;
        }

        // Drop anything a previous run filed but was killed before stamping.
        // rows are ordered oldest-first, so claimed[0] bounds the search.
        const filed = await alreadyFiled(repo, token, new Date(claimed[0]!.created_at));
        const rows = claimed.filter((row) => !filed.has(row.id));
        if (rows.length < claimed.length)
            console.log(`[feedback] ${claimed.length - rows.length} already filed by an earlier run; stamping without re-filing`);

        if (rows.length > DIGEST_THRESHOLD) {
            const number = await createIssue(repo, token, digestFor(rows));
            await stamp(sql, rows.map((row) => row.id), number);
            console.log(`[feedback] ${rows.length} reports digested into #${number}`);
        } else {
            for (const row of rows) {
                const number = await createIssue(repo, token, issueForFeedback(row));
                // Stamped immediately, one at a time: if the next call throws,
                // the rows already filed stay filed. A crash in the gap between
                // this POST and this UPDATE is what alreadyFiled() covers.
                await stamp(sql, [row.id], number);
                console.log(`[feedback] row ${row.id} -> #${number}`);
            }
        }

        // Rows filed earlier still need stamping, or they are looked at forever.
        const preFiled = claimed.filter((row) => filed.has(row.id)).map((row) => row.id);
        if (preFiled.length > 0) await stamp(sql, preFiled, null);
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
