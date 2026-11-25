/**
 * The hedge words in a sighting's text and how far each reaches (decision 054's certainty,
 * decisions 109 and 121 for names, decision 116 for behaviour). One implementation, read by
 * src/sighting-text.ts for the names a text gives and by src/behaviour.ts for the tags. Both
 * pass `reaches` the same set of "?" positions that belong to a mention (`ownMarks` in
 * src/behaviour.ts, the rule in src/mentions.ts), so a mention's own "?" hedges nothing after it.
 */

import { NAME_START, NAME_END } from './mentions.ts';

export type Certainty = 'certain' | 'probable' | 'possible';

export const HEDGE = /\b(likely|possibly|possible|maybe|presumably|presumed|probably|probable|unconfirmed|not (?:sure|certain|positive|100\s*%?))\b|\?/gi;
/** Decision 054's certainty for a hedge word: a strong hedge is probable, a weak one possible. */
const LEVEL: Record<string, Certainty> = {likely: 'probable', presumably: 'probable', presumed: 'probable', probably: 'probable', probable: 'probable',
    possibly: 'possible', possible: 'possible', maybe: 'possible', unconfirmed: 'possible', '?': 'possible'};
export const levelOf = (hedge: string): Certainty => LEVEL[hedge.toLowerCase()] ?? 'possible';

/**
 * A hedge word, and the stretch after it that it reaches: up to the next comma, period,
 * semicolon, closing bracket, "!", line break, "but", or a dash that ends a clause (a
 * hyphen with a space on either side, a doubled one, or a long dash with a space beside
 * it), so "not sure of ID - feeding" doubts the ID, not the feeding. A dash inside a word,
 * a code or a range ("T65-A3", "SW-bound", "4–6") ends nothing, and neither does a spaced
 * hyphen between two names, which continues a list of them: "possibly T36A - T36B" doubts
 * both. A "?" that ends a sentence (a space and a capital letter after it, or the end of
 * the text) reaches nothing after it: "Who is that? Foraging off Lime Kiln" doubts the
 * question's own sentence, not the next.
 */
export type Reach = {from: number, to: number, level: Certainty};

const CLAUSE_END = /[,.;)!\n]|\bbut\b|\s-|-\s|--|\s[–—]|[–—]\s/g;
/** A "?" is the end of a sentence when a space and a capital letter, or nothing, follows. */
const ENDS_SENTENCE = /^(?:\s+[A-Z]|\s*$)/;
const NAME_BEFORE = new RegExp(`${NAME_END}$`);
const NAME_AFTER = new RegExp(`^\\s*${NAME_START}`);

/** Where the stretch a hedge at `from` reaches ends. */
function clauseEnd(text: string, from: number): number {
    const rest = text.slice(from);
    for (const m of rest.matchAll(CLAUSE_END)) {
        // a spaced hyphen between two names continues a list of names
        const hyphen = m[0].length !== 2 ? -1 : m[0][0] === '-' ? m.index! : m[0][1] === '-' ? m.index! + 1 : -1;
        if (hyphen >= 0 && /\s/.test(rest[hyphen - 1] ?? '') && /\s/.test(rest[hyphen + 1] ?? '')
            && NAME_BEFORE.test(rest.slice(0, hyphen)) && NAME_AFTER.test(rest.slice(hyphen + 1))) continue;
        return from + m.index!;
    }
    return text.length;
}

/**
 * Every hedge in a text with its reach. `skip` holds the positions of a "?" that belongs to
 * a mention before it ("T65A?", "milling?": ownMarks in src/behaviour.ts) and so hedges
 * nothing after it.
 */
export function reaches(text: string, skip: ReadonlySet<number> = new Set()): Reach[] {
    const found: Reach[] = [];
    for (const h of text.matchAll(HEDGE)) {
        if (skip.has(h.index!)) continue;
        if (h[0] === '?' && ENDS_SENTENCE.test(text.slice(h.index! + 1))) continue;
        found.push({from: h.index!, to: clauseEnd(text, h.index!), level: levelOf(h[0])});
    }
    return found;
}

/** Strongest first: a mention under two hedges takes the weaker, and one name given plainly anywhere is plain. */
export const rank: Record<Certainty, number> = {possible: 0, probable: 1, certain: 2};
