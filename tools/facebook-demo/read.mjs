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
  for (const a of articles) {
    const m = LABEL.exec(a.getAttribute('aria-label'));
    const nested = articles.filter((x) => x !== a && a.contains(x));
    const inNested = (n) => nested.some((x) => x.contains(n));
    let commentId = null, replyId = null;
    for (const link of a.querySelectorAll('a[href*="comment_id="]')) {
      if (inNested(link)) continue;
      const u = new URL(link.getAttribute('href'), 'https://www.facebook.com');
      commentId ??= u.searchParams.get('comment_id');
      replyId ??= u.searchParams.get('reply_comment_id');
    }
    if (!commentId) continue;
    const blocks = [...a.querySelectorAll('div[dir="auto"]')].filter((n) => !inNested(n));
    const text = outermost(blocks).map(textOf).filter(Boolean).join('\n');
    comments.push({
      id: replyId ?? commentId,
      replyTo: replyId ? commentId : null,
      kind: m[1].toLowerCase() === 'reply' ? 'reply' : 'comment',
      author: m[2],
      ago: m[4],
      text,
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
    comments,
    collapsed: buttons.filter((t) => EXPANDERS.test(t)).length,
    sort: buttons.find((t) => /^(most relevant|all comments|newest)$/i.test(t)) ?? null,
  };
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
  const m = colon ?? lead;
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
