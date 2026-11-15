// Run with `pnpm test` here (node --test). The post below is made up, in the shape of
// Facebook's markup on 2026-11-12; real posts are not checked in, because they carry
// members' names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPost, clockTime, agoToTime, postId, EXPANDERS } from './read.mjs';
import { openStore, recordSend, rereadAll } from './store.mjs';
import { placeFinder, readAbbreviations } from './places.mjs';
import { contextFor, kindOf } from './context.mjs';

const link = (c, r) => `<a href="https://www.facebook.com/groups/1/posts/2/?comment_id=${c}${r ? `&amp;reply_comment_id=${r}` : ''}&amp;__cft__=x">1h</a>`;
const post = ({ extraLine = '', commentText = '1145 Exiting Port Susan close to Camano. Currently SB.', collapsed = true } = {}) => `
<div role="dialog"><div>
  <div dir="auto"><div dir="auto">Thursday, November 12th - ORCAS (Port Susan)</div><div dir="auto">.</div>
    <div dir="auto">10:30 - Orcas, Tillicum Beach [Camano] heading south.</div><div dir="auto">.</div>${extraLine}</div>
  <div role="button">All comments</div>
  <div role="article" aria-label="Comment by Pat Example 2 hours ago">${link(101)}<div dir="auto">${commentText}</div></div>
  <div role="article" aria-label="Reply by Orca Network to Pat Example's comment about an hour ago">${link(101, 102)}<div dir="auto">How many were there?</div></div>
  <div role="article" aria-label="Reply by Pat Example to Orca Network's reply 45 minutes ago">${link(101, 103)}<div dir="auto">3-4. Including a male.</div></div>
  <div role="article" aria-label="Comment by Sam Sample a day ago">${link(104)}<div dir="auto">T137s currently westbound here 11:50</div></div>
  ${collapsed ? '<div role="button">View 2 replies</div>' : ''}
</div></div>`;

test('reads the post\'s lines, comments and replies', () => {
  const r = readPost(post());
  assert.deepEqual(r.lines, ['Thursday, November 12th - ORCAS (Port Susan)', '10:30 - Orcas, Tillicum Beach [Camano] heading south.']);
  assert.deepEqual(r.comments.map((c) => [c.kind, c.id, c.replyTo, c.author, c.ago]), [
    ['comment', '101', null, 'Pat Example', '2 hours ago'],
    ['reply', '102', '101', 'Orca Network', 'about an hour ago'],
    ['reply', '103', '101', 'Pat Example', '45 minutes ago'],
    ['comment', '104', null, 'Sam Sample', 'a day ago'],
  ]);
  assert.equal(r.comments[0].text, '1145 Exiting Port Susan close to Camano. Currently SB.');
  assert.equal(r.collapsed, 1);
  assert.equal(r.sort, 'All comments');
});

test('photos and videos, in the post and in a comment, as links to Facebook', () => {
  const html = `<div role="dialog"><div dir="auto">10:30 Orcas</div>
    <a href="https://www.facebook.com/photo/?fbid=111&amp;set=gm.1&amp;__cft__=x"><img src="https://scontent.xx.fbcdn.net/a.jpg"></a>
    <div role="article" aria-label="Comment by Pat Example 5 minutes ago">${link(7)}<div dir="auto">Here they are</div>
      <a href="https://www.facebook.com/photo.php?fbid=222&amp;set=p.222&amp;__tn__=x"><img src="https://scontent.xx.fbcdn.net/b.jpg"></a>
      <a href="https://www.facebook.com/Someone/videos/333/?__cft__=x">video</a></div></div>`;
  const r = readPost(html);
  assert.deepEqual(r.media, ['https://www.facebook.com/photo/?fbid=111']);
  assert.deepEqual(r.comments[0].media, ['https://www.facebook.com/photo/?fbid=222', 'https://www.facebook.com/Someone/videos/333']);
});

test('a malformed link does not lose the send', () => {
  const r = readPost(`<div role="main"><div dir="auto">10:30 Orcas</div><a href="http://[">x</a>
    <div role="article" aria-label="Comment by Pat Example 5 minutes ago"><a href="http://[?comment_id=1">x</a>${link(8)}<div dir="auto">Still there</div></div></div>`);
  assert.deepEqual([r.lines, r.comments.map((c) => c.id), r.media], [['10:30 Orcas'], ['8'], []]);
});

test('a page with no comments or lines reads as empty, not as an error', () => {
  const r = readPost('<div role="main"><p>Something else</p></div>');
  assert.deepEqual([r.lines, r.comments, r.collapsed, r.sort, r.media], [[], [], 0, null, []]);
});

test('clock times', () => {
  assert.equal(clockTime('11:35 OBI/CWR has eyes on them'), '11:35');
  assert.equal(clockTime('1145Exiting Port Susan'), '11:45');
  assert.equal(clockTime('T137s currently westbound here 11:50'), '11:50');
  assert.equal(clockTime('Humpbacks at 2:05 pm off Alki'), '14:05');
  assert.equal(clockTime('T137s heading west'), null); // the digits of a designation are not a time
  assert.equal(clockTime('3-4. Including a male.'), null);
});

test('Facebook\'s relative times', () => {
  const sent = 1_000_000;
  assert.equal(agoToTime('2 hours ago', sent), sent - 7200);
  assert.equal(agoToTime('about an hour ago', sent), sent - 3600);
  assert.equal(agoToTime('a day ago', sent), sent - 86400);
  assert.equal(agoToTime('just now', sent), sent);
});

test('post ids', () => {
  assert.equal(postId('https://www.facebook.com/groups/564701038927716/permalink/1490225183041959/'), '1490225183041959');
  assert.equal(postId('https://www.facebook.com/groups/564701038927716/posts/1489227859808358'), '1489227859808358');
  assert.equal(postId('https://www.facebook.com/groups/564701038927716'), null);
});

test('repeated sends add only what is new, and notice edits', () => {
  const db = openStore(':memory:');
  const enrich = (text) => ({ clock: clockTime(text), reading: {}, places: [] });
  const send = (at, html) => recordSend(db, { at, sender: 'Test', postId: '2', url: 'u', title: 't', bytes: html.length, read: readPost(html), agoToTime, enrich });

  assert.deepEqual(pick(send(100, post())), { added: 6, changed: 0, gone: 0 });
  assert.deepEqual(pick(send(200, post())), { added: 0, changed: 0, gone: 0 });

  // Staff add a line to the post, and a commenter corrects theirs.
  const edited = post({ extraLine: '<div dir="auto">EDIT W/ IDs - T137s</div>', commentText: '1145 Exiting Port Susan. Currently SB.' });
  assert.deepEqual(pick(send(300, edited)), { added: 1, changed: 1, gone: 0 });
  const added = db.prepare("SELECT first_seen FROM items WHERE text = 'EDIT W/ IDs - T137s'").get();
  assert.equal(added.first_seen, 300);

  // The line is edited away again.
  assert.deepEqual(pick(send(400, post({ commentText: '1145 Exiting Port Susan. Currently SB.' }))), { added: 0, changed: 0, gone: 1 });
  assert.equal(db.prepare('SELECT count(*) AS n FROM sends').get().n, 4);
});

test('two identical lines in one post are kept apart by their order', () => {
  const db = openStore(':memory:');
  const html = '<div role="main"><div dir="auto"><div dir="auto">WSF</div><div dir="auto">10:00 orcas</div><div dir="auto">WSF</div></div></div>';
  const r = recordSend(db, { at: 1, sender: 'T', postId: '9', url: 'u', title: 't', bytes: 1, read: readPost(html), agoToTime, enrich: () => ({ clock: null, reading: {}, places: [] }) });
  assert.equal(r.added, 3);
});

test('place names, with the generic word dropped and whale words left alone', () => {
  const place = (name, kind = 'island') => ({ name, kind, lon: -122.5, lat: 48.1, zoom: 11, otherNames: [] });
  const find = placeFinder([place('Camano Island'), place('Camano Head', 'point'), place('Saratoga Passage', 'water'), place('Orcas Island'), place('Point No Point', 'point')]);
  const names = (t) => find(t).map((p) => p.name);
  assert.deepEqual(names('1150 Northbound Saratoga. Hugging Camano.'), ['Saratoga Passage', 'Camano Island']);
  assert.deepEqual(names('They have turned west at Camano Head.'), ['Camano Head']);
  assert.deepEqual(names('Orcas off Point No Point'), ['Point No Point']);
  assert.deepEqual(names('heading to the point'), []);
});

test('a named place the gazetteers lack is unknown, not a shorter name inside it', () => {
  const place = (name, kind = 'city') => ({ name, kind, lon: -123.1, lat: 49.2, zoom: 11, otherNames: [] });
  const find = placeFinder([place('Richmond'), place('Alki Point', 'point'), place('Elliott Bay', 'water')]);
  const names = (t) => find(t).map((p) => p.name + (p.unknown ? '?' : ''));
  assert.deepEqual(names('12:20, BCY0141 Falcon is feeding around Richmond Beach'), ['Richmond Beach?']);
  assert.deepEqual(names('Off Alki Point heading to Elliott Bay'), ['Elliott Bay', 'Alki Point']);
  assert.deepEqual(names('Seen from Richmond, heading north'), ['Richmond']);
  assert.deepEqual(names('Viewing from Boston harbor 9:19 heading north'), ['Boston harbor?']);
  assert.deepEqual(names('just north of Richmond ferry'), ['Richmond']);
});

test('a known name at the end of a capitalised run is found, with nothing unknown', () => {
  const place = (name) => ({ name, kind: 'island', lon: -123, lat: 48.8, zoom: 11, otherNames: [] });
  const find = placeFinder([place('Camano Island'), place('North Pender Island')]);
  const names = (t) => find(t).map((p) => p.name + (p.unknown ? '?' : ''));
  assert.deepEqual(names('Hugging Camano Island'), ['Camano Island']);
  assert.deepEqual(names('North Pender Island, heading east'), ['North Pender Island']);
});

test('reading stored rows again updates their results and clears marks on the ones that change', () => {
  const db = openStore(':memory:');
  const html = '<div role="main"><div dir="auto"><div dir="auto">BCY0141 off Richmond Beach</div><div dir="auto">12:00 T137s</div></div></div>';
  recordSend(db, { at: 1, sender: 'T', postId: '5', url: 'u', title: 't', bytes: 1, read: readPost(html), agoToTime, enrich: (t) => ({ clock: null, reading: { claims: [] }, places: [] }) });
  db.prepare("UPDATE items SET mark = 'wrong'").run();
  const better = (t) => ({ clock: null, reading: { claims: t.startsWith('BCY') ? [{ code: 'BCY141' }] : [] }, places: [] });
  assert.equal(rereadAll(db, better), 1);
  assert.deepEqual(db.prepare('SELECT text, mark FROM items ORDER BY seq').all().map((r) => [r.text, r.mark]),
    [['BCY0141 off Richmond Beach', null], ['12:00 T137s', 'wrong']]);
});

test('the buttons that hide comments', () => {
  for (const t of ['View more comments', 'View all comments', 'View previous comments', 'View 2 replies', 'View all 5 replies', 'View 3 more replies', '4 replies', 'See more'])
    assert.ok(EXPANDERS.test(t), t);
  for (const t of ['All comments', 'Most relevant', 'Reply', 'See more photos']) assert.ok(!EXPANDERS.test(t), t);
});

test('a post that is itself an article keeps its lines', () => {
  const html = `<div role="main"><div role="article"><div dir="auto">10:30 Orcas off Camano</div>
    <div role="article" aria-label="Comment by Pat Example 5 minutes ago">${link(7)}<div dir="auto">Still there</div></div></div></div>`;
  const r = readPost(html);
  assert.deepEqual(r.lines, ['10:30 Orcas off Camano']);
  assert.deepEqual(r.comments.map((c) => c.text), ['Still there']);
});

test('text beside a nested block is kept, once, in order', () => {
  const r = readPost('<div role="main"><div dir="auto">10:30 Orcas<div dir="auto">off Camano</div>heading south<br>WSF</div></div>');
  assert.deepEqual(r.lines, ['10:30 Orcas', 'off Camano', 'heading south', 'WSF']);
});

test('an edited comment loses the mark made on its old wording', () => {
  const db = openStore(':memory:');
  const enrich = () => ({ clock: null, reading: {}, places: [] });
  const send = (at, html) => recordSend(db, { at, sender: 'T', postId: '2', url: 'u', title: 't', bytes: 1, read: readPost(html), agoToTime, enrich });
  send(1, post());
  db.prepare("UPDATE items SET mark = 'right', note = 'ok', marked_by = 'Scott' WHERE key = 'c:101'").run();
  send(2, post());
  assert.equal(db.prepare("SELECT mark FROM items WHERE key = 'c:101'").get().mark, 'right');
  send(3, post({ commentText: '1145 Exiting Port Susan. Currently NB.' }));
  assert.deepEqual({ ...db.prepare("SELECT mark, note, marked_by FROM items WHERE key = 'c:101'").get() }, { mark: null, note: null, marked_by: null });
});

test('a mention elsewhere in the text, and names across a full stop, are each their own', () => {
  const place = (name, kind = 'city') => ({ name, kind, lon: -123.1, lat: 49.2, zoom: 11, otherNames: [] });
  const find = placeFinder([place('Richmond'), place('Alki Point', 'point')]);
  const names = (t) => find(t).map((p) => p.name + (p.unknown ? '?' : ''));
  assert.deepEqual(names('Richmond Beach; later seen from Richmond'), ['Richmond', 'Richmond Beach?']);
  assert.deepEqual(names('Richmond Beach. Alki Point.'), ['Alki Point', 'Richmond Beach?']);
});

test('the animals a report means but does not name', () => {
  const row = (key, kind, text, extra = {}) => ({ key, kind, text, gone: 0, comment_id: null, reply_to: null, clock: null,
    reading: JSON.stringify({ claims: [], pods: [], direction: null, behaviour: [], ...(extra.reading ?? {}) }), places: '[]', ...extra, ...{ reading: JSON.stringify({ claims: [], pods: [], direction: null, behaviour: [], ...(extra.reading ?? {}) }) } });
  const claim = (code) => ({ code, presence: 'present', certainty: 'certain' });
  const rows = [
    row('l1', 'line', 'EDIT W/ IDs - T137s', { reading: { claims: [claim('T137s')] } }),
    row('c1', 'comment', 'They have turned west at Camano Head.', { comment_id: '1', reading: { direction: 'west' } }),
    row('c2', 'comment', 'Thank you', { comment_id: '2' }),
    row('c3', 'comment', 'T137A heading north 11:50', { comment_id: '3', clock: '11:50', reading: { claims: [claim('T137A')], direction: 'north' } }),
    row('r1', 'reply', 'still northbound', { comment_id: '4', reply_to: '3', reading: { direction: 'north' } }),
  ];
  const ctx = contextFor(rows);
  assert.deepEqual(ctx.get('c1'), { labels: ['T137s'], from: 'post' });
  assert.equal(ctx.get('c2'), undefined); // says nothing a sighting says
  assert.equal(ctx.get('c3'), undefined); // names its own
  assert.deepEqual(ctx.get('r1'), { labels: ['T137A'], from: 'comment' });

  // A post that names animals of two kinds gives none.
  const mixed = [row('l2', 'line', 'J pod and T137s', { reading: { claims: [claim('T137s')], pods: ['J'] } }), rows[1]];
  assert.equal(contextFor(mixed).get('c1'), undefined);
  // A row that says an animal was absent keeps to what it says, and borrows nothing.
  const absent = row('c4', 'comment', '12:40 T137A not with them, heading north', { comment_id: '5', clock: '12:40',
    reading: { claims: [{ code: 'T137A', presence: 'absent', certainty: 'certain' }], direction: 'north' } });
  assert.equal(contextFor([rows[0], absent]).get('c4'), undefined);
  assert.equal(kindOf('BCY141'), kindOf('BCX1068'));
  assert.equal(kindOf('J27'), kindOf('L119'));
  assert.notEqual(kindOf('T137s'), kindOf('J27'));
});

test('confirmed abbreviations, and no name across a line break', () => {
  const place = (name, kind = 'point') => ({ name, kind, lon: -122.5, lat: 47.9, zoom: 11, otherNames: [] });
  const find = placeFinder([place('Point No Point'), place('Camano Island', 'island'), place('Richmond', 'city')],
    [{ abbreviation: 'PNP', place: 'Point No Point' }]);
  const names = (t) => find(t).map((p) => p.name + (p.abbreviation ? ` (${p.abbreviation})` : '') + (p.unknown ? '?' : ''));
  assert.deepEqual(names('Humpbacks N of PNP SE bound'), ['Point No Point (PNP)']);
  assert.deepEqual(names('pnp is not it'), []);
  assert.deepEqual(names('Camano Island\nRichmond Beach'), ['Camano Island', 'Richmond Beach?']);
  const confirmed = readAbbreviations();
  assert.ok(confirmed.some((a) => a.abbreviation === 'PNP' && a.place === 'Point No Point'));
  assert.ok(!confirmed.some((a) => a.abbreviation === 'HB'), 'only place abbreviations');
});

const pick = ({ added, changed, gone }) => ({ added, changed, gone });
