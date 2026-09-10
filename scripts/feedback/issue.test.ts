import { describe, expect, test } from 'vitest';
import { fenceFor, issueForFeedback, submittedAt, titleFor, type FeedbackRow } from './issue.ts';

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

    test('carries the context nobody could be asked for', () => {
        const {body} = issueForFeedback(row());
        expect(body).toContain('iPhone OS 18_6');
        expect(body).toContain('- Release: dfcb299');
    });

    test('omits context lines it does not have, rather than printing null', () => {
        const {body} = issueForFeedback(row({page_url: null, user_agent: null, release: null}));
        expect(body).not.toContain('null');
        expect(body).not.toContain('- Page:');
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
