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

/** The place abbreviations a person has confirmed (data/abbreviations.tsv): {abbreviation, place}. */
export function readAbbreviations(path = new URL('../../data/abbreviations.tsv', import.meta.url)) {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const at = (c) => head.indexOf(c);
  return rows.filter((r) => r[at('kind')] === 'place').map((r) => ({ abbreviation: r[at('abbreviation')], place: r[at('place')] }));
}

// Words a sighting uses for something else: "Orcas" is the whales far more often than Orcas Island.
const NOT_PLACES = new Set(['orca', 'orcas', 'whale', 'whales', 'humpback', 'humpbacks', 'gray', 'grey', 'minke', 'transient', 'transients', 'resident', 'residents']);

const words = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Loads the lists and returns a function from a text to the places it names. */
export async function loadPlaces(fetchImpl = fetch) {
  const lists = await Promise.all(PLACE_LISTS.map(async (url) => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }));
  return placeFinder(lists.flatMap(readPlaces), readAbbreviations(), readFerryRoutes());
}

/** @param {import('../../src/places.ts').Place[]} places */
export function placeFinder(places, abbreviations = [], ferryRoutes = []) {
  const byName = new Map();
  for (const p of places) {
    for (const name of [p.name, ...p.otherNames]) {
      // Reporters drop the generic word: "Camano" for Camano Island, "Saratoga" for Saratoga Passage.
      const short = /^(.+) (island|passage)$/i.exec(name)?.[1];
      for (const key of [words(name), short && words(short)]) {
        if (!key || NOT_PLACES.has(key)) continue;
        const list = byName.get(key) ?? [];
        if (!list.includes(p)) list.push(p);
        byName.set(key, list);
      }
    }
  }
  const keys = [...byName.keys()].sort((a, b) => b.length - a.length);
  // A ferry route as a line between its terminals, found among the places listed as ferry terminals.
  const terminal = (name) => places.find((p) => p.kind === 'ferry_terminal' && p.name === name);
  const routes = ferryRoutes.map((f) => ({ ...f, ends: f.terminals.map(terminal) })).filter((f) => f.ends.every(Boolean));

  return (text) => {
    const hay = ` ${words(text)} `;
    const found = [];
    const taken = []; // [start, end) of each mention already accounted for
    const overlaps = (a, b) => taken.some(([s, e]) => a < e && s < b);
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
    for (const { abbreviation, place } of abbreviations) {
      const where = byName.get(words(place));
      if (!where) continue;
      const spans = [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escape(abbreviation)}(?![\\p{L}\\p{N}])`, 'gu'))].map((m) => [m.index, m.index + m[0].length]);
      if (!spans.length) continue;
      taken.push(...spans);
      found.push({ key: words(place), ...known(where[0], where, { abbreviation }) });
    }
    // A name the text gives that ends in a word for a kind of place ("Richmond Beach") but
    // that the gazetteers lack is shown as unknown, not as a shorter name inside it ("Richmond").
    for (const m of text.matchAll(NAMED_PLACE)) {
      const name = m[0].replace(/\s+/g, ' ').split(' ');
      // A known name at its end is the place, and the words before it are the sentence's:
      // "Hugging Camano Island", "North Pender Island". The known names are found below.
      if (name.some((_, i) => byName.has(words(name.slice(i).join(' '))))) continue;
      if (overlaps(m.index, m.index + m[0].length)) continue; // a route or an abbreviation already found there
      // A capitalised word before an unknown name is often the start of a sentence: "Off Richmond Beach".
      let dropped = 0;
      while (name.length > 2 && LEADING.has(name[0].toLowerCase())) dropped += name.shift().length + 1;
      taken.push([m.index + dropped, m.index + m[0].length]);
      const key = words(name.join(' '));
      if (found.some((f) => f.key === key)) continue;
      found.push({ key, name: name.join(' '), unknown: true });
    }
    for (const key of keys) {
      if (!hay.includes(` ${key} `)) continue;
      // A mention counts unless a longer name already covers it ("Camano" in "Camano Head",
      // "Richmond" in "Richmond Beach"); another mention of it elsewhere in the text still counts.
      // One word must be capitalised in the text, as a name is: "Camano", not "point".
      const spans = [...text.matchAll(mentionOf(key))]
        .filter((m) => key.includes(' ') || /\p{Lu}/u.test(m[0][0]))
        .map((m) => [m.index, m.index + m[0].length])
        .filter(([a, b]) => !overlaps(a, b));
      if (!spans.length || found.some((f) => f.key === key)) continue;
      taken.push(...spans);
      const where = byName.get(key);
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

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

