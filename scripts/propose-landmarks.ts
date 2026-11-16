/**
 * Proposes the landmarks a card may name (decision 100): the places on the basemap's lists
 * that reporters name, from a copy of the Maplify mirror, written over
 * data/reference/landmarks.tsv for a pull request to review.
 *
 *   node scripts/propose-landmarks.ts <maplify.sqlite> [<DomesticNames_WA.txt>]
 *
 * With GNIS's file of Washington's names, the small communities it records (populated
 * places) that the lists don't hold are proposed too, with their GNIS positions (decision 119).
 * The shore parks reporters name are proposed from the basemap's list of them, without
 * positions, by full name or by a short form after a word that places something.
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
const KINDS = {gazetteers: new Set(['point']), osm: new Set(['city', 'town', 'village', 'island', 'ferry_terminal']),
    parks: new Set(['park', 'nature_reserve', 'national_park'])};
const MENTION_KM = 15;
/** The last words a reporter drops: "off Lime Kiln", "near Vashon". */
const GENERIC = /^(.+) (Point|Head|Spit|Bluff|Island|Ferry Terminal)$/;
/** Words that are no park's short name: "East" for East Park would be every "off East Point". */
const DIRECTIONS = /^(?:North|South|East|West|Upper|Lower|Old|New)$/;
/** The generic words PARK_GENERIC leaves, which are no park's short name: "Marine" for Marine Park. */
const PARK_WORDS = /^(?:State|County|Beach|Waterfront|Marine|Overlook|Memorial|Regional|City|Park)$/;
/** A park's name without its generic words: "Stamm" for Stamm Overlook Park, "Carkeek" for Carkeek Park. */
const PARK_LAST = /^(.+) (?:Park|Preserve|Viewpoint|Overlook|Natural Area|Reserve)$/;
const PARK_GENERIC = /^(.+?) (?:(?:State|County|Beach|Waterfront|Marine|Overlook|Memorial|Regional|City) )?(?:Park|Preserve|Viewpoint|Overlook|Natural Area|Reserve)$/;
// In any case, as a sentence may start with one ("From Stamm"); the name after it keeps its own case.
const PLACING = String.raw`(?i:off|near|at|from|past|by|of|around|rounding|between|and|to|toward|towards|outside|passing|passed|abeam)\s+(?:the\s+)?`;
/** Directions written in capitals after a name, which don't make it part of a longer one: "from Stamm SE bound". */
const DIRECTION_ABBREVIATIONS = String.raw`(?:[NSEW]|NE|NW|SE|SW|NB|SB|EB|WB|NNE|NNW|SSE|SSW|ENE|ESE|WNW|WSW)\b`;

type Candidate = {source: 'gazetteers' | 'osm' | 'gnis' | 'parks', name: string, kind: string, lon: number, lat: number,
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

/**
 * A list's places as candidates. A park (decision 119) must not take another listed place's
 * mentions, so `listed` (listedNames of the other lists) rules out a park named as a listed
 * place is (a park called "Bush Point"), and a short form that is one ("Alki" for Alki Beach
 * Park is Alki Point); and a mention followed by a word that ends a place's name is that place's.
 */
/** The shore parks' list as candidates, for tests. */
export const parkCandidates = (list: PlaceList, listed: ReadonlySet<string>) => candidates(list, 'parks', listed);

function candidates(list: PlaceList, source: 'gazetteers' | 'osm' | 'parks', listed: ReadonlySet<string> = new Set()): Candidate[] {
    const i = (c: string) => list.columns.indexOf(c);
    const [name, kind, lon, lat, other] = [i('name'), i('kind'), i('lon'), i('lat'), i('other_names')];
    const park = source === 'parks';
    const after = park ? String.raw`(?![ \t]+(?i:${PLACE_WORDS})\b)` : '';
    // A short form followed by another capitalised word is part of a longer name: "Lions Gate", "Magnolia Marina".
    const shortAfter = park ? String.raw`${after}(?![ \t]+(?!${DIRECTION_ABBREVIATIONS})[A-Z])` : '';
    return list.places.filter(p => KINDS[source].has(p[kind] as string) && !(park && listed.has(p[name] as string))).map(p => {
        const names = [p[name] as string, ...((p[other] as string[] | undefined) ?? [])];
        // A park is also named without only its last word: "Stamm Overlook" as well as "Stamm".
        const short = names.flatMap(n => park ? [n.match(PARK_GENERIC)?.[1], n.match(PARK_LAST)?.[1]] : [n.match(GENERIC)?.[1]])
            .filter((n): n is string => !!n && !(park && (listed.has(n) || DIRECTIONS.test(n) || PARK_WORDS.test(n) || new RegExp(`^(?:${PLACE_WORDS})$`).test(n))));
        return {source, name: p[name] as string, kind: p[kind] as string, lon: p[lon] as number, lat: p[lat] as number,
            full: new RegExp(String.raw`(?<![\w])(?:${alternation(names.flatMap(n => fullForms(n, p[kind] as string)))})(?![\w])${after}`, 'g'),
            short: short.length ? new RegExp(String.raw`\b${PLACING}(${alternation(short)})(?![\w])${shortAfter}`, 'g') : null};
    });
}

/** The Salish Sea region the basemap's lists cover (its decision 018). */
const REGION = {west: -126, east: -122, south: 47, north: 50.5};

/** The words that end a place's name; a community's name followed by one is that place ("Saratoga Passage"). */
const PLACE_WORDS = 'Island|Islands|Passage|Pass|Point|Pt|Sound|Head|Bay|Harbor|Inlet|Spit|Waterway|Channel|Strait|Lake|River|Creek|Lagoon|Cove|Narrows|Reach|Rocks?|Light|Lighthouse|Ferry|State Park|Park|Beach';

/** The names a community may not have: each listed name, and each without its last word ("Camano" for Camano Island). */
export function listedNames(names: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const n of names) {
        out.add(n);
        const short = n.match(new RegExp(`^(.+) (?:${PLACE_WORDS})$`))?.[1];
        if (short) out.add(short);
    }
    return out;
}

/**
 * GNIS's populated places in the region whose names the lists don't already give, as
 * candidates of kind `community`: Richmond Beach, Boston Harbor, Eglon. GNIS is in the
 * public domain, so the rows carry its positions (decision 119). `taken` is listedNames'
 * result: a community named as an island is, such as Camano, would take that island's
 * mentions. A mention followed by a word that ends a place's name is another place's.
 */
export function gnisCandidates(text: string, taken: ReadonlySet<string>): Candidate[] {
    const [head, ...lines] = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map(l => l.split('|'));
    const at = (c: string) => {
        const i = head!.indexOf(c);
        if (i < 0) throw new Error(`GNIS file has no ${c} column`);
        return i;
    };
    const [name, cls, lon, lat] = [at('feature_name'), at('feature_class'), at('prim_long_dec'), at('prim_lat_dec')];
    // A community named only by such a word ("Beach", "Cove") would match every beach and cove.
    const placeWord = new RegExp(`^(?:${PLACE_WORDS})$`);
    return lines.filter(l => l[cls] === 'Populated Place' && !taken.has(l[name]!) && !placeWord.test(l[name]!))
        .map(l => ({name: l[name]!, lon: Number(l[lon]), lat: Number(l[lat])}))
        .filter(p => p.lon >= REGION.west && p.lon <= REGION.east && p.lat >= REGION.south && p.lat <= REGION.north)
        .map(p => ({source: 'gnis' as const, name: p.name, kind: 'community', lon: p.lon, lat: p.lat,
            full: new RegExp(String.raw`(?<![\w])${escape(p.name)}(?![\w])(?![ \t]+(?i:${PLACE_WORDS})\b)`, 'g'), short: null}));
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

async function list(key: 'gazetteers' | 'osm' | 'parks'): Promise<PlaceList> {
    const {url} = placeListUrl(JSON.parse(readFileSync(STYLE, 'utf8')), key);
    const response = await fetch(url, {signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return await response.json() as PlaceList;
}

// A row with a position is known by it; one placed from a list by name (osm, parks) by its name and kind.
const rowKey = (r: {source: string, kind: string, name: string, lon: number | null, lat: number | null}) =>
    r.source === 'gazetteers' || r.source === 'gnis' ? `${r.source}\t${r.kind}\t${r.name}\t${r.lon}\t${r.lat}` : `${r.source}\t${r.kind}\t${r.name}`;

/** What a card writes for a proposed place: its name, and a ferry landing by its town's. */
export const says = (name: string, kind: string) => kind === 'ferry_terminal' ? name.replace(/ Ferry Terminal$/, '') : name;

if (import.meta.main) {
    const [mirror, gnis] = process.argv.slice(2);
    if (!mirror) {
        console.error('usage: propose-landmarks.ts <maplify.sqlite> [<DomesticNames_WA.txt>]');
        process.exit(2);
    }
    const [gazetteers, osm, parks] = [await list('gazetteers'), await list('osm'), await list('parks')];
    const listed = listedNames([gazetteers, osm].flatMap(l => l.places.map(p => p[l.columns.indexOf('name')] as string)));
    const communities = gnis ? gnisCandidates(readFileSync(gnis, 'utf8'), listed) : [];
    // A park's short form may not be a small community's name either: "Glendale" is the community, not Glendale Beach Preserve.
    const notParks = new Set([...listed, ...communities.map(c => c.name)]);
    const all = [...candidates(gazetteers, 'gazetteers'), ...candidates(osm, 'osm'), ...candidates(parks, 'parks', notParks), ...communities];
    const db = new DatabaseSync(mirror, {readOnly: true});
    const reports = db.prepare(`SELECT lon, lat, comments FROM sightings WHERE comments IS NOT NULL AND comments != '' AND is_test = 0`)
        .all() as {lon: number, lat: number, comments: string}[];
    // An OpenStreetMap row stands for every place of its name and kind, so a report counts
    // once for the row however many of them it names.
    const proposed = new Map<string, LandmarkRow>();
    for (const c of all) {
        const row: LandmarkRow = {name: c.name, kind: c.kind, source: c.source,
            lon: c.source === 'gazetteers' || c.source === 'gnis' ? c.lon : null, lat: c.source === 'gazetteers' || c.source === 'gnis' ? c.lat : null,
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
