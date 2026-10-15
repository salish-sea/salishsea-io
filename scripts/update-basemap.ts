// Copies one published version of the basemap's style into src/basemap-style.json, which
// the map is drawn from with our own sources and layers on top (src/style.ts):
//   node scripts/update-basemap.ts 2026.10.3
// A published version never changes (salish-sea/basemap's decision 007), so the copy
// can't drift from what tiles.salishsea.io serves; moving to a new version is a run of
// this and a reviewed diff. The version is kept in the style's own metadata. It also
// writes the version's image tiles into the two places that stitch pictures from them.

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
style.metadata = { ...style.metadata, 'salishsea:basemap-version': version };
writeFileSync('src/basemap-style.json', JSON.stringify(style) + '\n');
console.log(`src/basemap-style.json is now version ${version}`);

// The pictures stitched from tiles use the version's image tiles (its decision 014): the
// profile maps and small maps, and the preview cards, each of which names them once.
const images = style.metadata['salishsea:images'];
if (typeof images !== 'string' || !/^https:\/\/tiles\.salishsea\.io\/images\/[0-9a-f]{16}\/\{z\}\/\{x\}\/\{y\}\.webp$/.test(images)) {
  console.error(`version ${version} names no image tiles`);
  process.exit(1);
}
for (const file of ['src/profile-map.ts', 'infra/lib/card-renderer/basemap.ts']) {
  const source = readFileSync(file, 'utf8');
  const updated = source.replace(/^export const IMAGE_TILES = '[^']*';$/m, `export const IMAGE_TILES = '${images}';`);
  if (updated === source && !source.includes(images)) {
    console.error(`${file} has no IMAGE_TILES line to update`);
    process.exit(1);
  }
  writeFileSync(file, updated);
}
console.log(`the pictures use ${images}`);
