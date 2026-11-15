// Finds the names of places a text mentions, from the gazetteers the site's search uses
// (src/places.ts), so the demo can show whether a sighting could be put on the map. The
// reader of sighting text gives no position, so a name is the most a text yields today.
import { PLACE_LISTS, placeHref, readPlaces } from '../../src/places.ts';

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
  return placeFinder(lists.flatMap(readPlaces));
}

/** @param {import('../../src/places.ts').Place[]} places */
export function placeFinder(places) {
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

  return (text) => {
    const hay = ` ${words(text)} `;
    const found = [];
    // A name the text gives that ends in a word for a kind of place ("Richmond Beach") but
    // that the gazetteers lack is shown as unknown, not as a shorter name inside it ("Richmond").
    for (const m of text.matchAll(NAMED_PLACE)) {
      // A capitalised word before the name is often the start of a sentence: "Off Alki Point".
      const name = m[0].replace(/\s+/g, ' ').split(' ');
      while (name.length > 2 && LEADING.has(name[0].toLowerCase())) name.shift();
      const key = words(name.join(' '));
      if (byName.has(key) || found.some((f) => f.key === key)) continue;
      found.push({ key, name: name.join(' '), unknown: true });
    }
    for (const key of keys) {
      if (!hay.includes(` ${key} `)) continue;
      // One word must be capitalised in the text, as a name is: "Camano", not "point".
      if (!key.includes(' ') && !capitalised(text, key)) continue;
      // A name inside a longer one already found ("Camano" in "Camano Head") is the same mention.
      if (found.some((f) => ` ${f.key} `.includes(` ${key} `))) continue;
      const where = byName.get(key);
      const p = where[0];
      found.push({ key, name: p.name, kind: p.kind, lon: p.lon, lat: p.lat, href: placeHref(p), alike: where.length });
    }
    // Known names first, in the order found; unknown ones after.
    return found.sort((a, b) => !!a.unknown - !!b.unknown).map(({ key, ...rest }) => rest);
  };
}

// One to three capitalised words, then a capitalised word for a kind of place.
const KINDS = 'Beach|Point|Pt|Bay|Park|Head|Harbor|Harbour|Island|Spit|Reef|Rocks?|Light|Lighthouse|Pass|Passage|Narrows|Cove|Inlet|Landing|Marina|Pier|Dock|Creek|River|Lagoon|Ferry|Terminal|Sound|Channel|Strait|Lake';
const NAMED_PLACE = new RegExp(`(?<![\\p{L}])(?:\\p{Lu}[\\p{L}'’.]*\\s+){1,3}(?:${KINDS})(?![\\p{L}])`, 'gu');

const LEADING = new Set(['off', 'at', 'near', 'in', 'on', 'from', 'by', 'of', 'the', 'to', 'past', 'around', 'toward', 'towards', 'between', 'just', 'north', 'south', 'east', 'west', 'heading', 'headed', 'passing', 'leaving', 'entering', 'inside', 'outside', 'and', 'still', 'now']);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function capitalised(text, key) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(key)}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(re)) if (/\p{Lu}/u.test(m[0][0])) return true;
  return false;
}
