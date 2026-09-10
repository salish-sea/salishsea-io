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
    id: number;
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
export function issueForFeedback(row: FeedbackRow): Issue {
    const fence = fenceFor(row.message);
    const context = [
        `- Submitted: ${submittedAt(row.created_at)}`,
        `- From: ${row.signed_in ? 'a signed-in contributor' : 'a visitor who was not signed in'}`,
        row.page_url ? `- Page: ${row.page_url}` : null,
        row.user_agent ? `- Browser: ${row.user_agent}` : null,
        row.release ? `- Release: ${row.release}` : null,
        `- Contact details: \`feedback\` row ${row.id} (not published here)`,
    ].filter((line): line is string => line !== null);

    return {
        title: titleFor(row),
        body: [
            'Someone sent this through the feedback form on salishsea.io.',
            '',
            `${fence}`,
            row.message,
            `${fence}`,
            '',
            ...context,
            '',
            'Their name and email address are in the database, not in this issue. 🤖',
        ].join('\n'),
    };
}
