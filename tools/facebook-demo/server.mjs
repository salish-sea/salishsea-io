// A demo of decision 117 for Scott and Orca Network's staff (bd salish-i1a.3.10): people
// send a Facebook group's day post with a bookmarklet, and this keeps its lines and
// comments with what the reader of sighting text makes of them. It writes nothing to
// production. Run behind Apache on Maderas; see README.md.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { readSighting } from '../../src/sighting-text.ts';
import { readPost, agoToTime, clockTime, postId, EXPANDERS } from './read.mjs';
import { bookmarkletFor } from './bookmarklet.mjs';
import { openStore, recordSend, rereadAll } from './store.mjs';
import { loadPlaces } from './places.mjs';
import { contextFor } from './context.mjs';
import { classifyPost, stripMention, staffTime, REPORT_KINDS } from './classify.mjs';
import { threadFor } from './thread.mjs';

const DATA = process.env.FB_DEMO_DATA ?? new URL('./data/', import.meta.url).pathname;
const config = JSON.parse(await readFile(join(DATA, 'config.json'), 'utf8'));
const { base, port = 3142, viewToken, senders } = config;
const RAW = join(DATA, 'raw');
await mkdir(RAW, { recursive: true });
const db = openStore(join(DATA, 'demo.sqlite'));
const findPlaces = await loadPlaces();

const MAX_BYTES = 4 * 1024 * 1024; // a busy post was 0.4 MB
const RAW_DAYS = 7;
const SENDS_PER_10_MIN = 30;

// Which wording, and which reading of it, a mark judged: a mark sent for an older version
// than the row now has is refused, whether the text changed, the reader did, or the animals
// the row takes from its post, or what its author adds in replies. (What the replies add is
// appended only when there is some, so marks made before replies were read keep their version.)
const version = (r, info = {}) => {
  const parts = [r.text, r.clock, r.reading, r.places, info.ctx ?? null, info.kind ?? null, info.staffTime ?? null, info.title?.kind ?? null, info.title?.date ?? null];
  if (info.thread) parts.push(info.thread);
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
};
// How the page and the CSV write the reader's whale identifiers: "T65A?" possible, "(absent)" said not to be there.
const claimLabel = (c) => c.code + (c.presence === 'absent' ? ' (absent)' : c.certainty !== 'certain' ? '?' : '');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const senderFor = (token) => Object.entries(senders).find(([t]) => same(token, t))?.[1] ?? null;
// What the reader makes of a text, skipping a reply's leading name (the person it answers),
// which is not part of the report: "Dana Smith thanks" must not find Dana Passage.
const enrich = (text, names = []) => {
  const t = stripMention(text, names);
  return { clock: clockTime(t), reading: readSighting(t), places: findPlaces(t) };
};

console.log('rows read again with the current reader:', rereadAll(db, enrich));

// A mark counts only for the version of its row it judged: what the row's text says, how it
// was read, and what it takes from its post. When any of these change (a new send edits the
// post's IDs, a better reader reads it again) the mark stops showing and must be made again.
const markOf = (r, info) => (r.mark && r.marked_version === version(r, info) ? r : { mark: null, note: null, marked_by: null });

// --- the bookmarklet ---------------------------------------------------------------

const sendSource = (token) => bookmarkletFor(`${base}/receive#s=${token}`);

// --- pages ---------------------------------------------------------------------------

const page = (title, body) => `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
:root{--ink:#1a1a1a;--muted:#5f6b76;--line:#d9dee3;--bg:#fff;--soft:#f3f6f9;--good:#1f7a3a;--bad:#b3261e;--accent:#1d3c78}
@media (prefers-color-scheme:dark){:root{--ink:#e8eaed;--muted:#9aa4ae;--line:#3a4148;--bg:#16191c;--soft:#1f2428;--good:#6fcf8f;--bad:#f28b82;--accent:#9cc0ff}}
body{font:15px/1.45 system-ui,sans-serif;color:var(--ink);background:var(--bg);margin:0 auto;padding:1rem 16px 3rem;max-width:84rem}
a{color:var(--accent)}h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-top:1px solid var(--line);padding:.4rem .45rem;vertical-align:top;text-align:left}
th{font-weight:600;white-space:nowrap}td.text{white-space:pre-wrap;min-width:16rem}tr.new td{background:var(--soft)}tr.gone td.text{text-decoration:line-through;color:var(--muted)}
.chip{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:0 .3rem;margin:0 .2rem .2rem 0;font-size:13px;white-space:nowrap}
.none{color:var(--muted)}.chip.ctx{border-style:dashed;color:var(--muted)}.unknown{color:var(--bad)}.warn{border-left:4px solid var(--bad);padding:.4rem .8rem;background:var(--soft)}
.stats{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;padding:0;list-style:none}.stats b{font-size:1.2rem;display:block}
a.bm{display:inline-block;padding:.5rem .9rem;border:2px solid var(--accent);border-radius:8px;text-decoration:none;font-weight:600}
select,input{font:inherit;font-size:13px}td.mark{min-width:9rem}
.scroll{overflow-x:auto}tr.aside td{color:var(--muted)}tr.aside td.text{color:var(--ink)}.kind{font-size:12px;font-style:italic}details summary{cursor:pointer}tr.standing td{font-size:13px}
</style><body>${body}</body></html>`;

function chips(list, cls = '') {
  return list.length ? list.map((x) => `<span class="chip ${cls}">${x}</span>`).join('') : '<span class="none">—</span>';
}

const mediaLinks = (json) => {
  const media = JSON.parse(json ?? '[]');
  return media.map((m, i) => `<a href="${esc(m)}" rel="noreferrer">${/photo/.test(m) ? 'photo' : 'video'}${media.length > 1 ? ` ${i + 1}` : ''}</a>`).join(' ');
};

// A comment on Facebook, for checking a row in place.
function commentHref(postUrl, r) {
  if (!postUrl || !r.comment_id) return null;
  const u = new URL(postUrl);
  u.search = '';
  u.searchParams.set('comment_id', r.reply_to ?? r.comment_id);
  if (r.reply_to) u.searchParams.set('reply_comment_id', r.comment_id);
  return u.href;
}

function rowHtml(r, { marks = false, newKeys = new Set(), postUrl = null, info = {} } = {}) {
  if (info.kind === 'standing') {
    return `<tr class="standing"><td>${r.kind === 'line' ? 'post' : 'comment'}<div class="muted">${esc(r.author ?? '')}</div></td><td></td>
<td colspan="${marks ? 6 : 5}" class="muted"><details><summary>Standing text, in every post: ${esc(r.text.split('\n')[0].slice(0, 80))}…</summary><div class="text">${esc(r.text)}</div></details></td></tr>`;
  }
  const reading = JSON.parse(r.reading ?? '{}');
  const places = JSON.parse(r.places ?? '[]');
  const codes = (reading.claims ?? []).map((c) => esc(claimLabel(c)));
  const pods = (reading.pods ?? []).map((p) => esc(p + ' pod'));
  const placeChip = (p) => (p.unknown
    ? `<span class="unknown" title="Not in the site's gazetteers, so it can't be put on the map">${esc(p.name)}?</span>`
    : `<a href="https://salishsea.io${esc(p.href)}" title="${esc(p.kind)} ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}${p.alike > 1 ? ` (one of ${p.alike} with this name)` : ''}">${esc(p.name)}${p.abbreviation ? ` (${esc(p.abbreviation)})` : ''}${p.written ? ` (“${esc(p.written)}”)` : ''}${p.alike > 1 ? ` ×${p.alike}` : ''}</a>`);
  const placeChips = places.map(placeChip);
  const where = r.kind === 'line' ? 'post' : r.kind === 'reply' ? `↳ reply` : 'comment';
  const time = new Date(r.first_seen * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false });
  const { ctx, kind, report, staffTime: st, title, thread } = info;
  const fromReply = '<div class="muted">from their reply</div>';
  const whales = codes.length || pods.length ? chips([...codes, ...pods])
    : ctx ? `${chips(ctx.labels.map(esc), 'ctx')}<div class="muted">${ctx.from === 'reply' ? 'from their reply' : `from the ${ctx.from === 'post' ? 'post' : 'comment it answers'}`}</div>`
    : title?.kind ? `${chips([esc(title.kind)], 'ctx')}<div class="muted">from the post's title</div>` : chips([]);
  const clock = r.clock ? esc(r.clock) : st ? `${esc(st)}<div class="muted">from Orca Network's reply</div>` : thread?.clock ? `${chips([esc(thread.clock)], 'ctx')}${fromReply}` : '';
  const direction = reading.direction ? esc(reading.direction) : thread?.direction ? `${chips([esc(thread.direction)], 'ctx')}${fromReply}` : '<span class="none">—</span>';
  const placeCell = thread?.places.length ? `${placeChips.length ? chips(placeChips) : ''}${chips(thread.places.map(placeChip), 'ctx')}${fromReply}` : chips(placeChips);
  const m = markOf(r, info);
  const stale = r.mark && !m.mark;
  const markCell = marks ? `<td class="mark"><select data-key="${esc(r.key)}" data-v="${version(r, info)}" aria-label="Did the reader get it right?">
${['', 'right', 'partly', 'wrong', 'not a sighting'].map((o) => `<option value="${o}"${(m.mark ?? '') === o ? ' selected' : ''}>${o || '—'}</option>`).join('')}</select>
<input data-note="${esc(r.key)}" value="${esc(m.note)}" placeholder="note" size="10">${m.marked_by ? `<div class="muted">${esc(m.marked_by)}</div>` : ''}${stale ? `<div class="muted" title="It was “${esc(r.mark)}” from ${esc(r.marked_by ?? 'someone')}">changed since it was marked</div>` : ''}</td>` : '';
  const href = commentHref(postUrl, r);
  const media = mediaLinks(r.media);
  const from = `<td>${href ? `<a href="${esc(href)}" rel="noreferrer">${where}</a>` : where}<div class="muted">${esc(r.author ?? '')}</div>${media ? `<div>${media}</div>` : ''}${report ? '' : `<div class="kind">${esc(kind ?? '')}</div>`}</td>`;
  // Only a report is read: for anything else the columns stay empty, and its kind says why.
  if (!report) {
    return `<tr class="aside${newKeys.has(r.key) ? ' new' : ''}${r.gone ? ' gone' : ''}">${from}<td><div class="muted" title="when this first arrived (Pacific)">seen ${time}</div></td>
<td class="text">${esc(r.text)}</td><td colspan="4" class="muted">not read: ${esc(kind ?? 'not a report')}</td>${markCell}</tr>`;
  }
  return `<tr class="${newKeys.has(r.key) ? 'new' : ''}${r.gone ? ' gone' : ''}">${from}
<td>${clock}<div class="muted" title="when this first arrived (Pacific)">seen ${time}</div></td>
<td class="text">${esc(r.text)}</td>
<td>${whales}</td><td>${direction}</td>
<td>${chips((reading.behaviour ?? []).map(esc))}</td><td>${placeCell}</td>${markCell}</tr>`;
}

// Orca Network's standing text (the laws, the viewpoints map) is in every day's post. Long
// text that has appeared in two posts or more is shown folded and left out of the figures;
// a short report can repeat word for word ("Still there") and must stay open to marking.
const STANDING_MIN_CHARS = 60;
const standingTexts = () => new Set(db.prepare(
  'SELECT text FROM items WHERE length(text) >= ? GROUP BY text HAVING count(DISTINCT post_id) >= 2').all(STANDING_MIN_CHARS).map((r) => r.text));

// Everything worked out about one post's rows when a page is drawn: each row's kind
// (classify.mjs), the post's title, the animals a report borrows (reports only), the time
// a staff reply gives the comment it answers, and what a report's author adds in replies (thread.mjs).
function analysePost(rows, standing) {
  const { title, kinds } = classifyPost(rows, standing);
  const reports = new Set(rows.filter((r) => REPORT_KINDS.has(kinds.get(r.key))).map((r) => r.key));
  const threads = threadFor(rows, kinds, reports);
  const context = contextFor(rows, standing, reports, threads);
  const staffTimes = new Map();
  for (const r of rows) { const t = staffTime(r); if (t && !staffTimes.has(r.reply_to)) staffTimes.set(r.reply_to, t); }
  return { title, kinds, reports, context, staffTimes, threads };
}
function analyseAll(rows, standing = standingTexts()) {
  const posts = new Map([...Map.groupBy(rows, (r) => r.post_id)].map(([id, rs]) => [id, analysePost(rs, standing)]));
  return {
    posts,
    infoOf: (r) => {
      const a = posts.get(r.post_id);
      const t = a.threads.get(r.key);
      // What the replies add besides animals, which the row's borrowed animals (ctx) carry.
      const thread = t && (t.clock || t.direction || t.places.length) ? { clock: t.clock, direction: t.direction, places: t.places, from: t.from } : null;
      return { kind: a.kinds.get(r.key), report: a.reports.has(r.key), ctx: a.context.get(r.key), staffTime: r.comment_id ? a.staffTimes.get(r.comment_id) : null, title: a.title, thread };
    },
  };
}

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
// A post's heading: its title's date, animals and region; or the page title, or its first line.
function postHeading(post, a, rows) {
  if (a?.title) {
    const t = a.title;
    return [DAY.format(new Date(`${t.date}T12:00:00Z`)), t.kind ?? 'animals', t.group ? `group ${t.group.toLowerCase()}` : null, t.region].filter(Boolean).join(' · ');
  }
  return `Not a day post: ${heading(post.title, rows)}`;
}

// A post's heading: the page title without the group's name, or the post's first line.
function heading(title, rows) {
  const t = (title ?? '').replace(/^\(\d+\) /, '').replace(/ \| Facebook$/, '').replace(/^.*? \| /, '').trim();
  return t && t !== 'Facebook' ? t : (rows.find((r) => r.kind === 'line')?.text ?? 'A post');
}

// The post's lines first, then its comments in the order they arrived, each reply under the
// comment it answers.
function ordered(rows) {
  const lines = rows.filter((r) => r.kind === 'line');
  const replies = Map.groupBy(rows.filter((r) => r.kind === 'reply'), (r) => r.reply_to);
  const tops = rows.filter((r) => r.kind === 'comment');
  const ids = new Set(tops.map((r) => r.comment_id));
  const orphans = rows.filter((r) => r.kind === 'reply' && !ids.has(r.reply_to));
  return [...lines, ...tops.flatMap((c) => [c, ...(replies.get(c.comment_id) ?? [])]), ...orphans];
}

const HEAD = `<tr><th>From</th><th>Time</th><th>Text</th><th>Whales</th><th>Heading</th><th>Behaviour</th><th>Places named</th>`;

function warnings(send) {
  const out = [];
  if (send.sort && !/^all comments$/i.test(send.sort)) out.push(`Facebook was showing “${esc(send.sort)}”, which hides some comments. Choose “All comments” and send again.`);
  if (send.collapsed) out.push(`${send.collapsed} comments or replies were still collapsed. Click Send to SalishSea again to open them.`);
  if (!send.lines && !send.comments) out.push('Nothing was read from this page. Is it a day post? If it is, Facebook may have changed its page, so tell Peter.');
  return out;
}

function stats(rows, infoOf) {
  const reports = rows.filter((r) => infoOf(r).report);
  const n = reports.length || 1;
  const pct = (k) => `${Math.round((100 * k) / n)}%`;
  const has = (f) => reports.filter(f).length;
  const reading = (r) => JSON.parse(r.reading ?? '{}');
  const own = (r) => reading(r).claims?.length || reading(r).pods?.length;
  const marked = rows.map((r) => markOf(r, infoOf(r))).filter((m) => m.mark);
  const count = (m) => marked.filter((r) => r.mark === m).length;
  const kinds = Map.groupBy(rows.filter((r) => !infoOf(r).report), (r) => infoOf(r).kind);
  const other = [...kinds].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => `${rs.length} ${k}`).join(', ');
  return `<ul class="stats">
<li><b>${reports.length}</b>reports, of ${rows.length} lines and comments</li>
<li><b>${pct(has(own))}</b>name whales</li>
<li><b>${pct(has((r) => !own(r) && infoOf(r).ctx))}</b>mean whales named earlier</li>
<li><b>${pct(has((r) => !own(r) && !infoOf(r).ctx && infoOf(r).title?.kind))}</b>only the post's title says what</li>
<li><b>${pct(has((r) => reading(r).direction || infoOf(r).thread?.direction))}</b>give a heading</li>
<li><b>${pct(has((r) => r.clock || infoOf(r).staffTime || infoOf(r).thread?.clock))}</b>give a clock time</li>
<li><b>${pct(has((r) => [...JSON.parse(r.places ?? '[]'), ...(infoOf(r).thread?.places ?? [])].some((p) => !p.unknown)))}</b>name a place we know</li>
<li><b>${pct(has((r) => JSON.parse(r.places ?? '[]').some((p) => p.unknown)))}</b>name a place we don't</li>
<li><b>${has((r) => infoOf(r).thread || infoOf(r).ctx?.from === 'reply')}</b>gain something from their author's replies</li>
<li><b>${marked.length}</b>checked: ${count('right')} right, ${count('partly')} partly, ${count('wrong')} wrong, ${count('not a sighting')} not sightings</li></ul>
<p class="muted">Not read as reports: ${esc(other)}. The percentages are of reports, and count what a report's own replies and Orca Network's time replies add.</p>`;
}

function listPage(k) {
  const posts = db.prepare(`SELECT i.post_id, max(i.post_title) AS title, min(i.first_seen) AS first, p.url, p.media
    FROM items i LEFT JOIN posts p USING (post_id) GROUP BY i.post_id ORDER BY first DESC`).all();
  const rows = db.prepare('SELECT * FROM items ORDER BY first_seen, seq').all();
  const sends = db.prepare('SELECT * FROM sends ORDER BY at DESC LIMIT 30').all();
  const byPost = Map.groupBy(rows, (r) => r.post_id);
  const standing = standingTexts();
  const { posts: analyses, infoOf } = analyseAll(rows, standing);
  const sections = posts.map((p) => `<h2 id="p${esc(p.post_id)}">${esc(postHeading(p, analyses.get(p.post_id), byPost.get(p.post_id) ?? []))}</h2>
${p.url ? `<p class="muted"><a href="${esc(p.url)}" rel="noreferrer">The post on Facebook</a>${mediaLinks(p.media) ? ` · its ${mediaLinks(p.media)}` : ''}</p>` : ''}
<div class="scroll"><table>${HEAD}<th>Right?</th></tr>${ordered(byPost.get(p.post_id) ?? []).map((r) => rowHtml(r, { marks: true, postUrl: p.url, info: infoOf(r) })).join('')}</table></div>`);
  const sendRows = sends.map((s) => `<tr><td>${new Date(s.at * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</td><td>${esc(s.sender)}</td><td>${esc(analyses.has(s.post_id) ? postHeading(s, analyses.get(s.post_id), byPost.get(s.post_id)) : heading(s.title, []))}</td><td>${s.added} new, ${s.changed} changed, ${s.gone} gone</td><td>${warnings(s).length ? '<span title="' + esc(warnings(s).join(' ')) + '">incomplete</span>' : 'complete'}</td></tr>`).join('');
  return page('Facebook sightings demo', `<h1>Sightings read from Orca Network's Community Group</h1>
<p class="muted">A trial of SalishSea.io's <a href="https://github.com/salish-sea/salishsea-io/blob/main/docs/decisions/117-sightings-from-a-facebook-group-arrive-when-a-signed-in-person-sends-the-days-post.md">decision 117</a>. Each line of a day's post and each comment, as it arrived, with what SalishSea.io's reader of sighting text found in it. Nothing here is published. Please mark whether the reader got each one right. <a href="export.csv?k=${esc(k)}">Download all as CSV</a>.</p>
<p class="muted">Only reports are read. Each other line or comment says what it is instead (a question, thanks, a credit line, a hydrophone detection…), and if that's wrong, mark it. A dashed whale code is one the report doesn't name itself but means, taken from the post or from the comment it answers: Orca Network's staff add the identifications to the post as they learn them. Please mark whether that's right too.</p>
<p><label>Your name, for your marks: <input id="who" size="16"></label></p>
${stats(rows.filter((r) => infoOf(r).kind !== 'standing'), infoOf)}
${sections.join('') || '<p class="muted">Nothing has been sent yet.</p>'}
<h2>Recent sends</h2><div class="scroll"><table><tr><th>When</th><th>Sender</th><th>Post</th><th>Rows</th><th>Complete?</th></tr>${sendRows}</table></div>
<script>
const k=${JSON.stringify(k)};const who=document.getElementById('who');
try{who.value=localStorage.getItem('who')||''}catch{}
who.addEventListener('change',()=>{try{localStorage.setItem('who',who.value)}catch{}});
const save=(key)=>{const sel=document.querySelector('select[data-key="'+CSS.escape(key)+'"]');
fetch('mark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k,key,v:sel.dataset.v,mark:sel.value,note:document.querySelector('input[data-note="'+CSS.escape(key)+'"]').value,who:who.value})})
.then(r=>{if(r.status===409)alert('That text has changed since this page was loaded. Reload the page and mark it again.');else if(!r.ok)alert('Not saved: '+r.status)})
.catch(()=>alert('Not saved: the connection failed. Check it and change the mark again.'));};
document.addEventListener('change',(e)=>{const key=e.target.dataset.key||e.target.dataset.note;if(key)save(key);});
</script>`);
}

function installPage(token, label) {
  return page('Send Facebook posts to SalishSea.io', `<h1>Send Facebook posts to SalishSea.io</h1>
<p>Hello ${esc(label)}. This is a trial: what you send is kept for Peter, Scott and Orca Network to look at, and is not published.</p>
<ol><li>On a computer, in Chrome or Firefox, show the bookmarks bar (Ctrl+Shift+B, or ⌘⇧B on a Mac).</li>
<li>Drag this button onto it: <a class="bm" href="${esc(sendSource(token))}">Send to SalishSea</a></li>
<li>In Orca Network's Community Group, open the day's post.</li>
<li>Click <b>Send to SalishSea</b> in the bookmarks bar. A blue box on the post shows it choosing all comments and opening the hidden ones and their replies, which can take a minute on a busy day. Then click <b>Send them to SalishSea</b> in the box, and a window shows what was read.</li></ol>
<p class="muted">If you installed an earlier button, drag this one in its place: it opens hidden comments itself.</p>
<p class="muted">The button is yours alone; please don't share it. Send as often as you like: each send adds only what's new.</p>`);
}

// The window a loader opened, for the one day a bookmarklet was one (2026-11-16): Facebook
// cut it off from the tab, so it can only ask for the button to be installed again.
const sendPage = page('Install the button again', `<h1>Install the button again</h1><p>This Send to SalishSea button can't work with Facebook. Open your install page again and drag the new button in its place. Sorry for the trouble.</p>`);

// The window the bookmarklet opens, with the post in its address.
const receivePage = page('Sending to SalishSea…', `<h1>Sending to SalishSea…</h1><div id="out"><p id="s">Reading the post…</p></div>
<script>
(async()=>{
  const s=document.getElementById('s');
  const params=new URLSearchParams(location.hash.slice(1));
  history.replaceState(null,'',location.pathname);
  try{
    const data=params.get('d'),token=params.get('s');
    if(!data||!token)throw new Error('nothing arrived. Try the button again.');
    const bin=atob(data.replace(/-/g,'+').replace(/_/g,'/'));
    const bytes=Uint8Array.from(bin,(c)=>c.charCodeAt(0));
    const msg=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    s.textContent='Sending…';
    const fd=new FormData();fd.append('s',token);for(const[k,v]of Object.entries(msg))fd.append(k,v);
    const r=await fetch('capture',{method:'POST',body:fd});
    if(!r.ok)throw new Error(await r.text());
    document.getElementById('out').innerHTML=(await r.json()).html;
    document.title='Sent to SalishSea';
  }catch(err){s.textContent='Failed: '+err.message;}
})();
</script>`);

// --- requests --------------------------------------------------------------------------

const recent = new Map(); // sender -> times of their sends in the last ten minutes

async function capture(req) {
  const len = Number(req.headers['content-length'] ?? 0);
  if (len > MAX_BYTES) return [413, 'That page is too large.'];
  // Count the bytes as they arrive: a request need not declare its size.
  let seen = 0;
  const capped = req.pipe(new Transform({
    transform(chunk, _, done) {
      seen += chunk.length;
      done(seen > MAX_BYTES ? Object.assign(new Error('That page is too large.'), { status: 413 }) : null, chunk);
    },
  }));
  let form;
  try {
    form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: Readable.toWeb(capped), duplex: 'half' }).formData();
  } catch (e) {
    if (seen > MAX_BYTES) return [413, 'That page is too large.'];
    throw e;
  }
  const sender = senderFor(String(form.get('s') ?? ''));
  if (!sender) return [403, 'This button is not recognised. Ask Peter for a new one.'];
  const now = Math.floor(Date.now() / 1000);
  const times = (recent.get(sender) ?? []).filter((t) => t > now - 600);
  if (times.length >= SENDS_PER_10_MIN) return [429, 'Too many sends in ten minutes. Wait a little.'];
  recent.set(sender, [...times, now]);

  const html = String(form.get('html') ?? '');
  if (html.length > MAX_BYTES) return [413, 'That page is too large.'];
  const url = String(form.get('url') ?? '');
  const id = postId(url);
  if (!id || !/^https:\/\/(www\.|web\.|m\.)?facebook\.com\//.test(url)) return [400, 'That is not a Facebook post. Open the day’s post and try again.'];
  const title = String(form.get('title') ?? '').slice(0, 300);

  // Record the send before anything else can wait, so two sends of one post are recorded
  // in the order they arrived; the copy on disk is only for checking the reading later.
  const read = readPost(html);
  const result = recordSend(db, { at: now, sender, postId: id, url, title, bytes: html.length, read, agoToTime, enrich });
  await writeFile(join(RAW, `${now}-${id}-${randomUUID().slice(0, 8)}.html`), html, { flag: 'wx' });

  const send = { sort: read.sort, collapsed: read.collapsed, lines: read.lines.length, comments: read.comments.length };
  const keys = new Set(result.keys);
  const all = db.prepare('SELECT * FROM items WHERE post_id = ? ORDER BY first_seen, seq').all(id);
  const rows = all.filter((r) => keys.has(r.key));
  const fresh = new Set(rows.filter((r) => r.first_seen === now).map((r) => r.key));
  const a = analysePost(all, standingTexts());
  const infoOf = (r) => ({ kind: a.kinds.get(r.key), report: a.reports.has(r.key), ctx: a.context.get(r.key), staffTime: r.comment_id ? a.staffTimes.get(r.comment_id) : null, title: a.title });
  const w = warnings(send);
  const out = `<p><b>Thank you.</b> ${a.title ? '' : '<b>This is not a day post</b>, so nothing in it is read as a sighting. '}${rows.filter((r) => a.reports.has(r.key)).length} reports among ${read.lines.length} lines of the post and ${read.comments.length} comments: ${result.added} new, ${result.changed} changed${result.gone ? `, ${result.gone} lines gone from the post` : ''}. New ones are shaded.</p>
${w.map((x) => `<p class="warn">${x}</p>`).join('')}
<div class="scroll"><table>${HEAD}</tr>${ordered(rows).map((r) => rowHtml(r, { newKeys: fresh, postUrl: url, info: infoOf(r) })).join('')}</table></div>`;
  console.log(new Date().toISOString(), 'send', sender, id, `${html.length} bytes`, JSON.stringify(result));
  return [200, JSON.stringify({ ...result, keys: undefined, html: out }), 'application/json'];
}

// Posts as sent are kept for RAW_DAYS, so a fix to the reading can be checked against them.
const sweep = () => sweepRaw(Math.floor(Date.now() / 1000)).catch((e) => console.error('sweep', e));
sweep();
setInterval(sweep, 3600 * 1000).unref();

async function sweepRaw(now) {
  for (const f of await readdir(RAW)) {
    const p = join(RAW, f);
    if ((await stat(p)).mtimeMs / 1000 < now - RAW_DAYS * 86400) await unlink(p);
  }
}

function mark(body) {
  const { k, key, v, mark, note, who } = JSON.parse(body);
  if (!same(String(k ?? ''), viewToken)) return [403, 'no'];
  if (!['', 'right', 'partly', 'wrong', 'not a sighting'].includes(mark)) return [400, 'bad mark'];
  const row = db.prepare('SELECT * FROM items WHERE key = ?').get(String(key));
  if (!row) return [404, 'no such row'];
  const info = analyseAll(db.prepare('SELECT * FROM items WHERE post_id = ?').all(row.post_id)).infoOf(row);
  if (v !== version(row, info)) return [409, 'the text or its reading has changed'];
  db.prepare('UPDATE items SET mark = ?, note = ?, marked_by = ?, marked_at = ?, marked_version = ? WHERE key = ?')
    .run(mark || null, String(note ?? '').slice(0, 500) || null, String(who ?? '').slice(0, 60) || null, Math.floor(Date.now() / 1000), mark ? v : null, String(key));
  return [204, ''];
}

const placeList = (places) => places.map((p) => (p.unknown ? `${p.name} (unknown)` : `${p.name} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})`)).join('; ');

function csv() {
  const cols = ['post_id', 'post_date', 'post_kind', 'post_group', 'post_region', 'post_title', 'post_media', 'row_kind', 'time_from_staff', 'kind', 'comment_id', 'reply_to', 'author', 'ago', 'est_time', 'first_seen', 'last_seen', 'gone', 'text', 'clock', 'whales', 'pods', 'whales_from_context', 'context_from', 'direction', 'behaviour', 'places', 'clock_from_reply', 'direction_from_reply', 'places_from_reply', 'media', 'mark', 'note', 'marked_by'];
  const items = db.prepare('SELECT * FROM items ORDER BY post_id, first_seen, seq').all();
  const postMedia = new Map(db.prepare('SELECT post_id, media FROM posts').all().map((p) => [p.post_id, JSON.parse(p.media ?? '[]').join(' ')]));
  const { infoOf } = analyseAll(items);
  // A cell that starts like a formula is written as text, so a comment can't run in a spreadsheet.
  const q = (v) => {
    const t = String(v ?? '');
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const iso = (t) => (t ? new Date(t * 1000).toISOString() : '');
  const lines = items.map((r) => {
    const reading = JSON.parse(r.reading ?? '{}');
    const info = infoOf(r);
    const ctx = info.ctx;
    const m = markOf(r, info);
    const row = { ...r, est_time: iso(r.est_time), first_seen: iso(r.first_seen), last_seen: iso(r.last_seen),
      whales: (reading.claims ?? []).map(claimLabel).join(' '), pods: (reading.pods ?? []).join(' '), direction: reading.direction,
      behaviour: (reading.behaviour ?? []).join(' '), media: JSON.parse(r.media ?? '[]').join(' '), post_media: postMedia.get(r.post_id) ?? '',
      post_date: info.title?.date ?? '', post_kind: info.title?.kind ?? '', post_group: info.title?.group ?? '', post_region: info.title?.region ?? '',
      row_kind: info.kind ?? '', time_from_staff: info.staffTime ?? '',
      whales_from_context: ctx?.labels.join(' ') ?? '', context_from: ctx?.from ?? '', mark: m.mark, note: m.note, marked_by: m.marked_by, places: placeList(JSON.parse(r.places ?? '[]')),
      clock_from_reply: info.thread?.clock ?? '', direction_from_reply: info.thread?.direction ?? '', places_from_reply: placeList(info.thread?.places ?? []) };
    return cols.map((c) => q(row[c])).join(',');
  });
  return [cols.join(','), ...lines].join('\r\n');
}

async function body(req, limit = 64 * 1024) {
  let s = '';
  for await (const chunk of req) {
    s += chunk;
    if (s.length > limit) throw Object.assign(new Error('too large'), { status: 413 });
  }
  return s;
}

{
  // Marks made before versions were kept judged the row as it is now.
  const { infoOf } = analyseAll(db.prepare('SELECT * FROM items').all());
  for (const r of db.prepare('SELECT * FROM items WHERE mark IS NOT NULL AND marked_version IS NULL').all())
    db.prepare('UPDATE items SET marked_version = ? WHERE key = ?').run(version(r, infoOf(r)), r.key);
}

createServer(async (req, res) => {
  const send = (status, text, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' });
    res.end(text);
  };
  try {
    const u = new URL(req.url, 'http://x');
    const k = u.searchParams.get('k') ?? '';
    if (req.method === 'POST' && u.pathname === '/capture') return send(...(await capture(req)));
    if (req.method === 'POST' && u.pathname === '/mark') return send(...mark(await body(req)));
    if (req.method === 'GET' && u.pathname === '/receive') return send(200, receivePage, 'text/html; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/send') return send(200, sendPage, 'text/html; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/healthz') return send(200, 'ok');
    if (req.method === 'GET' && u.pathname === '/install') {
      const token = u.searchParams.get('s') ?? '';
      const label = senderFor(token);
      if (label) return send(200, installPage(token, label), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && u.pathname === '/' && same(k, viewToken)) return send(200, listPage(k), 'text/html; charset=utf-8');
    if (req.method === 'GET' && u.pathname === '/export.csv' && same(k, viewToken)) {
      res.setHeader('content-disposition', 'attachment; filename="facebook-sightings.csv"');
      return send(200, csv(), 'text/csv; charset=utf-8');
    }
    send(404, 'Not found');
  } catch (e) {
    console.error(e);
    send(e.status ?? 500, e.status ? e.message : 'Something went wrong.');
  }
}).listen(port, '127.0.0.1', () => console.log(`listening on 127.0.0.1:${port}, public ${base}/`));
