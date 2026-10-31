/**
 * The token reader against the gold set, as extract-gold.test.ts does for the macros:
 * the rows it gets wrong today, by field, so a change to its rules shows here.
 */

import { describe, expect, test } from 'vitest';
import { loadGold, reportText } from '../gold.ts';
import { FIELDS, scoreRow, type Field } from '../score.ts';
import { readDirection, readTokens } from './tokens.ts';

/** Row 143 excludes an animal it fails to name ("T46s minus T46s"); row 136 names a calf's mother as context. */
const WRONG_TODAY: Record<Field, number[]> = {
    direction: [], codes_present: [136], codes_absent: [143], codes_hedged: [], pods: [],
};

describe('the token reader', () => {
    test('which gold rows it gets wrong, by field', () => {
        const wrong: Record<Field, number[]> = {direction: [], codes_present: [], codes_absent: [], codes_hedged: [], pods: []};
        for (const row of loadGold()) {
            const scores = scoreRow(row, readTokens(reportText(row.comment)));
            for (const f of FIELDS) if (!scores[f]) wrong[f].push(row.row);
        }
        expect(wrong).toEqual(WRONG_TODAY);
    });

    test.each([
        ['Biggs T36/36Bs & T49A1 spread SB, leaders here', ['T36', 'T36Bs', 'T49A1'], [], [], 'south'],
        ['Biggs T46s (-D), T100Bs, and T100E heading southeast', ['T46s', 'T100Bs', 'T100E'], ['T46D'], [], 'southeast'],
        ['Biggs T60s minus T60D&E milling and drifting SW', ['T60s'], ['T60D', 'T60E'], [], 'southwest'],
        ['Biggs T137s and likely T36A1s spread out, northbound', ['T137s', 'T36A1s'], [], ['T36A1s'], 'north'],
        ['Orcas had been northbound, now stalled, surface activity', [], [], [], 'milling'],
        ['blows of SRKWs seen north of Alki', [], [], [], null],
        ['K pod, some spread, some facing west', [], [], [], null],
        ['T65-A3 and T49-A2', ['T65A3', 'T49A2'], [], [], null],
    ] as const)('%j', (text, present, absent, hedged, direction) => {
        const got = readTokens(text);
        expect(got.codes_present).toEqual(present);
        expect(got.codes_absent).toEqual(absent);
        expect(got.codes_hedged).toEqual(hedged);
        expect(got.direction).toBe(direction);
    });

    test('a pod list', () => {
        expect(readTokens('J, K, and L pods spread out northbound').pods).toEqual(['J', 'K', 'L']);
        expect(readTokens('Js and Ks southbound, possibly Ls').pods).toEqual(['J', 'K', 'L']);
        expect(readDirection('SRKWs very spread N to S, leaders SW bound')).toBe('southwest');
        expect(readDirection('kpod, very spread out south and east bound')).toBe('southeast');
        expect(readDirection('south and east bound, then turned northbound')).toBe('north');
    });
});
