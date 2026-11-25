/**
 * The hedge words in a sighting's text and how far each reaches (decision 054's certainty,
 * decisions 109 and 121 for names, decision 116 for behaviour). One implementation, read by
 * src/sighting-text.ts for the names a text gives and by src/behaviour.ts for the tags.
 */

export type Certainty = 'certain' | 'probable' | 'possible';

export const HEDGE = /\b(likely|possibly|possible|maybe|presumably|presumed|probably|probable|unconfirmed|not (?:sure|certain|positive|100\s*%?))\b|\?/gi;
/** Decision 054's certainty for a hedge word: a strong hedge is probable, a weak one possible. */
const LEVEL: Record<string, Certainty> = {likely: 'probable', presumably: 'probable', presumed: 'probable', probably: 'probable', probable: 'probable',
    possibly: 'possible', possible: 'possible', maybe: 'possible', unconfirmed: 'possible', '?': 'possible'};
export const levelOf = (hedge: string): Certainty => LEVEL[hedge.toLowerCase()] ?? 'possible';

/** A hedge word, and the stretch after it that it reaches: up to the next comma, period, semicolon, closing bracket or "but". */
export type Reach = {from: number, to: number, level: Certainty};

/**
 * Every hedge in a text with its reach. `skip` holds the positions of a "?" that belongs to
 * the mention before it ("T65A?") and so hedges nothing after it.
 */
export function reaches(text: string, skip: ReadonlySet<number> = new Set()): Reach[] {
    const found: Reach[] = [];
    for (const h of text.matchAll(HEDGE)) {
        if (skip.has(h.index!)) continue;
        const end = text.slice(h.index!).search(/[,.;)]|\bbut\b/);
        found.push({from: h.index!, to: end < 0 ? text.length : h.index! + end, level: levelOf(h[0])});
    }
    return found;
}

/** Strongest first: a mention under two hedges takes the weaker, and one name given plainly anywhere is plain. */
export const rank: Record<Certainty, number> = {possible: 0, probable: 1, certain: 2};
