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
    hedge_level: 'probable' | 'possible' | null;
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

/** The text a reader is given: src/sighting-text.ts's cut, which the fixture's `text` column was made with. */
export { reportText } from '../../src/sighting-text.ts';

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
