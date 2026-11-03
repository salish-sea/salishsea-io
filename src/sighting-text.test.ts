/**
 * The reader against the gold set (decision 102): the rows it gets wrong today, by field,
 * so a change to its rules shows here as a change to the list, reviewed in its pull request.
 */

import { describe, expect, test } from 'vitest';
import { loadGold } from '../scripts/gold/gold.ts';
import { FIELDS, scoreRow, type Field } from '../scripts/gold/score.ts';
import { absent, hedged, present, readDirection, readSighting, readText, reportText } from './sighting-text.ts';

/** Row 143 excludes an animal it fails to name ("T46s minus T46s"); row 136 names a calf's mother as context, which costs it codes present and certainty alike. */
const WRONG_TODAY: Record<Field, number[]> = {
    direction: [], codes_present: [136], codes_absent: [143], codes_hedged: [], certainty: [136], pods: [],
};

describe('reading sighting text', () => {
    test('which gold rows it gets wrong, by field', () => {
        const wrong: Record<Field, number[]> = {direction: [], codes_present: [], codes_absent: [], codes_hedged: [], certainty: [], pods: []};
        for (const row of loadGold()) {
            const scores = scoreRow(row, readText(reportText(row.comment)));
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
        const got = readText(text);
        expect(present(got)).toEqual(wantPresent);
        expect(absent(got)).toEqual(wantAbsent);
        expect(hedged(got)).toEqual(wantHedged);
        expect(got.direction).toBe(direction);
    });

    test('a hedge word gives its certainty', () => {
        const claims = readText('Biggs T137s and likely T36A1s, maybe T65A5, northbound').claims;
        expect(claims).toEqual([
            {code: 'T137s', presence: 'present', certainty: 'certain'},
            {code: 'T36A1s', presence: 'present', certainty: 'probable'},
            {code: 'T65A5', presence: 'present', certainty: 'possible'},
        ]);
        expect(readText('T46s (-D) northbound').claims).toEqual([
            {code: 'T46s', presence: 'present', certainty: 'certain'},
            {code: 'T46D', presence: 'absent', certainty: 'certain'},
        ]);
    });

    test('a pod list', () => {
        expect(readText('J, K, and L pods spread out northbound').pods).toEqual(['J', 'K', 'L']);
        expect(readText('Js and Ks southbound, possibly Ls').pods).toEqual(['J', 'K', 'L']);
        expect(readDirection('SRKWs very spread N to S, leaders SW bound')).toBe('southwest');
        expect(readDirection('kpod, very spread out south and east bound')).toBe('southeast');
        expect(readDirection('south and east bound, then turned northbound')).toBe('north');
    });

    test('a body as Maplify stores it: the collection tag and the attribution are not read', () => {
        const got = readSighting('[Orca Network] Biggs T046s (-D) heading NB (Jane Doe)<br><br>Submitted by T10 Trusted Observer Via Webmap');
        expect(got.claims).toEqual([
            {code: 'T46s', presence: 'present', certainty: 'certain'},
            {code: 'T46D', presence: 'absent', certainty: 'certain'},
        ]);
        expect(got.direction).toBe('north');
    });

    test('leading zeros go while a digit follows', () => {
        expect(present(readText('T065A5, T001 and J00'))).toEqual(['T65A5', 'T1', 'J0']);
    });
});
