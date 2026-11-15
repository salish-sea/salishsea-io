// What each row of a post is, before anything is read from it as a sighting. Most rows are
// not reports: a day post's own text holds its title, thanks, staff edits and, under each
// report, a line crediting its reporter; comments hold questions, the staff's time stamps
// for a comment that gave none, hydrophone and webcam detections, "nothing seen" and talk.
// Reading a question's "north or south?" as a heading, or a credit line as a place, made
// most of the demo's mistakes (Fable's review of 2026-11-15). The rules are plain, so a
// person can see why a row got its kind.

import { parseTitle } from './title.mjs';

export const REPORT_KINDS = new Set(['report']);

const TIME_THEN_DASH = /^\W*(?:\d{1,2}[:.]\d{2}|\d{3,4})\s*(?:[ap]\.?m\.?)?\s*[-–—]/i;
const STAFF = /^orca network$/i;
// Words that say something was seen, so a row using them is a report even when the reader
// finds no place or time in it ("Just saw his blow directly out from stamm").
const SEEN = /\b(see|seen|saw|seeing|visible|fins?|blows?|breach\w*|spotted|surfac\w*|spyhop\w*|tail ?slap\w*|fluke\w*|dorsals?|viewing|watching)\b/i;
const HYDROPHONE = /\b(calls?|calling|hydro(phone)?s?|audible|vocals?|vocalizing|clicks|echolocation|heard)\b/i;
const WEBCAM = /\b(live ?stream|webcam|web cam|cam)\b/i;

/** The name a reply starts with: the person it answers, as Facebook writes it. */
export function stripMention(text, names) {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of sorted) if (text.startsWith(n) && /^[\s,:–—-]/.test(text.slice(n.length))) return text.slice(n.length).replace(/^[\s,:–—-]+/, '');
  return text;
}

/** A staff reply giving a comment the time it lacked: "thanks! time, 9:22", "time 1:15pm". */
export function staffTime(row) {
  if (row.kind !== 'reply' || !STAFF.test(row.author ?? '')) return null;
  const m = /\btime[,:]?\s*(\d{1,2}[:.]\d{2}\s*(?:[ap]\.?m\.?)?)/i.exec(row.text);
  return m ? m[1] : null;
}

/**
 * For one post's rows: the post's title (null when it is not a day post) and each row's
 * kind, by key. `reading(row)` gives the stored reading, `places(row)` the stored places.
 */
export function classifyPost(rows, standing = new Set()) {
  // The post as it stands: a line edited away (a title staff have since changed) is not its text.
  const lines = rows.filter((r) => r.kind === 'line' && !r.gone).sort((a, b) => a.seq - b.seq);
  const first = lines[0];
  const title = first ? parseTitle(first.text, first.first_seen) : null;
  const kinds = new Map();
  const reading = (r) => JSON.parse(r.reading ?? '{}');
  const says = (r) => {
    const x = reading(r);
    return !!(r.clock || x.direction || x.behaviour?.length || x.claims?.length || x.pods?.length || JSON.parse(r.places ?? '[]').length);
  };

  let afterReport = false;
  for (const r of lines) {
    let k;
    if (standing.has(r.text)) k = 'standing';
    else if (!title) k = 'other post';
    else if (r === first) k = 'title';
    else if (/^\W*(big |huge |many )?(thanks|thank you|appreciations|shout ?out)/i.test(r.text)) k = 'thanks';
    else if (/^\W*edit\b/i.test(r.text)) k = 'staff edit';
    else if (TIME_THEN_DASH.test(r.text)) k = 'report';
    else if (WEBCAM.test(r.text)) k = 'webcam';
    else if (HYDROPHONE.test(r.text) && !SEEN.test(r.text)) k = 'hydrophone';
    else if (afterReport && r.text.split(/\s+/).length <= 6 && !/\d/.test(r.text) && !says(r) && !SEEN.test(r.text)) k = 'credit';
    else k = says(r) || SEEN.test(r.text) ? 'report' : 'note';
    afterReport = k === 'report' || (afterReport && k === 'credit');
    kinds.set(r.key, k);
  }
  for (const r of rows.filter((r) => r.kind === 'line' && r.gone)) kinds.set(r.key, 'edited away');

  const byId = new Map(rows.filter((r) => r.comment_id).map((r) => [r.comment_id, r]));
  const names = rows.map((r) => r.author).filter(Boolean);
  for (const r of rows.filter((r) => r.kind !== 'line')) {
    const t = stripMention(r.text, names);
    const parent = r.reply_to ? byId.get(r.reply_to) : null;
    let k;
    if (standing.has(r.text)) k = 'standing';
    else if (!title) k = 'other post';
    else if (staffTime(r)) k = 'staff time';
    // A question, even one that gives a time ("Were they off Camano at 11:30?"); but a report
    // that starts with its time and ends by asking something ("1150 northbound, any IDs?") is a report.
    else if (/\?/.test(t) && !/^\W*\d{1,2}[:.]?\d{2}\b/.test(t)) k = 'question';
    else if (/\b(no sign|nothing seen|nothing yet|haven'?t seen|have not seen|not seeing|no visuals?|no luck|lost (sight|them))\b/i.test(t)) k = 'nothing seen';
    else if (WEBCAM.test(t)) k = 'webcam';
    else if (HYDROPHONE.test(t) && !SEEN.test(t)) k = 'hydrophone';
    else if (/^\W*(thanks|thank you|ty|thx)\b/i.test(t) && t.split(/\s+/).length <= 8 && !says(r)) k = 'thanks';
    else if (says(r) || SEEN.test(t)) k = 'report';
    else if (parent && parent.author === r.author) k = 'continuation';
    else k = 'talk';
    kinds.set(r.key, k);
  }
  return { title, kinds };
}
