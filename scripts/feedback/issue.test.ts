import { describe, expect, test } from 'vitest';
import { fenceFor, filedRowIds, issueForFeedback, rowMarker, submittedAt, titleFor, type FeedbackRow } from './issue.ts';

const row = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
    id: 41,
    created_at: '2026-09-08T22:11:00Z',
    message: 'Trouble uploading pix for Jpod.',
    page_url: 'https://salishsea.io/',
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6)',
    release: 'dfcb299',
    signed_in: true,
    ...over,
});

describe('what reaches a public issue', () => {
    test('the message is fenced, so nothing in it renders', () => {
        const {body} = issueForFeedback(row({message: 'cc @octocat ![img](http://x/y.png)'}));
        // Inside a fence, an @mention notifies nobody and an image is not
        // embedded. A blockquote would render both — this repo is public and
        // anyone at all can submit.
        expect(body).toContain('```\ncc @octocat ![img](http://x/y.png)\n```');
    });

    test('a message containing a fence cannot break out of the block', () => {
        const message = 'here is my code:\n```\nboom\n```\nand @everyone';
        const {body} = issueForFeedback(row({message}));
        const fence = fenceFor(message);

        expect(fence).toBe('````');
        expect(body).toContain(`${fence}\n${message}\n${fence}`);
        // The inner ``` never terminates the outer block.
        expect(body.split(fence)).toHaveLength(3);
    });

    test('never carries the reporter’s name or email', () => {
        // The row type has no such fields, which is the real guarantee; this
        // pins the shape so a later "helpful" addition has to argue with a test.
        const {body, title} = issueForFeedback(row());
        expect(Object.keys(row())).not.toContain('name');
        expect(Object.keys(row())).not.toContain('email');
        expect(`${title}\n${body}`).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
        expect(body).toContain('`feedback` row 41 (not published here)');
    });

    test('says whether they were signed in, but not who they are', () => {
        expect(issueForFeedback(row({signed_in: true})).body).toContain('a signed-in contributor');
        expect(issueForFeedback(row({signed_in: false})).body).toContain('was not signed in');
    });

    test('fences what the browser reported too, not just the message', () => {
        // page_url, user_agent and release are arguments to a public RPC, so
        // they are exactly as untrusted as the message. Rendered as bullets, a
        // crafted user_agent could mention people or embed an image.
        const {body} = issueForFeedback(row({user_agent: 'Mozilla/5.0 @octocat ![x](http://e/y.png)'}));
        const fenced = body.slice(body.indexOf('Reported by their browser:'));
        expect(fenced).toMatch(/```[\s\S]*Browser: Mozilla\/5\.0 @octocat !\[x\]\(http:\/\/e\/y\.png\)[\s\S]*```/);
        // Not a markdown bullet, which would have rendered both.
        expect(body).not.toContain('- Browser:');
    });

    test('carries the context nobody could be asked for', () => {
        const {body} = issueForFeedback(row());
        expect(body).toContain('iPhone OS 18_6');
        expect(body).toContain('Release: dfcb299');
    });

    test('omits context lines it does not have, rather than printing null', () => {
        const {body} = issueForFeedback(row({page_url: null, user_agent: null, release: null}));
        expect(body).not.toContain('null');
        expect(body).not.toContain('- Page:');
    });
});

describe('recognising what we already filed', () => {
    test('every issue carries an invisible row marker', () => {
        expect(issueForFeedback(row({id: 41})).body).toContain('<!-- feedback-row:41 -->');
    });

    test('markers are read back so a crash between POST and stamp cannot duplicate', () => {
        const bodies = [issueForFeedback(row({id: 41})).body, issueForFeedback(row({id: 43})).body, null, undefined];
        expect(filedRowIds(bodies)).toEqual(new Set([41, 43]));
    });

    test('a body someone else wrote contributes nothing', () => {
        expect(filedRowIds(['just a normal issue', ''])).toEqual(new Set());
    });

    test('a report that quotes a marker cannot forge one, because it is fenced', () => {
        // The marker is real markup only outside the fence; inside, it is text.
        const body = issueForFeedback(row({id: 7, message: rowMarker(999)})).body;
        expect(filedRowIds([body])).toEqual(new Set([999, 7]));
        // Both are found by a plain regex, so the notifier must not treat a
        // match as proof on its own — it only ever skips rows it is looking at,
        // and the worst case is one report needing a manual look. Pinned here
        // so the limitation is on the record rather than a surprise.
    });
});

describe('the timestamp', () => {
    test('is UTC and ISO, not the runner’s locale', () => {
        // A Date rendered with toString() reads "Wed Sep 09 2026 17:11:41
        // GMT-0700 (Pacific Daylight Time)" — the CI runner's zone, which means
        // nothing to someone reading the issue later.
        expect(submittedAt(new Date('2026-09-08T22:11:00Z'))).toBe('2026-09-08 22:11:00Z');
        expect(submittedAt('2026-09-08T22:11:00Z')).toBe('2026-09-08 22:11:00Z');
        expect(issueForFeedback(row({created_at: new Date('2026-09-08T22:11:00Z')})).body)
            .toContain('- Submitted: 2026-09-08 22:11:00Z');
    });

    test('an unparseable value is passed through rather than printed as Invalid Date', () => {
        expect(submittedAt('not a date')).toBe('not a date');
    });
});

describe('the title', () => {
    test('summarises the report', () => {
        expect(titleFor(row())).toBe('Feedback: Trouble uploading pix for Jpod.');
    });

    test('collapses newlines — a title is one line', () => {
        expect(titleFor(row({message: 'first\n\nsecond'}))).toBe('Feedback: first second');
    });

    test('truncates a long report instead of pasting all 5,000 characters', () => {
        const title = titleFor(row({message: 'x'.repeat(5000)}));
        expect(title.length).toBeLessThanOrEqual('Feedback: '.length + 72);
        expect(title.endsWith('…')).toBe(true);
    });

    test('survives a message that is only whitespace', () => {
        // The CHECK constraint rejects an empty message, but not a shrug.
        expect(titleFor(row({message: '   '}))).toBe('Feedback: (no message)');
    });
});
