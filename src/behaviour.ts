/**
 * What a report's text says the animals were doing, as tags, and which part of a spread
 * group its position is (decision 116). Read by src/sighting-text.ts, so the build and the
 * browser get the same answer.
 *
 * A tag is the reporters' own word, normalised only for form: "milled" and "milling" are
 * one tag, "feeding", "foraging" and "hunting" three, because different communities of
 * observers use them. A tag the reporter hedged ("possibly foraging", "possible flip northbound")
 * ends in '?', as an identifier does (decision 054; decision 116's note of 2026-11-25). Each phrase was measured over a year of published reports and the
 * gold set (docs/research/behaviour-in-sighting-text.md, scripts/gold/behaviour.ts); a new
 * one is measured the same way, and checked against the catalogue's nicknames, since a
 * humpback can be called Zig Zag.
 */

import { reaches, rank, type Certainty } from './hedge.ts';

/**
 * A tag and the phrases that say it, matched against the report's text. `inSentence` is
 * how a sentence that lists tags says it, when the reporters' word doesn't fit one: a card
 * writes "then moving quickly and spread out", not "then quickly and spread out". The tag
 * stays the reporters' word.
 */
export type Phrase = {tag: string, pattern: RegExp, inSentence?: string};

export const PHRASES: readonly Phrase[] = [
    {tag: 'milling', pattern: /\bmill(?:ing|ed|s)?\b/i},
    {tag: 'stalled', pattern: /\bstall(?:ed|ing)\b/i},
    {tag: 'hanging around', pattern: /\bhang(?:ing)? (?:out|around)\b/i},
    {tag: 'circling', pattern: /\bcircl(?:ing|ed)\b/i},
    {tag: 'shuffling', pattern: /\bshuffl(?:ing|ed)\b/i},
    {tag: 'drifting', pattern: /\bdrift(?:ing|ed)\b/i},
    {tag: 'resting', pattern: /\brest(?:ing|ed)\b/i},
    {tag: 'logging', pattern: /\blogging\b/i},
    {tag: 'hauled out', pattern: /\bhaul(?:ed|ing)? ?out\b/i},
    {tag: 'foraging', pattern: /\bforag(?:e|es|ed|ing)\b/i},
    {tag: 'feeding', pattern: /\bfe(?:ed|eds|eding|d)\b/i},
    {tag: 'hunting', pattern: /\bhunt(?:ing|ed|s)?\b/i},
    {tag: 'eating', pattern: /\beat(?:ing|s)?\b/i},
    {tag: 'kill', pattern: /\bkill\b/i, inSentence: 'on a kill'},
    {tag: 'attacking', pattern: /\battack(?:ing|ed|s)?\b/i},
    {tag: 'chasing', pattern: /\bchas(?:e|ing|ed)\b/i},
    {tag: 'quickly', pattern: /\bquick(?:ly)?\b/i, inSentence: 'moving quickly'},
    {tag: 'fast', pattern: /\bfast\b(?! ferry)/i, inSentence: 'moving fast'},
    {tag: 'porpoising', pattern: /\bporpoising\b/i},
    {tag: 'slowly', pattern: /\bslow(?:ly|ed|ing)?\b/i, inSentence: 'moving slowly'},
    {tag: 'meandering', pattern: /\bmeander(?:ing|ed|s)?\b/i},
    {tag: 'directional changes', pattern: /\bdirection(?:al)? changes?\b|\bchang(?:e|ed|ing|es) (?:of )?direction\b/i, inSentence: 'changing direction'},
    {tag: 'flipped', pattern: /\bflip(?:ped|ping)?\b/i},
    {tag: 'turned around', pattern: /\bturn(?:ed|ing)? (?:around|back)\b/i},
    {tag: 'back and forth', pattern: /\bback and forth\b/i, inSentence: 'going back and forth'},
    // Lower case only, even starting a sentence: Zig Zag (BCX1193) and Zigzag are humpbacks.
    {tag: 'zigzag', pattern: /\bzig[- ]?zag(?:ging)?\b/, inSentence: 'zigzagging'},
    {tag: 'spread out', pattern: /\bspread\b/i},
    {tag: 'in groups', pattern: /\b(?:two|2|three|3|several|multiple|few|many) (?:sub-?)?groups\b/i},
    {tag: 'split up', pattern: /\bsplit (?:up|into)\b/i},
    // "Loosely grouped" is neither tight nor spread, and is left out.
    {tag: 'grouped up', pattern: /\bgroup(?:ed|ing) ?up\b|(?<!loosely )\bgrouped\b/i},
    {tag: 'together', pattern: /\b(?:travel(?:l)?ing|close|all|swimming|tight(?:ly)?) together\b/i, inSentence: 'keeping together'},
    {tag: 'long down times', pattern: /\blong ?down ?times?\b/i, inSentence: 'with long down times'},
    {tag: 'long dives', pattern: /\b(?:long|deep) dives?\b/i, inSentence: 'making long dives'},
    {tag: 'sounded', pattern: /\bsound(?:ed|ing)\b(?! like)/i},
    // Lower case only, even starting a sentence: Fluke and Split Fluke are names.
    {tag: 'fluking', pattern: /\bfluk(?:ed|ing)\b|\bfluke[sd]? up\b/},
    {tag: 'surface active', pattern: /\bsurface[- ]activ(?:e|ity)\b/i},
    {tag: 'breaching', pattern: /\bbreach(?:ing|ed|es)?\b/i},
    // and "slapping their tails", which one report spells "tales"
    {tag: 'tail slapping', pattern: /\btail[- ]?slap(?:s|ping)?\b|\bslap(?:s|ping)? (?:their|its|the|her|his) (?:tails?|tales?)\b/i},
    {tag: 'pec slapping', pattern: /\bpec(?:toral)?[- ]?(?:fin )?slap(?:s|ping)?\b/i},
    {tag: 'spyhopping', pattern: /\bspy[- ]?hop(?:s|ping)?\b/i},
    {tag: 'playing', pattern: /\bplay(?:ing|ful)\b/i},
];

/**
 * The words just before a phrase that say the behaviour is over or didn't happen:
 * "southbound after feeding" is travelling, "no surface activity" is none. The reach is a
 * few words within the clause, which ends at punctuation, a bracket or a dash with a space
 * on either side or doubled ("not sure of ID - feeding", "ID- feeding"); a hyphen inside a
 * word ("no full-body breaches") doesn't end it.
 */
const NOT_NOW = /(?:\b(?:after|finished|done|no|not|without|never)\b|n't\b)(?:(?!\s-|-\s|--)[^.,;!?()–—]){0,15}$/i;
/** A turn that ends what the cue governs: "not milling but feeding" is feeding. */
const TURN = /\b(?:but|now|then)\b/i;

/** Whether the text before a phrase says it is over or didn't happen. */
function notNow(before: string): boolean {
    const cue = NOT_NOW.exec(before);
    return cue !== null && !TURN.test(before.slice(cue.index + 1));
}

/**
 * "No" in Point No Point is a place, not a denial; read with the name joined up. Same
 * length, so a match's position is the same in both.
 */
const unplace = (text: string) => text.replace(/\bPoint (No) Point\b/gi, (whole, no: string) => whole.replace(` ${no} `, `_${no}_`));

// The places a capitalised word can name, as reports write them: "Mill Bay", "Hunts Point".
const PLACE_WORD = /^[A-Za-z']+[ \t]+(?:Bay|Point|Pt|Creek|Cove|Island|Harbou?r|Rocks?|Beach|Park|Head|Reef|Inlet|Lake|River|Pass|Spit|Bluff|Marina|Lighthouse)\b/;

/**
 * Whether a capitalised match is part of a name rather than a behaviour: a place ("Mill
 * Bay", "Hunts Point"), or a person in a reporter's credit, a run of capitalised words in
 * brackets ("(Jim Chase)", "(Chase Gagliardi, Sarah Plane)") or after "by". Elsewhere a capital is just
 * a capital: "Milling off the point", "J Pod Milling", "milling/Foraging".
 */
function isName(text: string, at: number): boolean {
    if (!/^[A-Z][a-z]/.test(text.slice(at, at + 2))) return false;
    if (PLACE_WORD.test(text.slice(at))) return true;
    if (/\bby\s+$/.test(text.slice(0, at))) return true;           // "videos by Chase and Sarah"
    const open = text.lastIndexOf('(', at), close = text.lastIndexOf(')', at);
    if (open <= close) return false;
    return /[A-Z][a-z]+\s+$/.test(text.slice(open, at)) || /^\S+\s+[A-Z][a-z]/.test(text.slice(at));
}

/**
 * The tags a text says, in the order of the list. A hedge word before a phrase, in its reach
 * (src/hedge.ts, as for the names a text gives), makes the tag possible, written with a
 * trailing '?' as an identifier is ("possible foraging" is "foraging?"); a probable one
 * ("likely foraging") is plain, as decision 109 writes a code. A "?" right after a phrase
 * makes it possible. A tag the text says plainly anywhere is plain, whatever a hedge on
 * another mention says (decision 054).
 */
export function readBehaviour(text: string): string[] {
    const read = unplace(text);
    // A "?" right after a phrase belongs to it and hedges nothing after it.
    const own = new Set<number>();
    const mentions: {tag: string, index: number, end: number, own: boolean}[] = [];
    for (const {tag, pattern} of PHRASES) {
        const every = new RegExp(pattern.source, pattern.flags + 'g');
        for (const m of read.matchAll(every)) {
            if (isName(read, m.index) || notNow(read.slice(0, m.index))) continue;
            const end = m.index + m[0].length;
            // the "?" may stand a space apart: "milling ?"
            const mark = /^ ?\?/.exec(read.slice(end));
            const asked = mark !== null;
            if (asked) own.add(end + mark[0].length - 1);
            mentions.push({tag, index: m.index, end, own: asked});
        }
    }
    const hedges = reaches(read, own);
    const certainty = new Map<string, Certainty>();
    for (const m of mentions) {
        let level: Certainty = m.own ? 'possible' : 'certain';
        if (level !== 'possible') for (const h of hedges)
            if (h.from <= m.index && m.end <= h.to && rank[h.level] < rank[level]) level = h.level;
        const have = certainty.get(m.tag);
        if (have === undefined || rank[level] > rank[have]) certainty.set(m.tag, level);
    }
    return PHRASES.filter(p => certainty.has(p.tag)).map(p => certainty.get(p.tag) === 'possible' ? `${p.tag}?` : p.tag);
}

/** Whether a tag the reader wrote is a possible one, which ends in '?'. */
export const isPossible = (tag: string) => tag.endsWith('?');
/** A tag without its '?': the reporters' word, whether or not they were sure. */
export const bare = (tag: string) => tag.replace(/\?$/, '');

/** How a sentence says a tag: "moving quickly" for quickly, the tag itself for most, "possibly foraging" for a possible one. */
export function inSentence(tag: string): string {
    const word = bare(tag);
    const said = PHRASES.find(p => p.tag === word)?.inSentence ?? word;
    return isPossible(tag) ? `possibly ${said}` : said;
}

/** Which part of a spread group a report's position is. */
export type GroupPart = 'leaders' | 'trailers';

// The part, then up to three words in the same clause that name no other part
// ("trailing male milling/foraging here"), then "here", which is the reported position:
// "leaders N of here" puts the leaders somewhere else, and "leaders not here" denies it.
const PART_HERE = /\b(?:(leaders?|lead(?:ing|er)? group)|(trailers?|trailing (?:group|male|female|whales?|orcas?)))\b((?:\s+(?!(?:leaders?|lead|leading|trailers?|trailing)\b)[\w/'-]+){0,3}?)\s+here\b/gi;
const ELSEWHERE = /\b(?:of|from|past|than|beyond|toward|towards)$/i;
const DENIED = /\b(?:not|no|never)\b|n't\b/i;
// A part named just before, with "and": "leaders and trailers here" names both.
const PART_BEFORE = /\b(?:leaders?|lead(?:ing|er)? group|trailers?|trailing (?:group|male|female|whales?|orcas?))\s*(?:and|&|\/)\s*$/i;
// A denial a few words before the part, in its clause: "no leaders here", "no sign of
// leaders here", "did not see trailers here".
const DENIED_BEFORE = /(?:\b(?:not|never)\b|(?<!\bPoint )\bno\b(?! Point\b)|n't\b)[^.,;!?()\u2013\u2014-]{0,15}$/i;

/**
 * The part of a spread group the text puts at the reported position, or null when it
 * doesn't say, or says both. Only "here" counts: whether "K pod leaders northbound" means
 * the position is the leaders' is a question for the people who write the reports
 * (decision 116), and a wrong answer would mislead a forecast where none only loses
 * information.
 */
export function readGroupPart(text: string): GroupPart | null {
    text = unplace(text);
    const parts = new Set<GroupPart>();
    for (const m of text.matchAll(PART_HERE)) {
        const between = m[3]!.trim();
        const before = text.slice(0, m.index);
        if (PART_BEFORE.test(before)) return null;
        if (ELSEWHERE.test(between) || DENIED.test(between) || DENIED_BEFORE.test(before)) continue;
        parts.add(m[1] ? 'leaders' : 'trailers');
    }
    return parts.size === 1 ? [...parts][0]! : null;
}
