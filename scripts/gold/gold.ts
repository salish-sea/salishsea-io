/**
 * The gold set (scripts/read-path/fixtures/gold/, decision 102) as the readers and the
 * scorer see it: each row's labels, and the text a reader is given.
 */

import { readFileSync } from 'node:fs';

export type GoldRow = {
    row: number;
    maplify_id: number;
    stratum: string;
    maplify_name: string | null;
    number_sighted: number;
    collection_tag: string | null;
    comment: string;
    text: string;
    codes_present: string[];
    codes_absent: string[];
    codes_hedged: string[];
    pods: string[];
    ecotype: string | null;
    nicknames: string[];
    certainty: string | null;
    direction: string | null;
    direction_before: string | null;
    direction_also: string | null;
    count_min: number | null;
    count_text: string | null;
    extra_unidentified: boolean;
    calf: boolean;
    behaviour: string[];
    places: string[];
    identifier_named: boolean;
    later_edit: boolean;
    notes: string | null;
};

export const GOLD_PATH = new URL('../read-path/fixtures/gold/sighting-text.json', import.meta.url);

export function loadGold(): GoldRow[] {
    return JSON.parse(readFileSync(GOLD_PATH, 'utf8'));
}

/**
 * The part of a Maplify comment a reader should read: the collection tag at the front
 * ("[Orca Network] "), the trailing "Submitted by …" attribution and any HTML removed,
 * whitespace collapsed. The same cut the fixture's `text` column was made with.
 */
export function reportText(comment: string): string {
    let text = comment.replace(/<br><br>Submitted by .*$/s, '').replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const tag = /^\[([^\]]+)\]/.exec(text);
    if (tag) text = text.slice(tag[0].length).trim();
    return text;
}

/**
 * Which rows a reader may be developed against, and which it is judged on. The hard
 * strata and the first half of each random stratum are for development; the second half
 * of each random stratum is held out, so a reader tuned on the gold set still has rows
 * it never saw. The regex macros predate the gold set, so for them the split is moot.
 */
export function isHeldOut(row: GoldRow): boolean {
    return (row.stratum === 'random orca' && row.row > 50)
        || (row.stratum === 'random other species' && row.row > 120);
}
