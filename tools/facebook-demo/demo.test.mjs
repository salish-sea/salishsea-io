// Run with `pnpm test` here (node --test). The post below is made up, in the shape of
// Facebook's markup on 2026-11-12; real posts are not checked in, because they carry
// members' names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPost, clockTime, agoToTime, postId, EXPANDERS } from './read.mjs';
import { openStore, recordSend, rereadAll } from './store.mjs';
import { placeFinder, readAbbreviations, readFerryRoutes } from './places.mjs';
import { contextFor, kindOf } from './context.mjs';
import { classifyPost, stripMention, staffTime } from './classify.mjs';
import { parseTitle } from './title.mjs';

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
  assert.equal(clockTime('east of yellow buoy 11am'), '11:00');
  assert.equal(clockTime('Viewing from constellation 1055'), '10:55');
  assert.equal(clockTime('614am heading north'), null); // three digits before am: left alone
  assert.equal(clockTime('T137 pod'), null);
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

test('a named ferry is its route, and a ferry terminal is the terminal', () => {
  const t = (name, lon, lat) => ({ name, kind: 'ferry_terminal', lon, lat, zoom: 13, otherNames: [] });
  const town = (name) => ({ name, kind: 'town', lon: -122.49, lat: 47.79, zoom: 12, otherNames: [] });
  const find = placeFinder([t('Edmonds', -122.385, 47.813), t('Kingston', -122.495, 47.795), town('Kingston'), { name: 'Point Jefferson', kind: 'point', lon: -122.473, lat: 47.748, zoom: 13, otherNames: [] }],
    [{ abbreviation: 'Jeff Head', place: 'Point Jefferson' }],
    [{ name: 'Kingston', route: 'Edmonds–Kingston', terminals: ['Edmonds', 'Kingston'] }, { name: 'Edmonds', route: 'Edmonds–Kingston', terminals: ['Edmonds', 'Kingston'] }]);
  const names = (txt) => find(txt).map((p) => p.name + (p.unknown ? '?' : ''));
  assert.deepEqual(names('humpback north of the Kingston Ferry'), ['Edmonds–Kingston ferry']);
  assert.deepEqual(names('seen from the Edmonds ferry and the Kingston ferry'), ['Edmonds–Kingston ferry']);
  assert.deepEqual(names('at the Kingston ferry terminal'), ['Kingston']);
  assert.deepEqual(names('at the Kingston Ferry Terminal'), ['Kingston']);
  assert.deepEqual(names('the Kingston ferry docking at Edmonds'), ['Edmonds–Kingston ferry', 'Edmonds']);
  assert.deepEqual(names('midchannel off E Jeff Head!'), ['Point Jefferson']);
  const route = find('the Kingston ferry')[0];
  assert.deepEqual(route.line, [[-122.385, 47.813], [-122.495, 47.795]]);
  assert.ok(readFerryRoutes().some((r) => r.name === 'Clinton' && r.route === 'Mukilteo–Clinton'));
});

test('a terminal code is the terminal, and a phrase matches in any case', () => {
  const pl = (name, kind) => ({ name, kind, lon: -122.88, lat: 48.57, zoom: 12, otherNames: [] });
  const find = placeFinder([pl('Lopez Island', 'island'), pl('Lopez Island', 'ferry_terminal'), pl('Ediz Hook', 'point')],
    [{ abbreviation: 'LPZ', place: 'Lopez Island', terminal: true }, { abbreviation: 'the hook', place: 'Ediz Hook', terminal: false }]);
  const got = (t) => find(t).map((p) => `${p.name} ${p.kind}`);
  assert.deepEqual(got('LPZ [Lopez Island] dock'), ['Lopez Island ferry_terminal']);
  assert.deepEqual(got('viewed from the hook with binos'), ['Ediz Hook point']);
  assert.deepEqual(got('The hook again'), ['Ediz Hook point']);
  assert.deepEqual(got('lpz dock'), []); // a code in capitals must be written so
  const rows = readAbbreviations();
  assert.ok(rows.find((r) => r.abbreviation === 'FAU')?.terminal);
});

test('a day post\'s title gives its date, animals, group and region', () => {
  const nov = Date.UTC(2026, 10, 15) / 1000;
  assert.deepEqual(parseTitle('❤️🍎❤️Thursday, November 12th - ORCAS (Port Susan)', nov), { date: '2026-11-12', kind: 'orcas', group: null, region: 'Port Susan' });
  assert.deepEqual(parseTitle('Tuesday, November 10th - GROUP TWO ORCAS (Possession Sound)', nov), { date: '2026-11-10', kind: 'orcas', group: 'TWO', region: 'Possession Sound' });
  assert.equal(parseTitle('Monday, November 9th - SOUTHERN RESIDENT ORCAS (North Puget Sound)', nov).kind, 'Southern Resident orcas');
  assert.equal(parseTitle('Sunday, November 8 - Baleen whale post for today ~', nov).kind, 'baleen whales');
  assert.equal(parseTitle('Over the past few weeks many of you have been able to spend some time', nov), null);
  assert.equal(parseTitle('Wednesday, December 30th - ORCAS', Date.UTC(2027, 0, 2) / 1000).date, '2026-12-30');
});

test('each row of a post gets a kind, and only reports are read', () => {
  let n = 0;
  const row = (kind, text, extra = {}) => ({ key: `k${++n}`, kind, text, seq: n, first_seen: Date.UTC(2026, 10, 12) / 1000, gone: 0, comment_id: null, reply_to: null, author: null,
    clock: null, reading: JSON.stringify(extra.reading ?? {}), places: JSON.stringify(extra.places ?? []), ...extra, ...{ reading: JSON.stringify(extra.reading ?? {}), places: JSON.stringify(extra.places ?? []) } });
  const rows = [
    row('line', 'Thursday, November 12th - ORCAS (Port Susan)'),
    row('line', 'Appreciations to ON staff member Rachel Haight for relaying this report!'),
    row('line', 'EDIT W/ IDs - T137s per Orca Behavior Institute', { reading: { claims: [{ code: 'T137s', presence: 'present', certainty: 'certain' }] } }),
    row('line', '10:30 - Orcas, Tillicum Beach [Camano] heading south.', { clock: '10:30', reading: { direction: 'south' } }),
    row('line', 'Patrick [PSWW chat]'),
    row('comment', 'Are they north or south of the ferry lanes?', { comment_id: '1', author: 'Pat Example', reading: { direction: 'north' } }),
    row('comment', '1145 Exiting Port Susan close to Camano. Currently SB.', { comment_id: '2', author: 'Sam Sample', clock: '11:45', reading: { direction: 'south' } }),
    row('reply', 'Sam Sample thanks! time, 9:22', { comment_id: '3', reply_to: '2', author: 'Orca Network' }),
    row('reply', 'Just saw his blow directly out from stamm', { comment_id: '4', reply_to: '2', author: 'Sam Sample' }),
    row('comment', 'calls loud and clear on Sunset Bay', { comment_id: '5', author: 'Lee Listener' }),
    row('comment', 'Pat Example thank you', { comment_id: '6', author: 'Orca Network' }),
    row('comment', '12:20 no sign of them', { comment_id: '7', author: 'Pat Example', clock: '12:20' }),
  ];
  const { title, kinds } = classifyPost(rows);
  assert.equal(title.date, '2026-11-12');
  assert.deepEqual(rows.map((r) => kinds.get(r.key)),
    ['title', 'thanks', 'staff edit', 'report', 'credit', 'question', 'report', 'staff time', 'report', 'hydrophone', 'thanks', 'nothing seen']);
  assert.equal(staffTime(rows[7]), '9:22');
  assert.equal(stripMention('Mica Samuelle- Across from Burfoot.', ['Mica Samuelle']), 'Across from Burfoot.');
  // A post that isn't a day post: nothing in it is a report.
  const announcement = classifyPost([row('line', 'Over the past few weeks many of you have…'), row('line', 'Falcon will soon be heading south', { reading: { direction: 'south' } })]);
  assert.equal(announcement.title, null);
  assert.deepEqual([...announcement.kinds.values()], ['other post', 'other post']);
});

test('fixes from review: full names kept, questions with times, credit lines, titles, bad dates', () => {
  const pl = (name, kind = 'island') => ({ name, kind, lon: -122.35, lat: 47.58, zoom: 12, otherNames: [] });
  assert.deepEqual(placeFinder([pl('Harbor Island')])('off Harbor Island now').map((p) => p.name), ['Harbor Island']);
  assert.deepEqual(placeFinder([pl('Harbor Island')])('from Boston Harbor').map((p) => p.name), ['Boston Harbor']);
  assert.equal(parseTitle('Thursday, November 32nd - ORCAS', Date.UTC(2026, 10, 15) / 1000), null);

  let n = 0;
  const row = (kind, text, extra = {}) => ({ key: `r${++n}`, kind, text, seq: extra.seq ?? n, first_seen: Date.UTC(2026, 10, 12) / 1000, gone: 0, comment_id: null, reply_to: null, author: null, clock: null, reading: '{}', places: '[]', ...extra });
  const rows = [
    row('line', 'Thursday, November 12th - ORCAS (Port Susan)', { seq: 0, gone: 1 }),
    row('line', 'Thursday, November 12th - HUMPBACKS (Port Susan)', { seq: 0 }),
    row('line', '10:30 - Orcas, Tillicum Beach heading south.', { clock: '10:30', reading: JSON.stringify({ direction: 'south' }) }),
    row('line', 'Just saw a blow'),
    row('comment', 'Were they off Camano at 11:30?', { comment_id: '1', author: 'Pat', clock: '11:30', places: JSON.stringify([{ name: 'Camano Island' }]) }),
    row('comment', '1150 northbound, any IDs?', { comment_id: '2', author: 'Sam', clock: '11:50', reading: JSON.stringify({ direction: 'north' }) }),
  ];
  const { title, kinds } = classifyPost(rows);
  assert.equal(title.kind, 'humpbacks');
  assert.deepEqual(rows.map((r) => kinds.get(r.key)), ['edited away', 'title', 'report', 'report', 'question', 'report']);
  const more = [rows[1],
    row('line', '11:30 - calls loud and clear on Sunset Bay'),
    row('line', '11:40 - visible on LK livestream'),
    row('comment', '11:30am northbound, any IDs?', { comment_id: '9', author: 'Lee', clock: '11:30', reading: JSON.stringify({ direction: 'north' }) }),
    row('comment', '11am still here, any IDs?', { comment_id: '10', author: 'Lee', clock: '11:00' })];
  const k2 = classifyPost(more).kinds;
  assert.deepEqual(more.slice(1).map((r) => k2.get(r.key)), ['hydrophone', 'webcam', 'report', 'report']);
});

test('a send that adds a name to the thread reads the thread again', () => {
  const db = openStore(':memory:');
  const enrich = (text, names) => ({ clock: null, reading: {}, places: stripMention(text, names).startsWith('Dana') ? [{ name: 'Dana Passage' }] : [] });
  const reply = `<div role="article" aria-label="Reply by Orca Network to Pat Example's comment 5 minutes ago">${link(1, 2)}<div dir="auto">Dana Smith thanks</div></div>`;
  const first = `<div role="main">${reply}</div>`;
  const later = `<div role="main"><div role="article" aria-label="Comment by Dana Smith 9 minutes ago">${link(3)}<div dir="auto">nice</div></div>${reply}</div>`;
  recordSend(db, { at: 1, sender: 'T', postId: '4', url: 'u', title: 't', bytes: 1, read: readPost(first), agoToTime, enrich });
  assert.equal(db.prepare("SELECT places FROM items WHERE key = 'c:2'").get().places, '[{"name":"Dana Passage"}]');
  recordSend(db, { at: 2, sender: 'T', postId: '4', url: 'u', title: 't', bytes: 1, read: readPost(later), agoToTime, enrich });
  assert.equal(db.prepare("SELECT places FROM items WHERE key = 'c:2'").get().places, '[]');
});

const pick = ({ added, changed, gone }) => ({ added, changed, gone });
