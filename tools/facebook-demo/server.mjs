// A demo of decision 117 for Scott and Orca Network's staff (bd salish-i1a.3.10): people
// send a Facebook group's day post with a bookmarklet, and this keeps its lines and
// comments with what the reader of sighting text makes of them. It writes nothing to
// production. Run behind Apache on Maderas; see README.md.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { readSighting } from '../../src/sighting-text.ts';
import { readPost, agoToTime, clockTime, postId, EXPANDERS } from './read.mjs';
import { openStore, recordSend } from './store.mjs';
import { loadPlaces } from './places.mjs';

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

// Which wording a mark judged: a mark sent for older text than the row now has is refused.
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);
// How the page and the CSV write the reader's whale identifiers: "T65A?" possible, "(absent)" said not to be there.
const claimLabel = (c) => c.code + (c.presence === 'absent' ? ' (absent)' : c.certainty !== 'certain' ? '?' : '');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const senderFor = (token) => Object.entries(senders).find(([t]) => same(token, t))?.[1] ?? null;
const enrich = (text) => {
  const r = readSighting(text);
  return { clock: clockTime(text), reading: r, places: findPlaces(text) };
};

// --- the bookmarklet ---------------------------------------------------------------

// Sends the open post (a dialog over the feed, or the post's own page), never the whole
// page, which carries the sender's chats. If Facebook is hiding comments, it opens them
// and asks for another click instead: the pop-up must open within a few seconds of the click.
const sendSource = (token) => `void (async()=>{
const say=(t)=>{const d=document.createElement('div');d.textContent=t;Object.assign(d.style,{position:'fixed',top:'72px',left:'50%',transform:'translateX(-50%)',zIndex:2147483647,background:'#1d3c78',color:'#fff',padding:'12px 18px',borderRadius:'8px',font:'15px system-ui,sans-serif',maxWidth:'34em'});document.body.appendChild(d);setTimeout(()=>d.remove(),7000);};
const ds=[...document.querySelectorAll('[role=dialog]')].filter(d=>d.querySelector('[role=article]'));
const el=ds.pop()||document.querySelector('[role=main]');
if(!el){say('SalishSea: open the day\\'s post first.');return;}
const re=new RegExp(${JSON.stringify(EXPANDERS.source)},'i');
const hidden=[...el.querySelectorAll('[role=button]')].filter(b=>re.test(b.textContent.trim()));
if(hidden.length){hidden.forEach(b=>b.click());say('SalishSea: opening '+hidden.length+' hidden comments. Click Send again when they have loaded.');return;}
const msg=JSON.stringify({html:el.outerHTML,url:location.href,title:document.title,sent_at:new Date().toISOString()});
const gz=new Uint8Array(await new Response(new Blob([msg]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
let bin='';for(let i=0;i<gz.length;i+=32768)bin+=String.fromCharCode.apply(null,gz.subarray(i,i+32768));
const data=btoa(bin).replace(/[+]/g,'-').replace(/[/]/g,'_').replace(/=+$/,'');
const w=window.open('${base}/receive#s=${token}&d='+data,'_blank','popup,width=1000,height=760');
if(!w)say('SalishSea: the window was blocked. Allow pop-ups for facebook.com and click Send again.');
})()`;

const bookmarklet = (src) => 'javascript:' + encodeURIComponent(src.replace(/\n/g, ''));

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
.none{color:var(--muted)}.warn{border-left:4px solid var(--bad);padding:.4rem .8rem;background:var(--soft)}
.stats{display:flex;flex-wrap:wrap;gap:.5rem 1.5rem;padding:0;list-style:none}.stats b{font-size:1.2rem;display:block}
a.bm{display:inline-block;padding:.5rem .9rem;border:2px solid var(--accent);border-radius:8px;text-decoration:none;font-weight:600}
select,input{font:inherit;font-size:13px}td.mark{min-width:9rem}
.scroll{overflow-x:auto}details summary{cursor:pointer}tr.standing td{font-size:13px}
</style><body>${body}</body></html>`;

function chips(list, cls = '') {
  return list.length ? list.map((x) => `<span class="chip ${cls}">${x}</span>`).join('') : '<span class="none">—</span>';
}

function rowHtml(r, { marks = false, newKeys = new Set(), standing = new Set() } = {}) {
  if (standing.has(r.text)) {
    return `<tr class="standing"><td>${r.kind === 'line' ? 'post' : 'comment'}<div class="muted">${esc(r.author ?? '')}</div></td><td></td>
<td colspan="${marks ? 6 : 5}" class="muted"><details><summary>Standing text, in every post: ${esc(r.text.split('\n')[0].slice(0, 80))}…</summary><div class="text">${esc(r.text)}</div></details></td></tr>`;
  }
  const reading = JSON.parse(r.reading ?? '{}');
  const places = JSON.parse(r.places ?? '[]');
  const codes = (reading.claims ?? []).map((c) => esc(claimLabel(c)));
  const pods = (reading.pods ?? []).map((p) => esc(p + ' pod'));
  const placeChips = places.map((p) => `<a href="https://salishsea.io${esc(p.href)}" title="${esc(p.kind)} ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}${p.alike > 1 ? ` (one of ${p.alike} with this name)` : ''}">${esc(p.name)}${p.alike > 1 ? ` ×${p.alike}` : ''}</a>`);
  const when = r.kind === 'line' ? 'post' : r.kind === 'reply' ? `↳ reply` : 'comment';
  const time = new Date(r.first_seen * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false });
  const markCell = marks ? `<td class="mark"><select data-key="${esc(r.key)}" data-v="${version(r.text)}" aria-label="Did the reader get it right?">
${['', 'right', 'partly', 'wrong', 'not a sighting'].map((m) => `<option value="${m}"${(r.mark ?? '') === m ? ' selected' : ''}>${m || '—'}</option>`).join('')}</select>
<input data-note="${esc(r.key)}" value="${esc(r.note)}" placeholder="note" size="10">${r.marked_by ? `<div class="muted">${esc(r.marked_by)}</div>` : ''}</td>` : '';
  return `<tr class="${newKeys.has(r.key) ? 'new' : ''}${r.gone ? ' gone' : ''}">
<td>${when}<div class="muted">${esc(r.author ?? '')}</div></td>
<td>${esc(r.clock ?? '')}<div class="muted" title="when this first arrived (Pacific)">seen ${time}</div></td>
<td class="text">${esc(r.text)}</td>
<td>${chips([...codes, ...pods])}</td><td>${esc(reading.direction ?? '') || '<span class="none">—</span>'}</td>
<td>${chips((reading.behaviour ?? []).map(esc))}</td><td>${chips(placeChips)}</td>${markCell}</tr>`;
}

// Orca Network's standing text (the laws, the viewpoints map) is in every day's post. Text
// that has appeared in two posts or more is shown folded and left out of the figures.
const standingTexts = () => new Set(db.prepare('SELECT text FROM items GROUP BY text HAVING count(DISTINCT post_id) >= 2').all().map((r) => r.text));

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
  if (send.collapsed) out.push(`${send.collapsed} comments or replies were still collapsed. Click Send again to open them.`);
  if (!send.lines && !send.comments) out.push('Nothing was read from this page. Is it a day post? If it is, Facebook may have changed its page, so tell Peter.');
  return out;
}

function stats(rows) {
  const n = rows.length || 1;
  const pct = (k) => `${Math.round((100 * k) / n)}%`;
  const has = (f) => rows.filter(f).length;
  const reading = (r) => JSON.parse(r.reading ?? '{}');
  const marked = rows.filter((r) => r.mark);
  const count = (m) => marked.filter((r) => r.mark === m).length;
  return `<ul class="stats">
<li><b>${rows.length}</b>lines and comments, besides standing text</li>
<li><b>${pct(has((r) => reading(r).claims?.length || reading(r).pods?.length))}</b>name whales</li>
<li><b>${pct(has((r) => reading(r).direction))}</b>give a heading</li>
<li><b>${pct(has((r) => r.clock))}</b>give a clock time</li>
<li><b>${pct(has((r) => JSON.parse(r.places ?? '[]').length))}</b>name a place we know</li>
<li><b>${marked.length}</b>checked: ${count('right')} right, ${count('partly')} partly, ${count('wrong')} wrong, ${count('not a sighting')} not sightings</li></ul>`;
}

function listPage(k) {
  const posts = db.prepare(`SELECT post_id, max(post_title) AS title, min(first_seen) AS first FROM items GROUP BY post_id ORDER BY first DESC`).all();
  const rows = db.prepare('SELECT * FROM items ORDER BY first_seen, seq').all();
  const sends = db.prepare('SELECT * FROM sends ORDER BY at DESC LIMIT 30').all();
  const byPost = Map.groupBy(rows, (r) => r.post_id);
  const standing = standingTexts();
  const sections = posts.map((p) => `<h2 id="p${esc(p.post_id)}">${esc(heading(p.title, byPost.get(p.post_id) ?? []))}</h2>
<div class="scroll"><table>${HEAD}<th>Right?</th></tr>${ordered(byPost.get(p.post_id) ?? []).map((r) => rowHtml(r, { marks: true, standing })).join('')}</table></div>`);
  const sendRows = sends.map((s) => `<tr><td>${new Date(s.at * 1000).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</td><td>${esc(s.sender)}</td><td>${esc(heading(s.title, byPost.get(s.post_id) ?? []))}</td><td>${s.added} new, ${s.changed} changed, ${s.gone} gone</td><td>${warnings(s).length ? '<span title="' + esc(warnings(s).join(' ')) + '">incomplete</span>' : 'complete'}</td></tr>`).join('');
  return page('Facebook sightings demo', `<h1>Sightings read from Orca Network's Community Group</h1>
<p class="muted">A trial of SalishSea.io's <a href="https://github.com/salish-sea/salishsea-io/blob/main/docs/decisions/117-sightings-from-a-facebook-group-arrive-when-a-signed-in-person-sends-the-days-post.md">decision 117</a>. Each line of a day's post and each comment, as it arrived, with what SalishSea.io's reader of sighting text found in it. Nothing here is published. Please mark whether the reader got each one right. <a href="export.csv?k=${esc(k)}">Download all as CSV</a>.</p>
<p><label>Your name, for your marks: <input id="who" size="16"></label></p>
${stats(rows.filter((r) => !standing.has(r.text)))}
${sections.join('') || '<p class="muted">Nothing has been sent yet.</p>'}
<h2>Recent sends</h2><div class="scroll"><table><tr><th>When</th><th>Sender</th><th>Post</th><th>Rows</th><th>Complete?</th></tr>${sendRows}</table></div>
<script>
const k=${JSON.stringify(k)};const who=document.getElementById('who');
try{who.value=localStorage.getItem('who')||''}catch{}
who.addEventListener('change',()=>{try{localStorage.setItem('who',who.value)}catch{}});
const save=(key)=>{const sel=document.querySelector('select[data-key="'+CSS.escape(key)+'"]');
fetch('mark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k,key,v:sel.dataset.v,mark:sel.value,note:document.querySelector('input[data-note="'+CSS.escape(key)+'"]').value,who:who.value})})
.then(r=>{if(r.status===409)alert('That text has changed since this page was loaded. Reload the page and mark it again.');else if(!r.ok)alert('Not saved: '+r.status)});};
document.addEventListener('change',(e)=>{const key=e.target.dataset.key||e.target.dataset.note;if(key)save(key);});
</script>`);
}

function installPage(token, label) {
  return page('Send Facebook posts to SalishSea.io', `<h1>Send Facebook posts to SalishSea.io</h1>
<p>Hello ${esc(label)}. This is a trial: what you send is kept for Peter, Scott and Orca Network to look at, and is not published.</p>
<ol><li>On a computer, in Chrome or Firefox, show the bookmarks bar (Ctrl+Shift+B, or ⌘⇧B on a Mac).</li>
<li>Drag this button onto it: <a class="bm" href="${esc(bookmarklet(sendSource(token)))}">Send to SalishSea</a></li>
<li>In Orca Network's Community Group, open the day's post, and set the comments to “All comments”.</li>
<li>Click <b>Send to SalishSea</b> in the bookmarks bar. If some comments are hidden, it opens them and asks you to click again. Then a small window shows what was read.</li></ol>
<p class="muted">The button is yours alone; please don't share it. Send as often as you like: each send adds only what's new.</p>`);
}

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
  const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: Readable.toWeb(req), duplex: 'half' }).formData();
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
  if (!id || !/^https:\/\/(www\.|web\.)?facebook\.com\//.test(url)) return [400, 'That is not a Facebook post. Open the day’s post and try again.'];
  const title = String(form.get('title') ?? '').slice(0, 300);

  const read = readPost(html);
  await writeFile(join(RAW, `${now}-${id}-${randomUUID().slice(0, 8)}.html`), html, { flag: 'wx' });
  const result = recordSend(db, { at: now, sender, postId: id, url, title, bytes: html.length, read, agoToTime, enrich });

  const send = { sort: read.sort, collapsed: read.collapsed, lines: read.lines.length, comments: read.comments.length };
  const keys = new Set(result.keys);
  const rows = db.prepare('SELECT * FROM items WHERE post_id = ? ORDER BY first_seen, seq').all(id)
    .filter((r) => keys.has(r.key));
  const fresh = new Set(rows.filter((r) => r.first_seen === now).map((r) => r.key));
  const standing = standingTexts();
  const w = warnings(send);
  const out = `<p><b>Thank you.</b> ${read.lines.length} lines of the post and ${read.comments.length} comments read: ${result.added} new, ${result.changed} changed${result.gone ? `, ${result.gone} lines gone from the post` : ''}. New ones are shaded.</p>
${w.map((x) => `<p class="warn">${x}</p>`).join('')}
<div class="scroll"><table>${HEAD}</tr>${ordered(rows).map((r) => rowHtml(r, { newKeys: fresh, standing })).join('')}</table></div>`;
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
  const row = db.prepare('SELECT text FROM items WHERE key = ?').get(String(key));
  if (!row) return [404, 'no such row'];
  if (v !== version(row.text)) return [409, 'the text has changed'];
  db.prepare('UPDATE items SET mark = ?, note = ?, marked_by = ?, marked_at = ? WHERE key = ?')
    .run(mark || null, String(note ?? '').slice(0, 500) || null, String(who ?? '').slice(0, 60) || null, Math.floor(Date.now() / 1000), String(key));
  return [204, ''];
}

function csv() {
  const cols = ['post_id', 'post_title', 'kind', 'comment_id', 'reply_to', 'author', 'ago', 'est_time', 'first_seen', 'last_seen', 'gone', 'text', 'clock', 'whales', 'pods', 'direction', 'behaviour', 'places', 'mark', 'note', 'marked_by'];
  // A cell that starts like a formula is written as text, so a comment can't run in a spreadsheet.
  const q = (v) => {
    const t = String(v ?? '');
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const iso = (t) => (t ? new Date(t * 1000).toISOString() : '');
  const lines = db.prepare('SELECT * FROM items ORDER BY post_id, first_seen, seq').all().map((r) => {
    const reading = JSON.parse(r.reading ?? '{}');
    const row = { ...r, est_time: iso(r.est_time), first_seen: iso(r.first_seen), last_seen: iso(r.last_seen),
      whales: (reading.claims ?? []).map(claimLabel).join(' '), pods: (reading.pods ?? []).join(' '), direction: reading.direction,
      behaviour: (reading.behaviour ?? []).join(' '), places: JSON.parse(r.places ?? '[]').map((p) => `${p.name} (${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})`).join('; ') };
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
