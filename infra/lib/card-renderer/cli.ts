// Render a card to a file so it can be looked at without deploying anything.
//
//   node lib/card-renderer/cli.js point -123.09 48.61 out.jpg
//   node lib/card-renderer/cli.js occurrence 'inaturalist:375544838' out.jpg
//   node lib/card-renderer/cli.js day 2026-07-27 out.jpg
//
// `point` needs no credentials, which makes it the fastest way to eyeball the
// basemap and chrome. The other two read SUPABASE_URL / SUPABASE_ANON_KEY.

import { writeFileSync } from 'node:fs';
import { renderDayCard, renderOccurrenceCard } from './cards.js';
import { configFromEnv, fetchOccurrence, fetchOccurrencesBetween, type Occurrence } from './data.js';
import { pacificDayRange } from './pacific-day.js';

async function main(): Promise<number> {
  const [mode, ...rest] = process.argv.slice(2);

  if (mode === 'point') {
    const [lon, lat, out] = rest;
    if (!lon || !lat || !out) throw new Error('usage: point <lon> <lat> <out.jpg>');
    // Number('north') is NaN and Number('1e999') is Infinity; either reaches the
    // projection and fails somewhere far less legible than here.
    const [lonNum, latNum] = [Number(lon), Number(lat)];
    if (!Number.isFinite(lonNum) || !Number.isFinite(latNum)) {
      throw new Error(`lon/lat must be finite numbers, got "${lon}" "${lat}"`);
    }
    if (Math.abs(lonNum) > 180 || Math.abs(latNum) > 90) {
      throw new Error(`lon/lat out of range: ${lonNum}, ${latNum}`);
    }
    const synthetic: Occurrence = {
      id: 'synthetic',
      location: { lon: lonNum, lat: latNum },
      observedAt: new Date().toISOString(),
      species: 'Orca',
      count: 3,
    };
    writeFileSync(out, await renderOccurrenceCard(synthetic));
    console.log(`wrote ${out}`);
    return 0;
  }

  if (mode === 'occurrence') {
    const [id, out] = rest;
    if (!id || !out) throw new Error('usage: occurrence <id> <out.jpg>');
    const cfg = configFromEnv();
    const occ = await fetchOccurrence(cfg, id);
    if (!occ) throw new Error(`no occurrence ${id}`);
    writeFileSync(out, await renderOccurrenceCard(occ));
    console.log(`wrote ${out} (${occ.species}, ${occ.location?.lon}, ${occ.location?.lat})`);
    return 0;
  }

  if (mode === 'day') {
    const [date, out] = rest;
    if (!date || !out) throw new Error('usage: day <YYYY-MM-DD> <out.jpg>');
    const cfg = configFromEnv();
    const { startIso, endIso } = pacificDayRange(date);
    const occurrences = await fetchOccurrencesBetween(cfg, startIso, endIso);
    writeFileSync(out, await renderDayCard(occurrences, date));
    console.log(`wrote ${out} (${occurrences.length} occurrences fetched for ${date})`);
    return 0;
  }

  console.error('usage: cli.js point|occurrence|day ...');
  return 1;
}

main().then(
  code => process.exit(code),
  err => { console.error(String(err)); process.exit(1); },
);
