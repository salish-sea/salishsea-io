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
    return found.map(({ key, ...rest }) => rest);
  };
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function capitalised(text, key) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(key)}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(re)) if (/\p{Lu}/u.test(m[0][0])) return true;
  return false;
}
