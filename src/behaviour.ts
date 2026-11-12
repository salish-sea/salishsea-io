/**
 * What a report's text says the animals were doing, as tags, and which part of a spread
 * group its position is (decision 116). Read by src/sighting-text.ts, so the build and the
 * browser get the same answer.
 *
 * A tag is the reporters' own word, normalised only for form: "milled" and "milling" are
 * one tag, "feeding", "foraging" and "hunting" three, because different communities of
 * observers use them. Each phrase was measured over a year of published reports and the
 * gold set (docs/research/behaviour-in-sighting-text.md, scripts/gold/behaviour.ts); a new
 * one is measured the same way, and checked against the catalogue's nicknames, since a
 * humpback can be called Zig Zag.
 */

/** A tag and the phrases that say it, matched against the report's text. */
export type Phrase = {tag: string, pattern: RegExp};

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
    {tag: 'kill', pattern: /\bkill\b/i},
    {tag: 'attacking', pattern: /\battack(?:ing|ed|s)?\b/i},
    {tag: 'chasing', pattern: /\bchas(?:e|ing|ed)\b/i},
    {tag: 'quickly', pattern: /\bquick(?:ly)?\b/i},
    {tag: 'fast', pattern: /\bfast\b(?! ferry)/i},
    {tag: 'porpoising', pattern: /\bporpoising\b/i},
    {tag: 'slowly', pattern: /\bslow(?:ly|ed|ing)?\b/i},
    {tag: 'meandering', pattern: /\bmeander(?:ing|ed|s)?\b/i},
    {tag: 'directional changes', pattern: /\bdirection(?:al)? changes?\b|\bchang(?:e|ed|ing|es) (?:of )?direction\b/i},
    {tag: 'flipped', pattern: /\bflip(?:ped|ping)?\b/i},
    {tag: 'turned around', pattern: /\bturn(?:ed|ing)? (?:around|back)\b/i},
    {tag: 'back and forth', pattern: /\bback and forth\b/i},
    // Lower case only: Zig Zag is a humpback, BCX1193.
    {tag: 'zigzag', pattern: /\bzig[- ]?zag(?:ging)?\b/},
    {tag: 'spread out', pattern: /\bspread\b/i},
    {tag: 'in groups', pattern: /\b(?:two|2|three|3|several|multiple|few|many) (?:sub-?)?groups\b/i},
    {tag: 'split up', pattern: /\bsplit (?:up|into)\b/i},
    // "Loosely grouped" is neither tight nor spread, and is left out.
    {tag: 'grouped up', pattern: /\bgroup(?:ed|ing) ?up\b|(?<!loosely )\bgrouped\b/i},
    {tag: 'together', pattern: /\b(?:travel(?:l)?ing|close|all|swimming|tight(?:ly)?) together\b/i},
    {tag: 'long down times', pattern: /\blong ?down ?times?\b/i},
    {tag: 'long dives', pattern: /\b(?:long|deep) dives?\b/i},
    {tag: 'sounded', pattern: /\bsound(?:ed|ing)\b(?! like)/i},
    // Lower case only: Fluke and Split Fluke are names.
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
 * "southbound after feeding" is travelling, "no surface activity" is none.
 */
const NOT_NOW = /(?:\b(?:after|finished|done|no|not|without|never)\b|n't\b)[^.,;!?]{0,15}$/i;
/** A turn that ends what the cue governs: "not milling but feeding" is feeding. */
const TURN = /\b(?:but|now|then)\b/i;

/** Whether the text before a phrase says it is over or didn't happen. */
function notNow(before: string): boolean {
    const cue = NOT_NOW.exec(before);
    return cue !== null && !TURN.test(before.slice(cue.index + 1));
}

/** The tags a text says, in the order of the list. */
export function readBehaviour(text: string): string[] {
    const tags: string[] = [];
    for (const {tag, pattern} of PHRASES) {
        const every = new RegExp(pattern.source, pattern.flags + 'g');
        if ([...text.matchAll(every)].some(m => !notNow(text.slice(0, m.index))))
            if (!tags.includes(tag)) tags.push(tag);
    }
    return tags;
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
const DENIED_BEFORE = /(?:\b(?:not|no|never)\b|n't\b)[^.,;!?]{0,15}$/i;

/**
 * The part of a spread group the text puts at the reported position, or null when it
 * doesn't say, or says both. Only "here" counts: whether "K pod leaders northbound" means
 * the position is the leaders' is a question for the people who write the reports
 * (decision 116), and a wrong answer would mislead a forecast where none only loses
 * information.
 */
export function readGroupPart(text: string): GroupPart | null {
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
