// Copies one published version of the basemap's style into src/basemap-style.json, which
// the map is drawn from with our own sources and layers on top (src/style.ts):
//   node scripts/update-basemap.ts 2026.10.3
// A published version never changes (salish-sea/basemap's decision 007), so the copy
// can't drift from what tiles.salishsea.io serves; moving to a new version is a run of
// this and a reviewed diff. The version is kept in the style's own metadata. It also
// writes the version's image tiles into the two places that stitch pictures from them,
// and its lists of place names into the search (src/places.ts).

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d{4}\.(0[1-9]|1[0-2])\.[1-9]\d*$/.test(version)) {
  console.error('usage: node scripts/update-basemap.ts YYYY.MM.N');
  process.exit(2);
}
const url = `https://tiles.salishsea.io/${version}/style.json`;
const response = await fetch(url);
if (!response.ok) {
  console.error(`${url} answered ${response.status}`);
  process.exit(1);
}
const style = await response.json();
// The pictures stitched from tiles use the version's image tiles (its decision 014): the
// profile maps and small maps, and the preview cards, each of which names them once. A
// version without them is refused before anything is written.
const images: unknown = style.metadata?.['salishsea:images'];
if (typeof images !== 'string' || !/^https:\/\/tiles\.salishsea\.io\/images\/[0-9a-f]{16}\/\{z\}\/\{x\}\/\{y\}\.webp$/.test(images)) {
  console.error(`version ${version} names no image tiles`);
  process.exit(1);
}
// The search finds the places the map labels, from the version's lists (its decision 018).
const places: unknown = style.metadata?.['salishsea:places'];
const PLACE_LIST = /^https:\/\/tiles\.salishsea\.io\/places\/places-[a-z]+-[0-9a-f]{16}\.json$/;
if (!Array.isArray(places) || !places.length || !places.every((url) => typeof url === 'string' && PLACE_LIST.test(url))) {
  console.error(`version ${version} names no lists of places`);
  process.exit(1);
}
style.metadata = { ...style.metadata, 'salishsea:basemap-version': version };
/** A file with its one `export const <name>…= <value>;` line set to the value, or an exit if it has none. */
const rewrite = (file: string, name: string, value: string) => {
  const source = readFileSync(file, 'utf8');
  const line = new RegExp(`^(export const ${name}(?::[^=]*)?) = .*;$`, 'm');
  if (!line.test(source)) {
    console.error(`${file} has no ${name} line to update`);
    process.exit(1);
  }
  return [file, source.replace(line, (_, start: string) => `${start} = ${value};`)] as const;
};
const updates = [
  ...['src/profile-map.ts', 'infra/lib/card-renderer/basemap.ts'].map((file) => rewrite(file, 'IMAGE_TILES', `'${images}'`)),
  rewrite('src/places.ts', 'PLACE_LISTS', JSON.stringify(places).replaceAll('"', "'").replaceAll(',', ', ')),
];
writeFileSync('src/basemap-style.json', JSON.stringify(style) + '\n');
for (const [file, updated] of updates) writeFileSync(file, updated);
console.log(`src/basemap-style.json is now version ${version}; the pictures use ${images}; the search, ${places.length} lists of places`);
