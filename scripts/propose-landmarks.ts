/**
 * Proposes the landmarks a card may name (decision 100): the places on the basemap's lists
 * that reporters name, from a copy of the Maplify mirror, written over
 * data/reference/landmarks.tsv for a pull request to review.
 *
 *   node scripts/propose-landmarks.ts <maplify.sqlite>
 *
 * A place is proposed once a report within 15 km of it names it. Names are matched as
 * written, in capitals, after the reporter's own name in parentheses is taken out, so that
 * "(Sandy Smith)" doesn't count for Sandy Point. A name also counts as "Pt" for "Point",
 * and a ferry landing without "Ferry Terminal". A name shortened by its last word, such as
 * "Lime Kiln" for Lime Kiln Point or "Vashon" for Vashon Island, counts only after a word
 * that places something ("off Lime Kiln", "between Alki and Restoration").
 *
 * A refresh keeps every row the file has: it adds new places and updates the counts, and
 * keeps each row's `says`, which the review may have changed. A row whose `says` is empty
 * is never a landmark, so striking a name out is emptying its `says`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { placeListUrl } from './read-path/fetch-water-regions.ts';
import { LANDMARK_COLUMNS, parseLandmarks, type LandmarkRow, type PlaceList } from './read-path/landmarks.ts';

const STYLE = new URL('../src/basemap-style.json', import.meta.url);
const OUT = new URL('../data/reference/landmarks.tsv', import.meta.url);

/** The kinds that can be a landmark, by list: places on land, not the water's own names. */
const KINDS = {gazetteers: new Set(['point']), osm: new Set(['city', 'town', 'village', 'island', 'ferry_terminal'])};
const MENTION_KM = 15;
/** The last words a reporter drops: "off Lime Kiln", "near Vashon". */
const GENERIC = /^(.+) (Point|Head|Spit|Bluff|Island|Ferry Terminal)$/;
const PLACING = String.raw`(?:off|near|at|from|past|by|of|around|rounding|between|and|to|toward|towards|outside|passing|passed|abeam)\s+(?:the\s+)?`;

type Candidate = {source: 'gazetteers' | 'osm', name: string, kind: string, lon: number, lat: number,
    full: RegExp, short: RegExp | null};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternation = (names: Iterable<string>) => [...new Set(names)].sort((a, b) => b.length - a.length).map(escape).join('|');

/** Every way a report writes the name in full. */
export function fullForms(name: string, kind: string): string[] {
    const forms = [name, name.replace(/^Point /, 'Pt '), name.replace(/^Point /, 'Pt. '),
        name.replace(/ Point$/, ' Pt'), name.replace(/ Point$/, ' Pt.')];
    if (kind === 'ferry_terminal') forms.push(name.replace(/ Ferry Terminal$/, ''));
    return forms;
}

function candidates(list: PlaceList, source: 'gazetteers' | 'osm'): Candidate[] {
    const i = (c: string) => list.columns.indexOf(c);
    const [name, kind, lon, lat, other] = [i('name'), i('kind'), i('lon'), i('lat'), i('other_names')];
    return list.places.filter(p => KINDS[source].has(p[kind] as string)).map(p => {
        const names = [p[name] as string, ...((p[other] as string[] | undefined) ?? [])];
        const short = names.map(n => n.match(GENERIC)?.[1]).filter((n): n is string => !!n);
        return {source, name: p[name] as string, kind: p[kind] as string, lon: p[lon] as number, lat: p[lat] as number,
            full: new RegExp(String.raw`(?<![\w])(?:${alternation(names.flatMap(n => fullForms(n, p[kind] as string)))})(?![\w])`, 'g'),
            short: short.length ? new RegExp(String.raw`\b${PLACING}(${alternation(short)})(?![\w])`, 'g') : null};
    });
}

function km(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const kx = 111.2 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 111.2);
}

/** A report's text as names are matched in it: no markup, and no reporter's name in parentheses. */
export function reportText(comments: string): string {
    return comments.replace(/<br\s*\/?>/gi, ' ').replace(/\([^)]*\)/g, ' ');
}

/** The places a report names, a name inside a longer one ("No Point" in "Point No Point") not counting. */
export function named(text: string, near: readonly Candidate[]): Candidate[] {
    const spans: [Candidate, number, number][] = [];
    for (const c of near) {
        for (const m of text.matchAll(c.full)) spans.push([c, m.index, m.index + m[0].length]);
        if (c.short) for (const m of text.matchAll(c.short)) {
            const start = m.index + m[0].length - m[1]!.length;
            spans.push([c, start, start + m[1]!.length]);
        }
    }
    const inside = ([, s, e]: [Candidate, number, number]) =>
        spans.some(([, s2, e2]) => s2 <= s && e <= e2 && e2 - s2 > e - s);
    return [...new Set(spans.filter(span => !inside(span)).map(([c]) => c))];
}

async function list(key: 'gazetteers' | 'osm'): Promise<PlaceList> {
    const {url} = placeListUrl(JSON.parse(readFileSync(STYLE, 'utf8')), key);
    const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return await response.json() as PlaceList;
}

const rowKey = (r: {source: string, kind: string, name: string, lon: number | null, lat: number | null}) =>
    r.source === 'gazetteers' ? `${r.source}\t${r.kind}\t${r.name}\t${r.lon}\t${r.lat}` : `${r.source}\t${r.kind}\t${r.name}`;

/** What a card writes for a proposed place: its name, and a ferry landing by its town's. */
export const says = (name: string, kind: string) => kind === 'ferry_terminal' ? name.replace(/ Ferry Terminal$/, '') : name;

if (import.meta.main) {
    const [mirror] = process.argv.slice(2);
    if (!mirror) {
        console.error('usage: propose-landmarks.ts <maplify.sqlite>');
        process.exit(2);
    }
    const all = [...candidates(await list('gazetteers'), 'gazetteers'), ...candidates(await list('osm'), 'osm')];
    const db = new DatabaseSync(mirror, {readOnly: true});
    const reports = db.prepare(`SELECT lon, lat, comments FROM sightings WHERE comments IS NOT NULL AND comments != '' AND is_test = 0`)
        .all() as {lon: number, lat: number, comments: string}[];
    // An OpenStreetMap row stands for every place of its name and kind, so a report counts
    // once for the row however many of them it names.
    const proposed = new Map<string, LandmarkRow>();
    for (const c of all) {
        const row: LandmarkRow = {name: c.name, kind: c.kind, source: c.source,
            lon: c.source === 'gazetteers' ? c.lon : null, lat: c.source === 'gazetteers' ? c.lat : null,
            reports: 0, says: says(c.name, c.kind)};
        if (!proposed.has(rowKey(row))) proposed.set(rowKey(row), row);
    }
    for (const {lon, lat, comments} of reports) {
        const near = all.filter(c => km(lon, lat, c.lon, c.lat) <= MENTION_KM);
        if (!near.length) continue;
        for (const key of new Set(named(reportText(comments), near).map(rowKey))) proposed.get(key)!.reports++;
    }
    for (const [key, row] of proposed) if (row.reports === 0) proposed.delete(key);
    let existing: LandmarkRow[] = [];
    try { existing = parseLandmarks(readFileSync(OUT, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const rows = new Map(existing.map(r => [rowKey(r), r]));
    let added = 0;
    for (const [key, row] of proposed) {
        const had = rows.get(key);
        if (had) had.reports = row.reports;
        else { rows.set(key, row); added++; }
    }
    const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source) || (a.lat ?? 0) - (b.lat ?? 0));
    const cell = (v: string | number | null) => v === null ? '' : String(v);
    writeFileSync(OUT, [LANDMARK_COLUMNS.join('\t'),
        ...sorted.map(r => [r.name, r.kind, r.source, r.lon, r.lat, r.reports, r.says].map(cell).join('\t'))].join('\n') + '\n');
    console.log(`${reports.length} reports; ${proposed.size} places named, ${added} new; ${rows.size} rows written`);
}
