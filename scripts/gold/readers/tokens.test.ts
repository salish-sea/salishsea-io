/**
 * The token reader against the gold set, as extract-gold.test.ts does for the macros:
 * the rows it gets wrong today, by field, so a change to its rules shows here.
 */

import { describe, expect, test } from 'vitest';
import { loadGold, reportText } from '../gold.ts';
import { absent, FIELDS, hedged, present, scoreRow, type Field } from '../score.ts';
import { readDirection, readTokens } from './tokens.ts';

/** Row 143 excludes an animal it fails to name ("T46s minus T46s"); row 136 names a calf's mother as context, which costs it codes present and certainty alike. */
const WRONG_TODAY: Record<Field, number[]> = {
    direction: [], codes_present: [136], codes_absent: [143], codes_hedged: [], certainty: [136], pods: [],
};

describe('the token reader', () => {
    test('which gold rows it gets wrong, by field', () => {
        const wrong: Record<Field, number[]> = {direction: [], codes_present: [], codes_absent: [], codes_hedged: [], certainty: [], pods: []};
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
    ] as const)('%j', (text, wantPresent, wantAbsent, wantHedged, direction) => {
        const got = readTokens(text);
        expect(present(got)).toEqual(wantPresent);
        expect(absent(got)).toEqual(wantAbsent);
        expect(hedged(got)).toEqual(wantHedged);
        expect(got.direction).toBe(direction);
    });

    test('a hedge word gives its certainty', () => {
        const claims = readTokens('Biggs T137s and likely T36A1s, maybe T65A5, northbound').claims;
        expect(claims).toEqual([
            {code: 'T137s', presence: 'present', certainty: 'certain'},
            {code: 'T36A1s', presence: 'present', certainty: 'probable'},
            {code: 'T65A5', presence: 'present', certainty: 'possible'},
        ]);
        expect(readTokens('T46s (-D) northbound').claims).toEqual([
            {code: 'T46s', presence: 'present', certainty: 'certain'},
            {code: 'T46D', presence: 'absent', certainty: 'certain'},
        ]);
    });

    test('a pod list', () => {
        expect(readTokens('J, K, and L pods spread out northbound').pods).toEqual(['J', 'K', 'L']);
        expect(readTokens('Js and Ks southbound, possibly Ls').pods).toEqual(['J', 'K', 'L']);
        expect(readDirection('SRKWs very spread N to S, leaders SW bound')).toBe('southwest');
        expect(readDirection('kpod, very spread out south and east bound')).toBe('southeast');
        expect(readDirection('south and east bound, then turned northbound')).toBe('north');
    });
});
