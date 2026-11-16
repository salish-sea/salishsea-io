/**
 * The reader of a sent Facebook post, on made-up posts in the shape of Facebook's markup of
 * November 2026. Real posts are not checked in, because they carry members' names.
 */
import { describe, expect, test } from 'vitest';

import { agoToTime, EXPANDERS, postAddress, postId, readFacebookPost, UnreadablePost } from './facebook-post.ts';

const SENT = 1_794_000_000;
const link = (c: number, r?: number) =>
    `<a href="https://www.facebook.com/groups/1/posts/2/?comment_id=${c}${r ? `&amp;reply_comment_id=${r}` : ''}&amp;__cft__=x">1h</a>`;
const comment = (label: string, links: string, text: string) =>
    `<div role="article" aria-label="${label}">${links}<div dir="auto">${text}</div></div>`;
const post = (comments: string, {collapsed = true} = {}) => `
<div role="dialog"><div>
  <div dir="auto"><div dir="auto">Thursday, November 12th - ORCAS (Port Susan)</div><div dir="auto">.</div>
    <div dir="auto">10:30 - Orcas, Tillicum Beach [Camano] heading south.</div><div dir="auto">.</div></div>
  <div role="button">All comments</div>
  ${comments}
  ${collapsed ? '<div role="button">View 2 replies</div>' : ''}
</div></div>`;
const day = post([
    comment('Comment by Pat Example 2 hours ago', link(101), '1145 Exiting Port Susan close to Camano. Currently SB.'),
    comment('Reply by Orca Network to Pat Example\'s comment about an hour ago', link(101, 102), 'How many were there?'),
    comment('Reply by Pat Example to Orca Network\'s reply 45 minutes ago', link(101, 103), '3-4. Including a male.'),
    comment('Comment by Sam Sample a day ago', link(104), 'T137s currently westbound here 11:50'),
].join('\n'));

describe('readFacebookPost', () => {
    test('reads the post\'s lines, then its comments and replies in order', () => {
        const r = readFacebookPost(day, SENT);
        expect(r.lines).toEqual(['Thursday, November 12th - ORCAS (Port Susan)', '10:30 - Orcas, Tillicum Beach [Camano] heading south.']);
        expect(r.comments.map(c => [c.kind, c.id, c.replyTo, c.author, c.ago, SENT - c.at])).toEqual([
            ['comment', '101', null, 'Pat Example', '2 hours ago', 7200],
            ['reply', '102', '101', 'Orca Network', 'about an hour ago', 3600],
            ['reply', '103', '101', 'Pat Example', '45 minutes ago', 2700],
            ['comment', '104', null, 'Sam Sample', 'a day ago', 86400],
        ]);
        expect(r.comments[0]!.text).toBe('1145 Exiting Port Susan close to Camano. Currently SB.');
        expect([r.collapsed, r.sort]).toEqual([1, 'All comments']);
        expect(r.address).toEqual({group: '1', post: '2'});
    });

    test('a post with no comments yet is read', () => {
        const r = readFacebookPost(post('', {collapsed: false}), SENT);
        expect([r.lines.length, r.comments, r.collapsed, r.address]).toEqual([2, [], 0, null]);
    });

    test('a comment\'s line breaks and <br>s become lines; a photo-only comment has no text', () => {
        const r = readFacebookPost(post([
            comment('Comment by Pat Example 5 minutes ago', link(7), 'Off Alki<br>heading north<div>11:05</div>'),
            `<div role="article" aria-label="Comment by Sam Sample just now">${link(8)}<a href="https://www.facebook.com/photo/?fbid=9"><img></a></div>`,
        ].join('')), SENT);
        expect(r.comments.map(c => [c.text, c.at])).toEqual([['Off Alki\nheading north\n11:05', SENT - 300], ['', SENT]]);
    });

    test('photos and videos, in the post and in a comment, as links to Facebook without tracking', () => {
        const html = `<div role="dialog"><div dir="auto">10:30 Orcas</div>
            <a href="https://www.facebook.com/photo/?fbid=111&amp;set=gm.1&amp;__cft__=x"><img src="https://scontent.xx.fbcdn.net/a.jpg"></a>
            <div role="article" aria-label="Comment by Pat Example 5 minutes ago">${link(7)}<div dir="auto">Here they are</div>
              <a href="https://www.facebook.com/photo.php?fbid=222&amp;set=p.222&amp;__tn__=x"><img></a>
              <a href="https://www.facebook.com/Someone/videos/333/?__cft__=x">video</a>
              <a href="https://www.facebook.com/watch/?v=444&amp;x=1">watch</a>
              <a href="https://example.com/photo/?fbid=555">elsewhere</a></div></div>`;
        const r = readFacebookPost(html, SENT);
        expect(r.media).toEqual(['https://www.facebook.com/photo/?fbid=111']);
        expect(r.comments[0]!.media).toEqual([
            'https://www.facebook.com/photo/?fbid=222',
            'https://www.facebook.com/Someone/videos/333',
            'https://www.facebook.com/watch/?v=444',
        ]);
    });

    test('a malformed link does not lose the send', () => {
        const r = readFacebookPost(`<div role="main"><div dir="auto">10:30 Orcas</div><a href="http://[">x</a>
            <div role="article" aria-label="Comment by Pat Example 5 minutes ago"><a href="http://[?comment_id=1">x</a>${link(8)}<div dir="auto">Still there</div></div></div>`, SENT);
        expect([r.lines, r.comments.map(c => c.id), r.media]).toEqual([['10:30 Orcas'], ['8'], []]);
    });

    test('a comment nested inside another keeps its own text, links and media', () => {
        const r = readFacebookPost(post(
            `<div role="article" aria-label="Comment by Pat Example 2 hours ago">${link(1)}<div dir="auto">Mine</div>
               ${comment('Reply by Sam Sample to Pat Example\'s comment an hour ago', link(1, 2), 'Theirs')}</div>`), SENT);
        expect(r.comments.map(c => [c.id, c.replyTo, c.text])).toEqual([['1', null, 'Mine'], ['2', '1', 'Theirs']]);
    });

    test('a link to another comment in a comment\'s text is not its own id', () => {
        const r = readFacebookPost(post(comment('Comment by Pat Example 2 hours ago', link(101),
            `Same group as <a href="https://www.facebook.com/groups/1/posts/2/?comment_id=999">this one</a>`)), SENT);
        expect(r.comments.map(c => [c.id, c.text])).toEqual([['101', 'Same group as this one']]);
    });

    test('a comment inside a block of another\'s text is not part of that text', () => {
        const r = readFacebookPost(post(
            `<div role="article" aria-label="Comment by Pat Example 2 hours ago">${link(1)}<div dir="auto">Mine
               ${comment('Reply by Sam Sample to Pat Example\'s comment an hour ago', link(1, 2), 'Theirs')}</div></div>`), SENT);
        expect(r.comments.map(c => [c.id, c.text])).toEqual([['1', 'Mine'], ['2', 'Theirs']]);
    });

    describe('fails loudly when Facebook\'s markup has changed', () => {
        test('every comment reads as empty', () => {
            const html = post([1, 2].map(n => `<div role="article" aria-label="Comment by Pat Example 2 hours ago">${link(n)}<p>11:45 off Alki</p></div>`).join(''));
            expect(() => readFacebookPost(html, SENT)).toThrow(/no text in any comment/);
        });

        test('comments from two posts', () => {
            const other = '<a href="https://www.facebook.com/groups/1/posts/3/?comment_id=9">1h</a>';
            expect(() => readFacebookPost(post(comment('Comment by Pat Example 2 hours ago', link(1), 'x')
                + comment('Comment by Sam Sample 2 hours ago', other, 'y')), SENT)).toThrow(/more than one post/);
        });

        test('a comment whose permalinks disagree', () => {
            expect(() => readFacebookPost(post(comment('Comment by Pat Example 2 hours ago', link(1) + link(2), 'x')), SENT))
                .toThrow(/links to more than one comment_id/);
        });

        test('a page with no post text', () => {
            expect(() => readFacebookPost('<div role="main"><p>Something else</p></div>', SENT)).toThrow(UnreadablePost);
        });

        test('an article whose label is not a comment\'s, without naming the member', () => {
            const html = post(comment('Comment by Pat Example 2 hrs', link(1), 'x'));
            expect(() => readFacebookPost(html, SENT)).toThrow(UnreadablePost);
            expect(() => readFacebookPost(html, SENT)).toThrow(/^an article's label isn't a comment's or a reply's: "C… b… P… E… 2 h…"$/);
        });

        test('a comment without its comment_id', () => {
            expect(() => readFacebookPost(post(comment('Comment by Pat Example 2 hours ago', '<a href="/x">1h</a>', 'x')), SENT))
                .toThrow(/comment has no link with its comment_id/);
        });

        test('a reply without its own id', () => {
            expect(() => readFacebookPost(post(comment('Reply by Sam Sample to Pat Example\'s comment an hour ago', link(1), 'x')), SENT))
                .toThrow(/reply has no link with its reply_comment_id/);
        });
    });
});

test('Facebook\'s relative times count back from the send', () => {
    expect(agoToTime('2 hours ago', SENT)).toBe(SENT - 7200);
    expect(agoToTime('about an hour ago', SENT)).toBe(SENT - 3600);
    expect(agoToTime('a day ago', SENT)).toBe(SENT - 86400);
    expect(agoToTime('3 weeks ago', SENT)).toBe(SENT - 3 * 604800);
    expect(agoToTime('yesterday', SENT)).toBe(SENT - 86400);
    expect(agoToTime('just now', SENT)).toBe(SENT);
    expect(() => agoToTime('2h', SENT)).toThrow(UnreadablePost);
});

test('the buttons that still hide comments or replies', () => {
    for (const t of ['View more comments', 'View 2 replies', 'View all 3 replies', '5 replies', 'View previous comments', 'See more'])
        expect(t).toMatch(EXPANDERS);
    for (const t of ['Reply', 'Like', 'All comments', 'See more of this group']) expect(t).not.toMatch(EXPANDERS);
});

test('post ids from the post\'s address', () => {
    expect(postId('https://www.facebook.com/groups/564701038927716/permalink/1490225183041959/')).toBe('1490225183041959');
    expect(postId('https://www.facebook.com/groups/564701038927716/posts/1489227859808358')).toBe('1489227859808358');
    expect(postId('https://www.facebook.com/groups/564701038927716')).toBeNull();
});

test('the group and post an address names, on Facebook only', () => {
    expect(postAddress('https://web.facebook.com/groups/564701038927716/posts/1489227859808358/?__cft__=x'))
        .toEqual({group: '564701038927716', post: '1489227859808358'});
    expect(postAddress('https://m.facebook.com/groups/orca.network/permalink/14/')).toEqual({group: 'orca.network', post: '14'});
    for (const url of ['http://www.facebook.com/groups/1/posts/2', 'https://facebook.com.example/groups/1/posts/2',
        'https://www.facebook.com/groups/1/', 'https://www.facebook.com/groups/1/posts/2/photos', 'not an address'])
        expect(postAddress(url)).toBeNull();
});
