/**
 * How a reading of a sighting's text is scored against its gold row.
 *
 * A reader answers the fields the gold set labels and an extraction could be asked for:
 * the codes present, absent and hedged, the pods, and the direction. Each is scored as
 * right or wrong per report. Codes are compared as sets, so order doesn't matter, but a
 * listed absent animal, a missed code or an invented one each make the field wrong.
 * Direction is right when it matches the label or its `direction_also`, with `milling`,
 * `unknown` and null all meaning "no compass direction": a reader that answers `milling`
 * where the label is null is counted right on direction, since the regex macros, which
 * cannot say `milling`, would otherwise be favoured.
 */

import type { GoldRow } from './gold.ts';

export type Reading = {
    codes_present: string[];
    codes_absent: string[];
    codes_hedged: string[];
    pods: string[];
    direction: string | null;
};

export const FIELDS = ['direction', 'codes_present', 'codes_absent', 'codes_hedged', 'pods'] as const;
export type Field = typeof FIELDS[number];

const NO_DIRECTION = new Set<string | null>([null, 'milling', 'unknown']);

const sameSet = (a: string[], b: string[]) => {
    const fold = (xs: string[]) => [...new Set(xs.map(x => x.toUpperCase()))].sort().join(';');
    return fold(a) === fold(b);
};

export function scoreRow(gold: GoldRow, reading: Reading): Record<Field, boolean> {
    const direction = NO_DIRECTION.has(gold.direction)
        ? NO_DIRECTION.has(reading.direction)
        : reading.direction === gold.direction || (gold.direction_also !== null && reading.direction === gold.direction_also);
    return {
        direction,
        codes_present: sameSet(reading.codes_present, gold.codes_present),
        codes_absent: sameSet(reading.codes_absent, gold.codes_absent),
        codes_hedged: sameSet(reading.codes_hedged, gold.codes_hedged),
        pods: sameSet(reading.pods, gold.pods),
    };
}

export type Tally = {reports: number, right: Record<Field, number>, wrong: Record<Field, number[]>};

const emptyTally = (): Tally => ({
    reports: 0,
    right: Object.fromEntries(FIELDS.map(f => [f, 0])) as unknown as Record<Field, number>,
    wrong: Object.fromEntries(FIELDS.map(f => [f, []])) as unknown as Record<Field, number[]>,
});

/** Tallies by stratum, in the gold set's order, from each row's reading. */
export function tally(rows: GoldRow[], readings: Map<number, Reading>, group: (row: GoldRow) => string): Map<string, Tally> {
    const out = new Map<string, Tally>();
    for (const row of rows) {
        const key = group(row);
        const t = out.get(key) ?? emptyTally();
        out.set(key, t);
        t.reports++;
        const reading = readings.get(row.row);
        if (!reading) throw new Error(`no reading for row ${row.row}`);
        const scores = scoreRow(row, reading);
        for (const f of FIELDS) {
            if (scores[f]) t.right[f]++; else t.wrong[f].push(row.row);
        }
    }
    return out;
}

/** A Markdown table of right counts per field, one row per group. */
export function table(tallies: Map<string, Tally>): string {
    const head = `| stratum | reports | ${FIELDS.join(' | ')} |\n|---|---|${FIELDS.map(() => '---').join('|')}|`;
    const rows = [...tallies].map(([k, t]) => `| ${k} | ${t.reports} | ${FIELDS.map(f => t.right[f]).join(' | ')} |`);
    return [head, ...rows].join('\n');
}
