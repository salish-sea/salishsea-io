// Finds the names of places a text mentions, from the gazetteers the site's search uses
// (src/places.ts), so the demo can show whether a sighting could be put on the map. The
// reader of sighting text gives no position, so a name is the most a text yields today.
import { readFileSync } from 'node:fs';
import { PLACE_LISTS, placeHref, readPlaces } from '../../src/places.ts';

/** The ferry routes reporters name by one of their terminals (data/ferry-routes.tsv): {name, route, terminals}. */
export function readFerryRoutes(path = new URL('../../data/ferry-routes.tsv', import.meta.url)) {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const at = (c) => head.indexOf(c);
  return rows.map((r) => ({ name: r[at('name')], route: r[at('route')], terminals: r[at('terminals')].split('|') }));
}

/**
 * The small communities reporters name that the lists lack (data/reference/landmarks.tsv,
 * decision 119): its GNIS rows, at their own positions, found by name or by what reporters
 * call them (`says`). A row the review struck out (empty `says`) was a misreading, such as
 * Waldron for Waldron Island, and is left out. So is a name made only of a compass word and
 * a word for a kind of place: "South Beach" in a report is San Juan Island's beach more often
 * than the community on Bainbridge that GNIS lists. A community is found only after a word
 * that places something (placeFinder).
 */
export function readCommunities(path = new URL('../../data/reference/landmarks.tsv', import.meta.url)) {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const at = (c) => head.indexOf(c);
  const generic = /^(?:north|south|east|west)\s+(?:beach|point|bay|cove|harbor|harbour|spit|head|shore|side|end)$/i;
  return rows.filter((r) => r[at('source')] === 'gnis' && r[at('says')] && !generic.test(r[at('name')])).map((r) => ({
    community: true,
    name: r[at('name')], kind: r[at('kind')], lon: Number(r[at('lon')]), lat: Number(r[at('lat')]), zoom: 14,
    otherNames: r[at('says')] && r[at('says')] !== r[at('name')] ? [r[at('says')]] : [],
  }));
}

// A park's name without its generic words, as scripts/propose-landmarks.ts reads it: "Stamm"
// and "Stamm Overlook" for Stamm Overlook Park, "Carkeek" for Carkeek Park.
const PARK_GENERIC = /^(.+?) (?:(?:State|County|Beach|Waterfront|Marine|Overlook|Memorial|Regional|City) )?(?:Park|Preserve|Viewpoint|Overlook|Natural Area|Reserve)$/;
const PARK_LAST = /^(.+) (?:Park|Preserve|Viewpoint|Overlook|Natural Area|Reserve)$/;
// The generic words those leave, which are no park's short name: "Marine" for Marine Park would be "of Marine Mammals".
const PARK_WORDS = new Set(['state', 'county', 'beach', 'waterfront', 'marine', 'overlook', 'memorial', 'regional', 'city', 'park']);

/**
 * The shore parks reporters name (data/reference/landmarks.tsv's `parks` rows, decision 119),
 * placed by name and kind from the basemap's list of them (`parks`, a list as the basemap
 * publishes it), at each park of that name. What reporters call a park (`says`, such as
 * Constellation Park for Charles Richey Senior Viewpoint) is another of its names, and its
 * short forms are found when capitalised, after a word that places something: "from Stamm".
 * In lower case they misfire ("in Washington", "from the seawall", "photo by Lincoln"); a
 * lower-case form reporters use ("from stamm") belongs in data/abbreviations.tsv, confirmed.
 */
export function readParks(parks, path = new URL('../../data/reference/landmarks.tsv', import.meta.url)) {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const at = (c) => head.indexOf(c);
  const listed = readPlaces(parks);
  return rows.filter((r) => r[at('source')] === 'parks' && r[at('says')]).flatMap((r) => {
    const [name, kind, says] = [r[at('name')], r[at('kind')], r[at('says')]];
    const shortNames = [...new Set([name, says].flatMap((n) => [PARK_GENERIC.exec(n)?.[1], PARK_LAST.exec(n)?.[1]]).filter(Boolean))];
    return listed.filter((p) => p.name === name && p.kind === kind)
      .map((p) => ({ ...p, park: true, otherNames: [...p.otherNames, ...(says !== name ? [says] : [])], shortNames }));
  });
}

/** The place abbreviations a person has confirmed (data/abbreviations.tsv): {abbreviation, place, terminal}. */
export function readAbbreviations(path = new URL('../../data/abbreviations.tsv', import.meta.url)) {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const at = (c) => head.indexOf(c);
  return rows.filter((r) => ['place', 'ferry terminal'].includes(r[at('kind')]))
    .map((r) => ({ abbreviation: r[at('abbreviation')], place: r[at('place')], terminal: r[at('kind')] === 'ferry terminal' }));
}

// Words a sighting uses for something else: "Orcas" is the whales far more often than Orcas Island.
// Words that are left when "Island" or "Passage" is dropped but that a report uses as words:
// "from Boston Harbor" is not Harbor Island, "East of mid" is not East Passage.
const COMMON_WORDS = new Set(['harbor', 'harbour', 'sea', 'east', 'west', 'north', 'south', 'mid', 'middle', 'main', 'long', 'big', 'little',
  'sand', 'rock', 'center', 'centre', 'port', 'bay', 'point', 'head', 'river', 'lake', 'deer', 'bird', 'seal', 'orca', 'whale', 'sunset', 'twin', 'false']);

// Organisations whose names hold place-like words: "Puget Sound Express" is a whale-watching
// company (and a ferry terminal in OpenStreetMap), "Pacific Whale Watch Association" is not Pacific.
const ORGANISATIONS = ['Puget Sound Express', 'Pacific Whale Watch Association', 'Orca Network', 'Orca Behavior Institute', 'Center for Whale Research', 'Sound Action', 'Puget Sound Whale Watchers', 'Island Adventures', 'San Juan Safaris'];

const NOT_PLACES = new Set(['orca', 'orcas', 'whale', 'whales', 'humpback', 'humpbacks', 'gray', 'grey', 'minke', 'transient', 'transients', 'resident', 'residents']);

const words = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Loads the lists and returns a function from a text to the places it names. */
export async function loadPlaces(fetchImpl = fetch) {
  const get = async (url) => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  };
  const lists = await Promise.all(PLACE_LISTS.map(get));
  // The shore parks' list, which the site's search doesn't load, from the style the site uses.
  const style = JSON.parse(readFileSync(new URL('../../src/basemap-style.json', import.meta.url), 'utf8'));
  const parksUrl = style.metadata?.['salishsea:places']?.parks;
  const parks = parksUrl ? readParks(await get(parksUrl)) : [];
  return placeFinder([...lists.flatMap(readPlaces), ...readCommunities(), ...parks], readAbbreviations(), readFerryRoutes());
}

/** @param {import('../../src/places.ts').Place[]} places */
export function placeFinder(places, abbreviations = [], ferryRoutes = []) {
  const byName = new Map();
  for (const p of places) {
    for (const name of [p.name, ...p.otherNames]) {
      // Reporters drop the generic word: "Camano" for Camano Island, "Saratoga" for Saratoga Passage.
      // Only from a place's own name, never a ferry terminal's (its other names include whole
      // island names: "San Juan Island"), and never when what is left is an ordinary word.
      const short = name === p.name && p.kind !== 'ferry_terminal' ? /^(.+) (island|passage)$/i.exec(name)?.[1] : null;
      for (const key of [words(name), short && !COMMON_WORDS.has(words(short)) && words(short)]) {
        if (!key || NOT_PLACES.has(key)) continue;
        const list = byName.get(key) ?? [];
        if (!list.includes(p)) list.push(p);
        byName.set(key, list);
      }
    }
  }
  // A park's short forms ("stamm", "constellation"), where no listed place already has the name.
  const shortKeys = new Set();
  // "Alki" is Alki Point's, though only islands' and passages' short names are found: a park may not take it.
  const stems = new Set(places.filter((p) => !p.park).map((p) => words(p.name).split(' ').slice(0, -1).join(' ')).filter(Boolean));
  for (const p of places.filter((p) => p.park))
    for (const n of p.shortNames) {
      const key = words(n);
      if (NOT_PLACES.has(key) || COMMON_WORDS.has(key) || PARK_WORDS.has(key) || DIRECTION_WORDS.has(key) || stems.has(key) || (byName.has(key) && !shortKeys.has(key))) continue;
      const list = byName.get(key) ?? [];
      if (!list.includes(p)) list.push(p);
      byName.set(key, list);
      shortKeys.add(key);
    }
  const keys = [...byName.keys()].sort((a, b) => b.length - a.length);
  const parkName = (key) => !shortKeys.has(key) && !!byName.get(key)?.every((p) => p.park);
  // A ferry route as a line between its terminals, found among the places listed as ferry terminals.
  const terminal = (name) => places.find((p) => p.kind === 'ferry_terminal' && p.name === name);
  const routes = ferryRoutes.map((f) => ({ ...f, ends: f.terminals.map(terminal) })).filter((f) => f.ends.every(Boolean));

  // A listed name that an unknown one is a spelling of: the same word for a kind of place
  // ("Pt" is "Point"), and the words before it the same but for one letter added, dropped,
  // changed or swapped, in a name of five letters or more ("Harsteine Island", "Elliot Bay").
  // Only when exactly one listed name is that close.
  const byKind = Map.groupBy(places.filter((p) => / /.test(p.name) && !p.community && !p.park), (p) => kindWord(p.name));
  // A small community's name is often a person's ("Thanks Eldon!", "Victor saw them"), so it
  // counts only when capitalised and after a word that places something: "toward Eglon", "at Richmond beach".
  const community = (key) => !!byName.get(key)?.every((p) => p.community);
  const spelledAlike = (written) => {
    const kind = kindWord(written);
    const rest = words(written).split(' ').slice(0, -1).join(' ');
    const near = (byKind.get(kind) ?? []).filter((p) => {
      const r = words(p.name).split(' ').slice(0, -1).join(' ');
      return rest === r || (r.length >= 5 && withinOneEdit(rest, r));
    });
    const names = new Set(near.map((p) => p.name));
    return names.size === 1 ? near[0] : null;
  };

  return (text) => {
    const placed = (i) => /\p{Lu}/u.test(text[i]) && PLACING.test(text.slice(Math.max(0, i - 40), i));
    // Whether a listed name at this point of the text counts: a community's only where placed,
    // and so is a park's short form ("from Stamm").
    const counts = (key, i) => !(community(key) || shortKeys.has(key)) || placed(i);
    const hay = ` ${words(text)} `;
    const found = [];
    const taken = []; // [start, end) of each mention already accounted for
    const overlaps = (a, b) => taken.some(([s, e]) => a < e && s < b);
    // An organisation's name is not a place; hide it first.
    for (const o of ORGANISATIONS)
      for (const m of text.matchAll(new RegExp(`(?<![\\p{L}])${escape(o)}(?![\\p{L}])`, 'giu'))) taken.push([m.index, m.index + m[0].length]);
    const known = (p, where, extra = {}) => ({ name: p.name, kind: p.kind, lon: p.lon, lat: p.lat, href: placeHref(p), alike: where.length, ...extra });
    // "Kingston ferry" is the boat on the Edmonds–Kingston route, so somewhere along that
    // crossing, not the town; "Kingston ferry terminal" or "dock" is the terminal itself.
    for (const f of routes) {
      const re = new RegExp(`(?<![\\p{L}])${escape(f.name)}[ \\t]+ferr(?:y|ies)(?![ \\t]+(?:terminal|dock)(?![\\p{L}]))(?![\\p{L}])`, 'giu');
      const spans = [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]).filter(([a, b]) => !overlaps(a, b));
      if (!spans.length) continue;
      taken.push(...spans); // every mention, even of a route already found by its other terminal
      if (found.some((x) => x.route === f.route)) continue;
      const lon = f.ends.reduce((a, e) => a + e.lon, 0) / f.ends.length, lat = f.ends.reduce((a, e) => a + e.lat, 0) / f.ends.length;
      found.push({ key: `route:${f.route}`, name: `${f.route} ferry`, kind: 'ferry route', route: f.route, line: f.ends.map((e) => [e.lon, e.lat]),
        lon, lat, href: placeHref({ lon, lat, zoom: 11 }), alike: 1 });
    }
    // "Kingston Ferry Terminal" or "dock": the terminal, before it can look like an unknown name.
    for (const t of places.filter((p) => p.kind === 'ferry_terminal')) {
      const re = new RegExp(`(?<![\\p{L}])${escape(t.name)}[ \\t]+ferr(?:y|ies)[ \\t]+(?:terminal|dock)(?![\\p{L}])`, 'giu');
      const spans = [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]).filter(([a, b]) => !overlaps(a, b));
      if (!spans.length) continue;
      taken.push(...spans);
      const key = words(t.name);
      if (!found.some((x) => x.key === key)) found.push({ key, ...known(t, byName.get(key) ?? [t]) });
    }
    // A confirmed abbreviation, in capitals as written: "PNP" for Point No Point.
    // A code in capitals must be written so ("LPZ"); one with lower case is a phrase, in any case ("the hook").
    for (const { abbreviation, place, terminal } of abbreviations) {
      const where = byName.get(words(place));
      // A terminal's code means the terminal, not the town or island of its name.
      const p = terminal ? where?.find((x) => x.kind === 'ferry_terminal') : where?.[0];
      if (!p) continue;
      const flags = /\p{Ll}/u.test(abbreviation) ? 'giu' : 'gu';
      const spans = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escape(abbreviation)}(?![\\p{L}\\p{N}])`, flags))]
        .map((m) => [m.index, m.index + m[0].length]).filter(([a, b]) => !overlaps(a, b));
      if (!spans.length) continue;
      taken.push(...spans);
      if (!found.some((x) => x.key === words(place) && x.kind === p.kind)) found.push({ key: words(place), ...known(p, where, { abbreviation }) });
    }
    // A name the text gives that ends in a word for a kind of place ("Richmond Beach") but
    // that the gazetteers lack is shown as unknown, not as a shorter name inside it ("Richmond").
    for (const m of text.matchAll(NAMED_PLACE)) {
      const name = m[0].replace(/\s+/g, ' ').split(' ');
      // A known name at its end is the place, and the words before it are the sentence's:
      // "Hugging Camano Island", "North Pender Island". The known names are found below.
      const runAt = starts(m[0], name).map((o) => m.index + o);
      if (name.some((_, i) => byName.has(words(name.slice(i).join(' '))) && counts(words(name.slice(i).join(' ')), runAt[i]))) continue;
      // Nor is it unknown when it begins with a whole known name of a kind of place and the
      // rest only says where on it ("Dana Passage Mid Channel"); "Elliott Bay Marina" is another place.
      if (name.some((_, i) => i >= 1 && i < name.length - 1 && KIND_WORD.test(name[i]) && byName.has(words(name.slice(0, i + 1).join(' ')))
        && name.slice(i + 1).every((w) => WHERE_ON.has(w.toLowerCase())))) continue;
      if (overlaps(m.index, m.index + m[0].length)) continue; // a route or an abbreviation already found there
      // The listed name it may be: with its first words in lower case before the run ("port
      // Angeles harbor"), or a tail of the run after the sentence's words ("Hugging Camamo
      // Island"), and written a little differently ("Alki Pt", "Elliot Bay"). The longest wins.
      const before = text.slice(0, m.index).match(/(?:\p{L}+[ \t]+){1,2}$/u)?.[0] ?? '';
      const lower = before.trim().split(/\s+/).filter(Boolean);
      const lowerAt = starts(before, lower).map((o) => m.index - before.length + o);
      const tails = [...lower.map((_, i) => ({ said: [...lower.slice(i), ...name], at: lowerAt[i] })),
        ...name.slice(0, -1).map((_, j) => ({ said: name.slice(j), at: runAt[j] }))];
      let reading = null;
      for (const { said, at } of tails) {
        const w = said.join(' ');
        if (byName.has(words(w)) && counts(words(w), at)) { reading = 'listed'; break; } // found as a listed name below
        if (byName.has(words(w))) continue; // a community not placed: an unknown name, as before it was listed
        const alike = spelledAlike(w);
        if (alike) { reading = { alike, written: w, at }; break; }
      }
      if (reading === 'listed') continue;
      if (reading) {
        taken.push([reading.at, m.index + m[0].length]);
        const k = words(reading.alike.name);
        if (!found.some((f) => f.key === k)) found.push({ key: k, ...known(reading.alike, byName.get(k) ?? [reading.alike], { written: reading.written }) });
        continue;
      }
      // A capitalised word before an unknown name is often the start of a sentence: "Off Richmond Beach".
      let dropped = 0;
      while (name.length > 2 && LEADING.has(name[0].toLowerCase())) dropped += name.shift().length + 1;
      const written = name.join(' ');
      const key = words(written);
      taken.push([m.index + dropped, m.index + m[0].length]);
      if (found.some((f) => f.key === key)) continue;
      found.push({ key, name: written, unknown: true });
    }
    for (const key of keys) {
      if (!hay.includes(` ${key} `)) continue;
      // A mention counts unless a longer name already covers it ("Camano" in "Camano Head",
      // "Richmond" in "Richmond Beach"); another mention of it elsewhere in the text still counts.
      // One word must be capitalised in the text, as a name is: "Camano", not "point".
      const spans = [...text.matchAll(mentionOf(key))]
        // A park's full name is capitalised as written ("Marine Park", not "a marine park"); a short form after a placing word needn't be.
        .filter((m) => ((key.includes(' ') && !parkName(key)) || /\p{Lu}/u.test(m[0][0])) && counts(key, m.index)
          // and a short form followed by a capitalised word is part of a longer name: "Lions Gate".
          && !(shortKeys.has(key) && /^[ \t]+(?!(?:[NSEW]|NE|NW|SE|SW|NB|SB|EB|WB|NNE|NNW|SSE|SSW|ENE|ESE|WNW|WSW)\b)\p{Lu}/u.test(text.slice(m.index + m[0].length))))
        .map((m) => [m.index, m.index + m[0].length])
        .filter(([a, b]) => !overlaps(a, b));
      if (!spans.length) continue;
      taken.push(...spans); // a mention of a name already found still covers its shorter names ("Lopez" in "Lopez Island")
      const where = byName.get(key);
      // A name shown as unknown where it wasn't placed is known once a later mention places it.
      const had = found.findIndex((f) => f.key === key);
      if (had >= 0 && found[had].unknown) found[had] = { key, ...known(where[0], where) };
      if (had >= 0) continue;
      found.push({ key, ...known(where[0], where) });
    }
    // Known names first, in the order found; unknown ones after.
    return found.sort((a, b) => !!a.unknown - !!b.unknown).map(({ key, ...rest }) => rest);
  };
}

// The text's mentions of a name, as words() reads it: any punctuation between its words,
// and an apostrophe allowed inside one ("Smiths" is "Smith's").
function mentionOf(key) {
  const word = (w) => [...w].map(escape).join("['’]?");
  return new RegExp(`(?<![\\p{L}\\p{N}])${key.split(' ').map(word).join('[^\\p{L}\\p{N}\\n]+')}(?![\\p{L}\\p{N}])`, 'giu');
}

// One to three capitalised words, then a word for a kind of place: capitalised, or in lower
// case if it nearly always ends a name ("Boston harbor"), but not "ferry" or "dock", which
// often follow a town's name ("Clinton ferry").
const KINDS = 'Beach|Point|Pt|Bay|Park|Head|Harbor|Harbour|Island|Spit|Reef|Rocks?|Light|Lighthouse|Pass|Passage|Narrows|Cove|Inlet|Landing|Marina|Pier|Dock|Creek|River|Lagoon|Ferry|Terminal|Sound|Channel|Strait|Lake';
const LOWER_KINDS = 'beach|point|bay|head|harbor|harbour|island|spit|reef|passage|narrows|cove|inlet|lagoon|sound|channel|strait';
// A full stop ends a sentence, so it can't join two names ("Richmond Beach. Alki Point."),
// except in "St.".
// Nor can a line break: each line of a post is its own report.
const NAMED_PLACE = new RegExp(`(?<![\\p{L}])(?:(?:St\\.|\\p{Lu}[\\p{L}'’]*)[ \\t]+){1,3}(?:${KINDS}|${LOWER_KINDS})(?![\\p{L}])`, 'gu');

const LEADING = new Set(['off', 'at', 'near', 'in', 'on', 'from', 'by', 'of', 'the', 'to', 'past', 'around', 'toward', 'towards', 'between', 'just', 'north', 'south', 'east', 'west', 'heading', 'headed', 'passing', 'leaving', 'entering', 'inside', 'outside', 'and', 'still', 'now']);

// Words after a whole name that say where on it, not another place: "Dana Passage Mid Channel".
const WHERE_ON = new Set(['mid', 'middle', 'center', 'centre', 'channel', 'side', 'shore', 'end', 'north', 'south', 'east', 'west']);
// Where each of a string's words starts in it, taking them in order.
const starts = (str, ws) => { let o = 0; return ws.map((w) => (o = str.indexOf(w, o), o += w.length, o - w.length)); };
// A word that places what follows it, then perhaps "the", at the end of the text before a name.
// "And" places only in "between X and": "Thanks Pat and Eldon" names people.
const PLACING = /(?:^|[^\p{L}])(?:off|near|at|from|past|by|of|around|rounding|between|to|toward|towards|outside|passing|passed|abeam|in|into|across|between[ \t]+\S+(?:[ \t]+\S+){0,2}[ \t]+and)[ \t]+(?:the[ \t]+)?$/iu;
const DIRECTION_WORDS = new Set(['north', 'south', 'east', 'west', 'upper', 'lower', 'old', 'new']);
const KIND_WORD = new RegExp(`^(?:${KINDS})$`, 'i');
// The word for a kind of place that ends a name, as one spelling: "Pt" and "Pt." are "point".
const kindWord = (name) => { const w = words(name).split(' ').at(-1); return w === 'pt' ? 'point' : w === 'harbour' ? 'harbor' : w; };

/** Whether two words differ by one letter added, dropped, changed, or two neighbours swapped. */
export function withinOneEdit(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return a === b;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

