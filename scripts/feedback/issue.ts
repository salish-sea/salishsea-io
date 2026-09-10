/**
 * Turning a feedback row into a GitHub issue — functional core (decision 011's
 * two tiers; decision 039 for why the notifier exists at all).
 *
 * Pure, so the part that is easy to get wrong can be tested without a database
 * or a GitHub token. The imperative shell (notify.ts) does the querying, the
 * posting and the stamping.
 */

/** The columns the notifier reads. `name` and `email` are deliberately absent. */
export type FeedbackRow = {
    /**
     * The row id, as a string.
     *
     * postgres.js hands back a `bigint` as a string because JS numbers cannot
     * hold the range, and converting would alias distinct ids above 2^53 — two
     * different reports collapsing onto one, so a marker for either would
     * exclude the other and lose a report. Nothing here does arithmetic on it;
     * it is a name, so it stays the shape the database gave us.
     */
    id: string;
    /** postgres.js hands back a Date; a fixture may hand back a string. */
    created_at: Date | string;
    message: string;
    page_url: string | null;
    user_agent: string | null;
    release: string | null;
    /** Whether the reporter was signed in — never *who*. */
    signed_in: boolean;
};

export type Issue = {title: string; body: string};

const TITLE_MAX = 72;

/**
 * A timestamp that reads the same wherever it is printed.
 *
 * `Date.prototype.toString` renders in the runner's locale and zone — "Wed Sep
 * 09 2026 17:11:41 GMT-0700 (Pacific Daylight Time)" — which is noise in an
 * issue read months later from anywhere. UTC, ISO, to the second.
 */
export function submittedAt(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
        ? String(value)
        : `${date.toISOString().slice(0, 19).replace('T', ' ')}Z`;
}

/**
 * A fence long enough that the content cannot end the block.
 *
 * A message containing ``` would otherwise close the fence early and let the
 * rest render as markdown, which is the whole thing we are preventing.
 */
export function fenceFor(content: string): string {
    const longest = [...content.matchAll(/`+/g)].reduce((max, [run]) => Math.max(max, run.length), 0);
    return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * A one-line title, taken from the report but never *rendered* from it.
 *
 * Collapsed to a single line and truncated: a title is a summary, and a
 * newline or 5,000 characters of it is neither.
 */
export function titleFor(row: FeedbackRow): string {
    const firstLine = row.message.replace(/\s+/g, ' ').trim();
    const summary = firstLine.length > TITLE_MAX
        ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…`
        : firstLine;
    return `Feedback: ${summary || '(no message)'}`;
}

/**
 * The issue body.
 *
 * Two rules, both because this repo is public and the person writing had no
 * say in that beyond the note on the form:
 *
 * **The message goes in a fenced code block, never a blockquote.** Markdown
 * renders inside blockquotes, so a report containing `@someone` would notify a
 * stranger, and one containing an image would embed it. A fence renders none of
 * it — no mentions, no autolinks, no images — which is the correct treatment for
 * text an anonymous person typed into a form.
 *
 * **Name and email never appear.** They stay in the `feedback` table, which no
 * client can read; the row id is here so they can be looked up by someone with
 * database access when a reply is warranted.
 */
/**
 * The marker that says which row an issue came from.
 *
 * An HTML comment, so it renders as nothing, and machine-readable, so the
 * notifier can tell what it has already filed. That matters because the GitHub
 * POST and the `notified_at` stamp are two operations: a runner killed between
 * them leaves a filed issue on an unstamped row, and the next run would file it
 * again. Cheaper to recognise our own work than to make the two atomic.
 */
export const rowMarker = (id: string): string => `<!-- feedback-row:${id} -->`;

/**
 * Row ids already filed, read back out of existing issue bodies.
 *
 * Only the run of markers at the very END of a body counts, which is where we
 * write them. Matching anywhere would let a *report* claim a row: a message
 * containing the marker text for row 999 would make 999 look filed, and the
 * notifier would then stamp 999 without ever creating its issue — losing a real
 * person's report, which is the one outcome this whole change exists to
 * prevent. The fence stops the marker rendering; it does not stop a regex
 * finding it.
 */
export function filedRowIds(bodies: readonly (string | null | undefined)[]): Set<string> {
    const ids = new Set<string>();
    for (const body of bodies) {
        // Walk back from the end, taking marker lines until anything else.
        const lines = (body ?? '').trimEnd().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const match = /^<!-- feedback-row:(\d+) -->$/.exec(lines[i]!.trim());
            if (!match) break;
            ids.add(match[1]!);
        }
    }
    return ids;
}

export function issueForFeedback(row: FeedbackRow): Issue {
    const fence = fenceFor(row.message);

    // Everything the client sent goes inside a fence, not just the message.
    // page_url, user_agent and release are all arguments to a public RPC, so
    // they are exactly as untrusted as the message is — rendered as markdown
    // bullets, a crafted user_agent could mention people or embed an image just
    // as well as a crafted message could.
    const reported = [
        row.page_url ? `Page:    ${row.page_url}` : null,
        row.user_agent ? `Browser: ${row.user_agent}` : null,
        row.release ? `Release: ${row.release}` : null,
    ].filter((line): line is string => line !== null).join('\n');
    const reportedFence = fenceFor(reported);

    // Ours, and safe to render: we wrote every character of these.
    const ours = [
        `- Submitted: ${submittedAt(row.created_at)}`,
        `- From: ${row.signed_in ? 'a signed-in contributor' : 'a visitor who was not signed in'}`,
        `- Contact details: \`feedback\` row ${row.id} (not published here)`,
    ];

    return {
        title: titleFor(row),
        body: [
            'Someone sent this through the feedback form on salishsea.io.',
            '',
            `${fence}`,
            row.message,
            `${fence}`,
            '',
            ...ours,
            ...(reported ? ['', 'Reported by their browser:', reportedFence, reported, reportedFence] : []),
            '',
            'Their name and email address are in the database, not in this issue. 🤖',
            rowMarker(row.id),
        ].join('\n'),
    };
}
