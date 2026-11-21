// Reads a Facebook group's post, as the bookmarklet sends it, into the post's own lines and
// its comments (decision 117). It relies on what Facebook's markup gave on 2026-11-12:
// each comment is an element with role="article" and an aria-label such as "Comment by
// <name> 2 hours ago" or "Reply by <name> to <name>'s comment 1 hour ago"; its links carry
// comment_id, and a reply's also reply_comment_id; the post's text is the dir="auto"
// blocks outside every comment. Replies are not nested inside the comment they answer.
import { parseHTML } from 'linkedom';

// What hides part of a post: collapsed comments and replies, and a long comment cut short.
// The bookmarklet clicks the same buttons (server.mjs); keep the two in step.
export const EXPANDERS = /^(view ((more|all|previous) (\d+ )?|\d+ (more )?)(comments?|repl(y|ies))|\d+ (more )?repl(y|ies)|see more$)/i;
const LABEL = /^(Comment|Reply) by (.+?)(?: to (.+?)'s (?:comment|reply))? ((?:about )?(?:an?|\d+) (?:second|minute|hour|day|week|month|year)s? ago|just now|yesterday)$/i;

/** @param {string} html the post's element, as the bookmarklet sent it */
export function readPost(html) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  // Only comments are labelled so; the post itself may be an article too, holding them.
  const articles = [...document.querySelectorAll('[role="article"]')].filter((a) => LABEL.test(a.getAttribute('aria-label') ?? ''));

  const comments = [];
  const posts = new Set(); // the posts the comments' own permalinks name
  for (const a of articles) {
    const m = LABEL.exec(a.getAttribute('aria-label'));
    const nested = articles.filter((x) => x !== a && a.contains(x));
    const inNested = (n) => nested.some((x) => x.contains(n));
    let commentId = null, replyId = null;
    for (const link of a.querySelectorAll('a[href*="comment_id="]')) {
      if (inNested(link)) continue;
      let u;
      try {
        u = new URL(link.getAttribute('href'), 'https://www.facebook.com');
      } catch {
        continue;
      }
      commentId ??= u.searchParams.get('comment_id');
      replyId ??= u.searchParams.get('reply_comment_id');
      // its permalink, beside its name, not a link to another comment pasted into its text
      const block = link.closest('div[dir="auto"]');
      if (u.searchParams.get('comment_id') && !(block && a.contains(block)) && postId(u.pathname)) posts.add(postId(u.pathname));
    }
    if (!commentId) continue;
    const media = mediaIn([...a.querySelectorAll('a[href]')].filter((n) => !inNested(n)));
    const blocks = [...a.querySelectorAll('div[dir="auto"]')].filter((n) => !inNested(n));
    const text = outermost(blocks).map(textOf).filter(Boolean).join('\n');
    comments.push({
      id: replyId ?? commentId,
      replyTo: replyId ? commentId : null,
      kind: m[1].toLowerCase() === 'reply' ? 'reply' : 'comment',
      author: m[2],
      ago: m[4],
      text,
      media,
    });
  }

  const loose = [...document.querySelectorAll('div[dir="auto"]')].filter((n) => !articles.some((a) => a.contains(n)));
  const lines = outermost(loose)
    .flatMap((n) => textOf(n).split('\n'))
    .map((l) => l.trim())
    .filter((l) => /[\p{L}\p{N}]/u.test(l));

  const buttons = [...document.querySelectorAll('[role="button"]')].map((b) => b.textContent.trim());
  return {
    lines,
    media: mediaIn([...document.querySelectorAll('a[href]')].filter((n) => !articles.some((a) => a.contains(n)))),
    comments,
    posts: [...posts],
    collapsed: buttons.filter((t) => EXPANDERS.test(t)).length,
    sort: buttons.find((t) => /^(most relevant|all comments|newest)$/i.test(t)) ?? null,
  };
}

/**
 * Links to the photos and videos among some links, on Facebook, without its tracking
 * parameters. SalishSea.io keeps no copy: the group's media permissions are Orca Network's.
 */
function mediaIn(links) {
  const out = new Set();
  for (const a of links) {
    let u;
    try {
      u = new URL(a.getAttribute('href'), 'https://www.facebook.com');
    } catch {
      continue; // a malformed link elsewhere on the page must not lose the send
    }
    if (!/(^|\.)facebook\.com$/.test(u.hostname)) continue;
    const fbid = u.searchParams.get('fbid');
    if (/^\/photo(\.php)?\/?$/.test(u.pathname) && fbid) out.add(`https://www.facebook.com/photo/?fbid=${fbid}`);
    else if (/\/(videos|reel)\/\d+/.test(u.pathname)) out.add(`https://www.facebook.com${u.pathname.replace(/\/$/, '')}`);
    else if (u.pathname === '/watch/' && u.searchParams.get('v')) out.add(`https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`);
  }
  return [...out];
}

const outermost = (nodes) => nodes.filter((n) => !nodes.some((o) => o !== n && o.contains(n)));

// A block's text in document order, with a line break at each block inside it and at each
// <br>: each line of a post is a block inside the outer one, but text can sit between them.
const BLOCKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
function textOf(n) {
  let out = '';
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) out += c.textContent;
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') { out += '\n'; continue; }
        const block = BLOCKS.has(c.tagName);
        if (block) out += '\n';
        walk(c);
        if (block) out += '\n';
      }
    }
  };
  walk(n);
  return out.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const UNITS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };

/** Facebook's "2 hours ago", from the time the post was sent, as epoch seconds; null when it says nothing usable. */
export function agoToTime(ago, sentAt) {
  if (/just now/i.test(ago)) return sentAt;
  if (/yesterday/i.test(ago)) return sentAt - 86400;
  const m = /(an?|\d+) (second|minute|hour|day|week|month|year)/i.exec(ago);
  if (!m) return null;
  const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
  return sentAt - n * UNITS[m[2].toLowerCase()];
}

/**
 * The clock time a text gives for its sighting: "11:35", "12:55 pm", or four digits at its
 * start ("1145Exiting Port Susan"). Four digits elsewhere are too often other numbers.
 */
export function clockTime(text) {
  const colon = /(?<![\d:])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d:])\s*([ap]\.?m\.?)?/i.exec(text);
  const lead = /^\W*([01]\d|2[0-3])([0-5]\d)(?!\d)\s*([ap]\.?m\.?)?/i.exec(text);
  // "11am", "2 pm"; and four or three digits ending the text ("Viewing from constellation 1055").
  const ampm = /(?<![\w:.])(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?(?![a-z])/i.exec(text);
  const trail = /(?<![\w:.])([01]?\d|2[0-3])([0-5]\d)\W*$/.exec(text);
  const m = colon ?? lead ?? (ampm ? [ampm[0], ampm[1], ampm[2] ?? '00', `${ampm[3]}m`] : null) ?? trail;
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3] && /^p/i.test(m[3]) && h < 12) h += 12;
  if (m[3] && /^a/i.test(m[3]) && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** The post's id from its address: /groups/<group>/posts/<id> or /permalink/<id>. */
export function postId(url) {
  const m = /\/(?:posts|permalink)\/(\d+)/.exec(url ?? '');
  return m ? m[1] : null;
}

/**
 * The post a sent page shows, or null, or 'several'. Its address names it on the post's own
 * page (/posts/<id>), or as the post pinned to the top of the group's feed
 * (?multi_permalinks=<id>); the comments' own permalinks (readPost's `posts`) name it
 * too, and must agree. With no
 * post dialog open, the bookmarklet sends the whole feed, which may hold other posts and
 * their comments: that is 'several', for the sender to open the post on its own.
 */
export function sentPostId(url, posts) {
  let fromUrl = postId(url);
  if (!fromUrl) {
    try {
      const pinned = new URL(url).searchParams.get('multi_permalinks') ?? '';
      if (/^\d+$/.test(pinned)) fromUrl = pinned;
    } catch {}
  }
  const fromComments = new Set(posts);
  if (fromComments.size > 1 || (fromUrl && fromComments.size && !fromComments.has(fromUrl))) return 'several';
  return fromUrl ?? [...fromComments][0] ?? null;
}
