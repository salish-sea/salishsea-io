// What a report's replies add to it (bd salish-i1a.3.12). A reply is often the report's
// missing half: the observer adds to their own comment ("Viewing from stamm", "Js so far"),
// or answers a question with "yes", which confirms what the question proposed ("are they
// headed south?" "yes"). The staff's "time, 9:22" replies are read by classify.mjs's
// staffTime. Only the observer's own replies count: someone else's "east of yellow buoy"
// may be a different sighting.

import { mentionOf } from './classify.mjs';
import { ownNames } from './context.mjs';

const YES = /^\W*(yes|yep|yeah|yup|correct|confirmed)\b/i;
// A question that offers a choice ("north or south?") proposes nothing a "yes" confirms.
const CHOICE = /\bor\b/i;
// The kinds of the author's replies that can add to their report (classify.mjs): a
// continuation is what says nothing on its own, such as "Orca Network yes."
const ADDS = new Set(['report', 'continuation']);

const readingOf = (r) => JSON.parse(r.reading ?? '{}');
const placesOf = (r) => JSON.parse(r.places ?? '[]');

/**
 * For one post's rows, what each report comment gains from its thread, by the comment's key:
 * { clock, direction, places, animals, from } where `from` lists the keys of the replies
 * that gave something. A field is given only when the comment doesn't say it itself; places
 * are the ones the comment doesn't name. `kinds` is classifyPost's; `reports` the keys of
 * the rows that are reports.
 */
export function threadFor(rows, kinds, reports) {
  const live = rows.filter((r) => !r.gone);
  const names = rows.map((r) => r.author).filter(Boolean);
  const replies = Map.groupBy(live.filter((r) => r.kind === 'reply'), (r) => r.reply_to);
  const out = new Map();
  for (const c of live.filter((r) => r.kind === 'comment' && reports.has(r.key))) {
    const thread = (replies.get(c.comment_id) ?? []).sort((a, b) => a.first_seen - b.first_seen || a.seq - b.seq);
    const own = readingOf(c);
    const got = { clock: null, direction: null, places: [], animals: [], from: [] };
    const seen = new Set(placesOf(c).map((p) => p.name));
    // The comment's own animals already show; only a comment that names none gains them.
    const namesOwn = ownNames(c).length > 0;
    const take = (src, via) => {
      let gave = false;
      const x = readingOf(src);
      if (!c.clock && !got.clock && src.clock && src !== c) { got.clock = src.clock; gave = true; }
      if (!own.direction && !got.direction && x.direction) { got.direction = x.direction; gave = true; }
      for (const p of placesOf(src)) if (!seen.has(p.name)) { seen.add(p.name); got.places.push(p); gave = true; }
      if (!namesOwn) for (const n of ownNames(src)) if (!got.animals.includes(n.label)) { got.animals.push(n.label); gave = true; }
      if (gave && !got.from.includes(via.key)) got.from.push(via.key);
    };
    thread.forEach((r, i) => {
      if (r.author !== c.author) return;
      // Only what reports: "12:20 no sign of them" gives no time to the sighting.
      if (!ADDS.has(kinds.get(r.key))) return;
      // The reply's own words first; a question it confirms fills only what they leave out.
      take(r, r);
      const { name, rest } = mentionOf(r.text, names);
      if (YES.test(rest)) {
        // The question it answers: the latest before it by the person it names, or else the latest by anyone.
        const asked = thread.slice(0, i).reverse().filter((q) => q.author !== c.author && kinds.get(q.key) === 'question');
        const q = asked.find((q) => q.author === name) ?? asked[0];
        if (q && !CHOICE.test(mentionOf(q.text, names).rest)) take(q, r);
      }
    });
    if (got.clock || got.direction || got.places.length || got.animals.length) out.set(c.key, got);
  }
  return out;
}
