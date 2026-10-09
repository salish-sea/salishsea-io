/**
 * Filing feedback as GitHub issues — the half of the notifier that does not care
 * where the feedback is kept (decision 039; decision 065 moves it from Postgres to
 * the store on the machine).
 *
 * Idempotent by construction: it claims rows nobody has stamped and stamps each one
 * immediately after its issue is created, so a crash halfway through re-files
 * nothing. Re-running is always safe, but two runs at once are not: both would read
 * the same unstamped rows. api/notifier.ts keeps to one at a time by running in the
 * one process that owns the store.
 *
 * Never put a reporter's name or email in an issue — see issue.ts for why.
 */

import { filedRowIds, issueForFeedback, rowMarker, type FeedbackRow } from './issue.ts';

/** Where the feedback is kept: the rows waiting to be filed, and how to mark them filed. */
export type FeedbackQueue = {
    /** At most `limit` rows nobody has stamped, oldest first. */
    unnotified(limit: number): Promise<FeedbackRow[]>,
    /** Mark rows notified. `issue` is null when an earlier run already filed them. */
    stamp(ids: readonly string[], issue: number | null): Promise<void>,
    /** How a maintainer reads these rows in full, for a digest to quote. */
    readThem(ids: readonly string[]): string,
};

/** Where issues go, and as whom: `authors` are the logins whose issues count as ours. */
export type IssueTracker = {repo: string, token: string, authors: ReadonlySet<string>};

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

/**
 * How long to wait on GitHub before giving up.
 *
 * A request that hangs holds up the run — and with it the workflow's advisory
 * lock and concurrency slot, or the machine's next run — until something else
 * gives up, which for a job is hours. Aborting turns that into a failed run
 * whose rows are simply picked up by the next.
 */
const GITHUB_TIMEOUT_MS = 30_000;

/**
 * Who filed these issues from GitHub Actions — `secrets.GITHUB_TOKEN` posts as
 * this. The notifier on the machine (api/notifier.ts) posts as whoever its token
 * belongs to, and counts both as its own, since the store's rows carry on
 * Postgres's ids.
 *
 * If a notifier ever authenticates as someone it does not name, alreadyFiled()
 * stops recognising its own work and the worst case is a duplicated issue, never
 * a swallowed report. That is the right way round for this to break.
 */
export const WORKFLOW_AUTHOR = 'github-actions[bot]';


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

/**
 * Row ids we have already filed an issue for.
 *
 * Listed rather than searched: GitHub's search index lags by seconds to
 * minutes, and the window this closes is a re-run moments after a crash —
 * exactly when search would still be blind.
 */
export async function alreadyFiled(repo: string, token: string, oldestRow: Date,
    authors: ReadonlySet<string> = new Set([WORKFLOW_AUTHOR])): Promise<Set<string>> {
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
        const ours = issues.filter((issue) => issue.user !== null && authors.has(issue.user.login));
        // And only issues created since the oldest row in hand: an issue is always created
        // after the row it reports, so an older one names an older row that happened to
        // have the same id. That happens: the store's feedback ids began again at 1 after
        // Postgres's table had been emptied, and #440 and #442 name row 2 (decision 065).
        const since = ours.filter((issue) => !(new Date(issue.created_at) < oldestRow));
        for (const id of filedRowIds(since.map((issue) => issue.body))) ids.add(id);

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
export function digestFor(rows: readonly FeedbackRow[], readThem: (ids: readonly string[]) => string): {title: string; body: string} {
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
            readThem(rows.map((r) => r.id)),
            '```',
            '',
            'No submitted text is quoted here, deliberately — a flood is the worst case in which to paste anonymous input into a public issue. 🤖',
            ...rows.map((row) => rowMarker(row.id)),
        ].join('\n'),
    };
}

/** File an issue for each row waiting in `queue`, or one for all when many arrive at once. */
export async function fileFeedback(queue: FeedbackQueue, {repo, token, authors}: IssueTracker): Promise<void> {
    const claimed = await queue.unnotified(MAX_PER_RUN);
    if (claimed.length === 0) {
        console.log('[feedback] nothing new');
        return;
    }

    // Drop anything a previous run filed but was killed before stamping.
    // rows are ordered oldest-first, so claimed[0] bounds the search.
    const filed = await alreadyFiled(repo, token, new Date(claimed[0]!.created_at), authors);
    const rows = claimed.filter((row) => !filed.has(row.id));
    if (rows.length < claimed.length)
        console.log(`[feedback] ${claimed.length - rows.length} already filed by an earlier run; stamping without re-filing`);

    if (rows.length > DIGEST_THRESHOLD) {
        const number = await createIssue(repo, token, digestFor(rows, queue.readThem));
        await queue.stamp(rows.map((row) => row.id), number);
        console.log(`[feedback] ${rows.length} reports digested into #${number}`);
    } else {
        for (const row of rows) {
            const number = await createIssue(repo, token, issueForFeedback(row));
            // Stamped immediately, one at a time: if the next call throws,
            // the rows already filed stay filed. A crash in the gap between
            // this POST and this UPDATE is what alreadyFiled() covers.
            await queue.stamp([row.id], number);
            console.log(`[feedback] row ${row.id} -> #${number}`);
        }
    }

    // Rows filed earlier still need stamping, or they are looked at forever.
    const preFiled = claimed.filter((row) => filed.has(row.id)).map((row) => row.id);
    if (preFiled.length > 0) await queue.stamp(preFiled, null);
}
