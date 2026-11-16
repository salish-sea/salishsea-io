/**
 * Reads a Facebook group's post, as the bookmarklet sends it, into the post's own lines and
 * its comments and replies (decision 117, bd salish-i1a.3.4). The demo's reader
 * (tools/facebook-demo/read.mjs), made strict.
 *
 * It relies on what Facebook's markup gave from 2026-11-08 to 2026-11-16, in all 34 posts
 * sent to the demo:
 *
 * - each comment and reply is an element with role="article" and an aria-label such as
 *   "Comment by <name> 2 hours ago" or "Reply by <name> to <name>'s comment 1 hour ago";
 *   no other element on the post has that role;
 * - its permalink, the "2h" beside its name and outside its text, carries comment_id, and
 *   a reply's also reply_comment_id, the reply's own id;
 * - replies are not nested inside the comment they answer;
 * - the post's own text is the dir="auto" blocks outside every comment.
 *
 * Facebook changes its markup often. When the post departs from that, this throws
 * UnreadablePost rather than leave out what it couldn't read: a send that reads as a quiet
 * day, or as a day short of a comment, would be wrong without anyone knowing.
 */

import { parseHTML } from 'linkedom';

export type FacebookComment = {
    /** Facebook's comment_id, or for a reply its reply_comment_id. */
    id: string,
    /** For a reply, the id of the comment it answers. */
    replyTo: string | null,
    kind: 'comment' | 'reply',
    author: string,
    /** Facebook's relative time, as it showed it: "2 hours ago", "a day ago". */
    ago: string,
    /** That time from when the post was sent, epoch seconds; no more precise than `ago`'s unit. */
    at: number,
    /** The comment's text, a line for each block; empty for a comment that is only a photo. */
    text: string,
    /** Links to its photos and videos on Facebook (see mediaIn). */
    media: string[],
};

export type FacebookPost = {
    /** The post's own text outside every comment, line by line, without lines of punctuation only. */
    lines: string[],
    media: string[],
    comments: FacebookComment[],
    /** How many buttons still hide comments or replies, or the rest of a long comment. */
    collapsed: number,
    /** How the comments were sorted, as Facebook's button says ("All comments"), or null if it isn't there. */
    sort: string | null,
    /** The group and post its comments' permalinks name, or null when it has no comments. */
    address: PostAddress | null,
};

/** A group's post, by Facebook's ids: the group's may be its number or its chosen name. */
export type PostAddress = {group: string, post: string};

/** The post doesn't have the shape this reader knows: Facebook has probably changed its markup. */
export class UnreadablePost extends Error {
    override name = 'UnreadablePost';
}

/** What was sent holds comments from more than one post: a feed, say, not a post. The sender's mistake, not Facebook's. */
export class NotOnePost extends Error {
    override name = 'NotOnePost';
}

/**
 * What hides part of a post: collapsed comments and replies, and a long comment cut short.
 * The bookmarklet (bd salish-i1a.3.8) clicks the same buttons; keep the two in step.
 */
export const EXPANDERS = /^(view ((more|all|previous) (\d+ )?|\d+ (more )?)(comments?|repl(y|ies))|\d+ (more )?repl(y|ies)|see more$)/i;
const SORTS = /^(most relevant|all comments|newest)$/i;
const LABEL = /^(Comment|Reply) by (.+?)(?: to (.+?)'s (?:comment|reply))? ((?:about )?(?:an?|\d+) (?:second|minute|hour|day|week|month|year)s? ago|just now|yesterday)$/i;

/**
 * @param html the post's element, as the bookmarklet sent it
 * @param sentAt when it was sent, epoch seconds: the time Facebook's "2 hours ago" counts back from
 */
export function readFacebookPost(html: string, sentAt: number): FacebookPost {
    const {document} = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
    const articles = [...document.querySelectorAll('[role="article"]')];

    // Each article's own part, and its permalinks: every link with a comment_id outside its
    // text (the "2h" beside its name). A link to another comment that a member pastes into
    // their text is not the comment's own.
    const parts = articles.map(a => {
        const nested = articles.filter(x => x !== a && a.contains(x));
        const own = <T extends Element>(nodes: Iterable<T>) => [...nodes].filter(n => !nested.some(x => x.contains(n)));
        const permalinks = own(a.querySelectorAll('a[href*="comment_id="]')).flatMap(link => {
            const block = link.closest('div[dir="auto"]');
            const u = block && a.contains(block) ? null : urlOf(link);
            return u?.searchParams.get('comment_id') ? [u] : [];
        });
        return {a, own, permalinks};
    });
    // The bookmarklet sends one post; comments from two would be a page it shouldn't have
    // sent. Asked first, so that a page of two posts is the sender's mistake even when
    // something on it can't be read.
    const addresses = new Set(parts.flatMap(p => p.permalinks.map(u => postAddress(u.href)))
        .flatMap(address => address ? [JSON.stringify([address.group, address.post])] : []));
    if (addresses.size > 1) throw new NotOnePost('its comments belong to more than one post');

    const comments: FacebookComment[] = [];
    for (const {a, own, permalinks} of parts) {
        const label = a.getAttribute('aria-label') ?? '';
        const m = LABEL.exec(label);
        if (!m) throw new UnreadablePost(`an article's label isn't a comment's or a reply's: ${shapeOf(label)}`);
        const [, kind = '', author = '', , ago = ''] = m;
        const ids = new Set(permalinks.map(u => JSON.stringify([u.searchParams.get('comment_id'), u.searchParams.get('reply_comment_id') ?? null])));
        const kindName = kind.toLowerCase();
        if (ids.size !== 1) throw new UnreadablePost(`a ${kindName} has ${ids.size ? 'links to more than one comment_id' : 'no link with its comment_id'} beside its text`);
        const [commentId, replyId] = JSON.parse([...ids][0]!) as [string, string | null];
        const isReply = kindName === 'reply';
        if (isReply && !replyId) throw new UnreadablePost('a reply has no link with its reply_comment_id');

        comments.push({
            id: replyId ?? commentId,
            replyTo: isReply ? commentId : null,
            kind: isReply ? 'reply' : 'comment',
            author,
            ago,
            at: agoToTime(ago, sentAt),
            text: outermost(own(a.querySelectorAll('div[dir="auto"]'))).map(textOf).filter(Boolean).join('\n'),
            media: mediaIn(own(a.querySelectorAll('a[href]'))),
        });
    }

    const outside = <T extends Element>(nodes: Iterable<T>) => [...nodes].filter(n => !articles.some(a => a.contains(n)));
    const lines = outermost(outside(document.querySelectorAll('div[dir="auto"]')))
        .flatMap(n => textOf(n).split('\n'))
        .map(l => l.trim())
        .filter(l => /[\p{L}\p{N}]/u.test(l));
    const [group, post] = addresses.size ? JSON.parse([...addresses][0]!) as [string, string] : [];
    // Even a post with no comments yet has its title.
    if (!lines.length) throw new UnreadablePost('found no text outside the comments');
    // A comment may be only a photo or a sticker, but a change to Facebook's markup changes
    // every comment at once, so a post whose comments all read as empty is one we can't read.
    if (comments.length && comments.every(c => !c.text)) throw new UnreadablePost('found no text in any comment');

    const buttons = [...document.querySelectorAll('[role="button"]')].map(b => (b.textContent ?? '').trim());
    return {
        lines,
        media: mediaIn(outside(document.querySelectorAll('a[href]'))),
        comments,
        collapsed: buttons.filter(t => EXPANDERS.test(t)).length,
        sort: buttons.find(t => SORTS.test(t)) ?? null,
        address: group && post ? {group, post} : null,
    };
}

/**
 * A label's shape for an error, which becomes a public issue. Nothing between its start
 * and its time is kept, since that is where the names are, and no list of the words labels
 * use can tell a name from them ("An Day"): only whether it starts as a comment's or a
 * reply's does, how many words it has, and the time it ends with, if any.
 */
const shapeOf = (label: string) => {
    const start = /^(comment|reply) by\b/i.exec(label)?.[0];
    const time = /(?:^|\s)(\d+\s?[a-z]{0,7}(?:\s+ago)?|just now|yesterday)$/i.exec(label)?.[1];
    const words = label.split(/\s+/).filter(Boolean).length;
    return `${start ? `"${start} …"` : 'not "Comment by" or "Reply by"'}, ${words} words, ${time ? `ending "${time}"` : 'with no time at its end'}`;
};

/**
 * The group and post that most of the comment permalinks in some HTML name, read from the
 * text without parsing it: for a post the reader couldn't read, whose group must still be
 * known before it is kept.
 */
export function permalinkAddress(html: string): PostAddress | null {
    const counts = new Map<string, number>();
    for (const m of html.matchAll(/href="(https:\/\/(?:www\.|web\.|m\.)?facebook\.com\/groups\/[\w.]+\/(?:posts|permalink)\/\d+\/?)\?[^"]*comment_id=/g)) {
        const address = postAddress(m[1]!);
        if (address) counts.set(JSON.stringify([address.group, address.post]), (counts.get(JSON.stringify([address.group, address.post])) ?? 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    const [group, post] = JSON.parse(best[0]) as [string, string];
    return {group, post};
}

function urlOf(a: Element): URL | null {
    try {
        return new URL(a.getAttribute('href') ?? '', 'https://www.facebook.com');
    } catch {
        return null; // a malformed link elsewhere on the page must not lose the send
    }
}

/**
 * Links to the photos and videos among some links, on Facebook, without its tracking
 * parameters. SalishSea.io keeps no copy: the group's media permissions are Orca Network's
 * (decision 117).
 */
function mediaIn(links: Element[]): string[] {
    const out = new Set<string>();
    for (const a of links) {
        const u = urlOf(a);
        if (!u || !/(^|\.)facebook\.com$/.test(u.hostname)) continue;
        const fbid = u.searchParams.get('fbid');
        const v = u.searchParams.get('v');
        if (/^\/photo(\.php)?\/?$/.test(u.pathname) && fbid) out.add(`https://www.facebook.com/photo/?fbid=${fbid}`);
        else if (/\/(videos|reel)\/\d+/.test(u.pathname)) out.add(`https://www.facebook.com${u.pathname.replace(/\/$/, '')}`);
        else if (u.pathname === '/watch/' && v) out.add(`https://www.facebook.com/watch/?v=${v}`);
    }
    return [...out];
}

// The nodes not inside another of them. They come in document order, as querySelectorAll
// gives them, so a node's ancestor among them is the last one kept before it, if any:
// linear, where comparing every pair was quadratic in a post's thousands of blocks.
const outermost = <T extends Element>(nodes: T[]) => {
    const kept: T[] = [];
    for (const n of nodes) if (!kept.at(-1)?.contains(n)) kept.push(n);
    return kept;
};

// A block's text in document order, with a line break at each block inside it and at each
// <br>: each line of a post is a block inside the outer one, but text can sit between them.
// It stops at a comment inside the block, whose text is that comment's own.
const BLOCKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
function textOf(n: Node): string {
    let out = '';
    const walk = (node: Node) => {
        for (const c of node.childNodes) {
            if (c.nodeType === 3) out += c.textContent;
            else if (c.nodeType === 1) {
                const tag = (c as Element).tagName;
                if (tag === 'BR') { out += '\n'; continue; }
                if ((c as Element).getAttribute('role') === 'article') continue;
                const block = BLOCKS.has(tag);
                if (block) out += '\n';
                walk(c);
                if (block) out += '\n';
            }
        }
    };
    walk(n);
    return out.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const UNITS = {second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000};

/** Facebook's "2 hours ago", counted back from `sentAt`, in epoch seconds. */
export function agoToTime(ago: string, sentAt: number): number {
    if (/just now/i.test(ago)) return sentAt;
    if (/yesterday/i.test(ago)) return sentAt - UNITS.day;
    const m = /(an?|\d+) (second|minute|hour|day|week|month|year)/i.exec(ago);
    if (!m) throw new UnreadablePost(`a relative time this reader doesn't know: ${JSON.stringify(ago)}`);
    const n = /^an?$/i.test(m[1]!) ? 1 : Number(m[1]);
    return sentAt - n * UNITS[m[2]!.toLowerCase() as keyof typeof UNITS];
}

/** The post's id from its address: /groups/<group>/posts/<id> or /permalink/<id>. */
export function postId(url: string): string | null {
    return postAddress(url)?.post ?? null;
}

/**
 * The group and post an address on Facebook names, /groups/<group>/posts/<id> or
 * /groups/<group>/permalink/<id>, on www., web. or m.facebook.com; null for any other.
 */
export function postAddress(url: string): PostAddress | null {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:' || !/^(www\.|web\.|m\.)?facebook\.com$/.test(u.hostname)) return null;
    const m = /^\/groups\/([\w.]+)\/(?:posts|permalink)\/(\d+)\/?$/.exec(u.pathname);
    return m ? {group: m[1]!, post: m[2]!} : null;
}
