/**
 * Measures a draft vocabulary of behaviour tags (bd salish-2ua9) against a year of
 * published reports and against the gold set's hand-read behaviour phrases.
 *
 *   node scripts/gold/behaviour.ts <dir of day files>            # counts by tag and kind
 *   node scripts/gold/behaviour.ts <dir> --examples <tag> [n]     # n random reports a tag matched
 *   node scripts/gold/behaviour.ts <dir> --gold                   # agreement with the gold set
 *
 * The day files are the site's own (`/read-path/days/<date>.json`). The vocabulary is a
 * draft for curation, not the reader: decision record to follow.
 */
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { reportText } from '../../src/sighting-text.ts';

/** A tag, the phrases that say it, and whether it bears on predicting where animals go next. */
type Tag = {tag: string, movement: string | null, phrases: [name: string, pattern: RegExp][]};

export const VOCABULARY: Tag[] = [
    {tag: 'milling', movement: 'staying in one area', phrases: [
        ['milling', /\bmill(?:ing|ed|s)?\b/i],
        ['stalled', /\bstall(?:ed|ing)\b/i],
        ['hanging around', /\bhang(?:ing)? (?:out|around)\b/i],
        ['circling', /\bcircl(?:ing|ed)\b/i],
        ['shuffling', /\bshuffl(?:ing|ed)\b/i],
    ]},
    {tag: 'resting', movement: 'staying in one area, slowly', phrases: [
        ['resting', /\brest(?:ing|ed)\b/i],
        ['logging', /\blogging\b/i],
        ['sleeping', /\bsleep(?:ing)?\b/i],
    ]},
    {tag: 'foraging', movement: 'staying in one area', phrases: [
        ['foraging', /\bforag\w*/i],
        ['feeding', /\bfeed(?:ing|s)?\b/i],
        ['hunting', /\bhunt(?:ing|ed|s)?\b/i],
        ['a kill', /\b(?:kill|predation)\b/i],
        ['attacking', /\battack\w*/i],
        ['eating', /\beat(?:ing|s)?\b/i],
        // Not "fishing": as often the observer as the animal ("fishing for salmon from my kayak").
        ['lunge feeding', /\blung(?:e|ing)\b/i],
        ['bubble net', /\bbubble[- ]?net\w*/i],
        ['chasing', /\bchas(?:e|ing|ed)\b/i],
    ]},
    // Not "travelling": it nearly always comes with a heading ("traveling SB"), which
    // the direction already carries, or means company ("traveling with T124A2").
    {tag: 'travelling', movement: 'keeping a heading', phrases: [
        ['steady', /\bstead(?:y|ily)\b/i],
        ['on a mission', /\bon a mission\b/i],
        ['straight line', /\bstraight (?:line|path|course)\b/i],
    ]},
    {tag: 'fast', movement: 'covering ground quickly', phrases: [
        ['quickly', /\bquick(?:ly)?\b/i],
        ['fast', /\bfast\b(?! ferry)/i],
        ['rapidly', /\brapid(?:ly)?\b/i],
        ['porpoising', /\bporpoising\b/i],
        ['at speed', /\b(?:at|high|good) speed\b/i],
    ]},
    {tag: 'slow', movement: 'covering little ground', phrases: [
        ['slowly', /\bslow(?:ly|ed|ing)?\b/i],
        ['meandering', /\bmeander\w*/i],
        ['lazily', /\blaz(?:y|ily)\b/i],
    ]},
    {tag: 'directional changes', movement: 'heading unreliable', phrases: [
        ['directional changes', /\bdirection(?:al)? changes?\b/i],
        ['changed direction', /\bchang(?:e|ed|ing|es) (?:of )?direction\b/i],
        ['turned around', /\bturn(?:ed|ing)? (?:around|back)\b/i],
        ['flipped', /\bflip(?:ped|ping)?\b/i],
        ['back and forth', /\bback and forth\b/i],
        // Lower case only: Zig Zag is a humpback, BCX1193.
        ['zigzag', /\bzig[- ]?zag\w*/],
    ]},
    {tag: 'spread out', movement: 'the group covers a wide area', phrases: [
        ['spread', /\bspread\b/i],
        ['scattered', /\bscatter\w*/i],
        ['strung out', /\bstrung out\b/i],
        ['several groups', /\b(?:two|2|three|3|several|multiple|few|many) (?:sub-?)?groups\b/i],
        ['split up', /\bsplit (?:up|into)\b/i],
    ]},
    {tag: 'grouped up', movement: 'the group covers a small area', phrases: [
        // "Loosely grouped" is neither tight nor spread, and is left out of both.
        ['grouped', /\bgroup(?:ed|ing) ?up\b|(?<!loosely )\bgrouped\b/i],
        ['tight group', /\btight(?:ly)?\b/i],
        ['together', /\b(?:travel(?:l)?ing|close|all|swimming|tight(?:ly)?) together\b/i],
        ['bunched', /\bbunch(?:ed)? up\b|\bbunched\b/i],
        ['resting line', /\bresting line\b/i],
    ]},
    {tag: 'long dives', movement: 'lost from view for minutes', phrases: [
        ['long down times', /\blong ?down ?times?\b|\blong downtimes?\b/i],
        ['long dives', /\b(?:long|deep) dives?\b/i],
        ['sounded', /\bsound(?:ed|ing)\b(?! like)/i],
        ['fluked', /\bfluk(?:ed|ing)\b|\bfluke[sd]? up\b/],
    ]},
    {tag: 'surface active', movement: null, phrases: [
        ['surface active', /\bsurface[- ]activ\w*/i],
        ['breaching', /\bbreach\w*/i],
        ['tail slapping', /\btail[- ]?(?:slap|lob)\w*|\blob[- ]?tail\w*/i],
        ['pec slapping', /\bpec(?:toral)?[- ]?(?:fin )?slap\w*/i],
        ['spyhopping', /\bspy[- ]?hop\w*/i],
        ['playing', /\bplay(?:ing|ful)\b/i],
        ['rolling', /\brolling\b/i],
    ]},
    {tag: 'hauled out', movement: 'ashore', phrases: [
        ['hauled out', /\bhaul(?:ed|ing)? ?out\b/i],
    ]},
];

/**
 * A phrase is not the behaviour now when the words just before it say it is over or
 * didn't happen: "southbound after feeding" is travelling, "no surface activity" is none.
 */
const NOT_NOW = /\b(?:after|finished|done|no|not|without|never)\b[^.,;!?]{0,15}$/i;

/** The tags a text says, and which phrase said each. */
export function readBehaviour(text: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const {tag, phrases} of VOCABULARY) {
        for (const [name, pattern] of phrases) {
            const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
            if ([...text.matchAll(global)].some(m => !NOT_NOW.test(text.slice(0, m.index)))) { found.set(tag, name); break; }
        }
    }
    return found;
}

type Occurrence = {
    id: string, body: string | null, provider_slug: string, pods: string[],
    identifiers: string[], taxon: {vernacular_name: string} | null,
};

/** The kind of animal a vocabulary is curated for: an orca's ecotype when its codes or pods say it. */
export function kindOf(o: Pick<Occurrence, 'taxon' | 'pods' | 'identifiers'>): string {
    const name = o.taxon?.vernacular_name ?? 'unknown';
    if (/killer whale/i.test(name)) {
        if (/southern|resident/i.test(name) || o.pods.length || o.identifiers.some(c => /^[JKL]\d|^[JKL]s?$/.test(c))) return 'Southern Resident';
        if (/bigg/i.test(name) || o.identifiers.some(c => /^T\d/.test(c))) return "Bigg's";
        return 'orca, ecotype not said';
    }
    if (/humpback/i.test(name)) return 'humpback';
    if (/gray|grey/i.test(name)) return 'gray whale';
    if (/seal|sea lion|pinniped/i.test(name)) return 'pinniped';
    return 'other';
}

const KINDS = ['Southern Resident', "Bigg's", 'orca, ecotype not said', 'humpback', 'gray whale', 'pinniped', 'other'];

function load(dir: string): (Occurrence & {text: string, kind: string})[] {
    return readdirSync(dir).filter(f => f.endsWith('.json')).sort()
        .flatMap(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as Occurrence[])
        .filter(o => o.body)
        .map(o => ({...o, text: reportText(o.body!), kind: kindOf(o)}))
        .filter(o => o.text);
}

/** A seeded shuffle, so a list of examples is the same on every run. */
function sample<T>(xs: T[], n: number, seed = 1): T[] {
    const a = [...xs];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) % 2 ** 31;
        const j = s % (i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a.slice(0, n);
}

function counts(dir: string) {
    const reports = load(dir);
    const perKind = new Map(KINDS.map(k => [k, reports.filter(r => r.kind === k).length]));
    console.log(`${reports.length} reports with text\n`);
    console.log(['tag', ...KINDS.map(k => `${k} (${perKind.get(k)})`), 'phrases'].join('\t'));
    for (const {tag} of VOCABULARY) {
        const hits = reports.map(r => ({r, phrase: readBehaviour(r.text).get(tag)})).filter(x => x.phrase);
        const byKind = KINDS.map(k => hits.filter(h => h.r.kind === k).length);
        const phrases = new Map<string, number>();
        for (const h of hits) phrases.set(h.phrase!, (phrases.get(h.phrase!) ?? 0) + 1);
        console.log([tag, ...byKind, [...phrases].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(', ')].join('\t'));
    }
    const any = reports.filter(r => readBehaviour(r.text).size);
    const moving = reports.filter(r => [...readBehaviour(r.text).keys()].some(t => VOCABULARY.find(v => v.tag === t)!.movement));
    console.log(`\nany tag: ${any.length}; a tag bearing on movement: ${moving.length}`);
    for (const k of KINDS) {
        const n = perKind.get(k)!;
        const m = moving.filter(r => r.kind === k).length;
        console.log(`  ${k}: ${m} of ${n} (${Math.round(100 * m / n)}%)`);
    }
}

function examples(dir: string, tag: string, n: number) {
    const hits = load(dir).filter(r => readBehaviour(r.text).has(tag));
    for (const r of sample(hits, n)) {
        console.log(`[${r.kind}] (${readBehaviour(r.text).get(tag)}) ${r.text.slice(0, 300)}`);
    }
}

type GoldRow = {row: number, text: string, behaviour: string[], maplify_name: string, ecotype: string | null};

function gold() {
    const rows = JSON.parse(readFileSync(new URL('../read-path/fixtures/gold/sighting-text.json', import.meta.url), 'utf8')) as GoldRow[];
    const unmapped = new Map<string, number>();
    let agree = 0, extra = 0, missing = 0;
    for (const r of rows) {
        // What the labeller saw, put through the vocabulary, against what the reader finds in the text.
        const labelled = new Set(r.behaviour.flatMap(p => [...readBehaviour(p).keys()]));
        const read = new Set(readBehaviour(r.text).keys());
        for (const p of r.behaviour) if (!readBehaviour(p).size) unmapped.set(p, (unmapped.get(p) ?? 0) + 1);
        const plus = [...read].filter(t => !labelled.has(t));
        const minus = [...labelled].filter(t => !read.has(t));
        if (!plus.length && !minus.length) agree++;
        if (plus.length) { extra++; console.log(`row ${r.row}: read but not labelled ${plus.join(', ')}: ${r.text.slice(0, 200)}`); }
        if (minus.length) { missing++; console.log(`row ${r.row}: labelled but not read ${minus.join(', ')}: ${r.text.slice(0, 200)}`); }
    }
    console.log(`\n${agree} of ${rows.length} rows agree; ${extra} read a tag the label lacks; ${missing} miss a labelled tag`);
    console.log(`labelled phrases no tag takes: ${[...unmapped].map(([p, n]) => n > 1 ? `${p} (${n})` : p).join('; ')}`);
}

if (import.meta.main) {
    const [dir, flag, ...rest] = process.argv.slice(2);
    if (flag === '--gold') gold();
    else if (!dir) { console.error('usage: node scripts/gold/behaviour.ts <dir of day files> [--examples <tag> [n] | --gold]'); process.exit(2); }
    else if (flag === '--examples') examples(dir, rest[0]!, Number(rest[1] ?? 20));
    else counts(dir);
}
