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

    test('a report Orca Network wrote inside its tag', () => {
        expect(reportText('[Orca Network: Biggs T68s, 68Bs, 68Cs Pt Marrowstone]<br><br>Submitted by a Trusted Observer'))
            .toBe('Biggs T68s, 68Bs, 68Cs Pt Marrowstone');
        expect(reportText('[Orca Network: CRC53 Little Patch still feeding]]')).toBe('CRC53 Little Patch still feeding');
        expect(reportText('[Orca Network] J pod SB')).toBe('J pod SB');
        // a bracket that holds a code is the report's own, not a collection's tag
        expect(present(readSighting('[T65A5] heading north'))).toEqual(['T65A5']);
    });

    test('codes in lower case, when they touch their number', () => {
        expect(present(readText('Biggs t71b1, t71b2 northbound'))).toEqual(['T71B1', 'T71B2']);
        // a bare number is a count, even in a list
        expect(present(readText('crc 21 and 22 eastbound'))).toEqual(['CRC21']);
        expect(present(readText('at 3 pm, all 4 whales'))).toEqual([]);
    });

    test('a number without its letter is a code only in a list of codes or right after Biggs', () => {
        expect(present(readText('T46s, T87, T124A2s spread in 1s to 4s southbound'))).toEqual(['T46s', 'T87', 'T124A2s']);
        expect(present(readText('Biggs 36Bs northbound'))).toEqual(['T36Bs']);
    });

    test('words run together are not a code', () => {
        expect(present(readText('Biggs T124A2s and T49A1Southbound'))).toEqual(['T124A2s']);
        expect(present(readText('Biggs T46s and T87directional changes'))).toEqual(['T46s']);
    });

    test('a negation in a sentence makes the codes it governs absent (salish-sepv)', () => {
        // as people correct each other in comments on iNaturalist
        const corrected = readText('@ms104 - not the T090s actually. This was the T030Bs, the T117Bs and T124C');
        expect(present(corrected)).toEqual(['T30Bs', 'T117Bs', 'T124C']);
        expect(absent(corrected)).toEqual(['T90s']);
        const unknown = readText("I don't recognize this as any T077 orca. Possibly T065A5.");
        expect(present(unknown)).toEqual(['T65A5']);
        expect(absent(unknown)).toEqual(['T77']);
        // a list after the negation is governed by it; "but" starts what is present
        const listed = readText('Not T137A or T137B, but T137D');
        expect(absent(listed)).toEqual(['T137A', 'T137B']);
        expect(present(listed)).toEqual(['T137D']);
        expect(absent(readText("Biggs T65As, no T65A5"))).toEqual(['T65A5']);
        // a list with only a space between, and a short form after a code
        expect(absent(readText('T060s (no T060D T060E)'))).toEqual(['T60D', 'T60E']);
        const shortForm = readText('T65A, A4, A6 grouped circling. Not seeing T65A2 & A3');
        expect(absent(shortForm)).toEqual(['T65A2', 'T65A3']);
        // too far from the negation, or past a comma, is not governed by it
        expect(present(readText('No IDs yet, T65As heading north'))).toEqual(['T65As']);
        expect(present(readText('not seen since the encounter with T49As'))).toEqual(['T49As']);
    });

    test('"not sure" is a hedge, and "no doubt" and "not only" affirm', () => {
        expect(readText('not sure but maybe T65A').claims).toEqual([{code: 'T65A', presence: 'present', certainty: 'possible'}]);
        expect(readText("Not sure if it's T65A").claims).toEqual([{code: 'T65A', presence: 'present', certainty: 'possible'}]);
        expect(readText('No doubt T19B Galiano').claims).toEqual([{code: 'T19B', presence: 'present', certainty: 'certain'}]);
        expect(present(readText('Not only T19B but T19C too'))).toEqual(['T19B', 'T19C']);
        expect(present(readText('Not just T65A but T65B'))).toEqual(['T65A', 'T65B']);
        // a question asks; its "?" hedges
        expect(readText("Isn't it T65A?").claims).toEqual([{code: 'T65A', presence: 'present', certainty: 'possible'}]);
        expect(absent(readText("It isn't T65A. Maybe T65B?"))).toEqual(['T65A']);
        // a later question doesn't cancel an earlier negation
        const later = readText('No T65A, but is it T65B?');
        expect(absent(later)).toEqual(['T65A']);
        expect(present(later)).toEqual(['T65B']);
        expect(readText("Isn't it T65A, or T65B?").claims.map(c => [c.code, c.presence, c.certainty]))
            .toEqual([['T65A', 'present', 'possible'], ['T65B', 'present', 'possible']]);
    });

    test('more negations: a verb of seeing, a letter alone in a list, and not a word', () => {
        expect(absent(readText("I don't see T65A here"))).toEqual(['T65A']);
        expect(absent(readText('No T65A & B today'))).toEqual(['T65A', 'T65B']);
        // "I" is a word, not T65I
        const word = readText('not T65A, I think');
        expect(absent(word)).toEqual(['T65A']);
    });

    test("a compass word in a reporter's name is not a direction", () => {
        expect(readText('Likely Jpod, spread out moving south, southeast (Katie West)').direction).toBe('southeast');
        expect(readText('Biggs T65As southbound (Steve East)').direction).toBe('south');
        expect(readText('Biggs. Off East Sooke Park near shore').direction).toBe(null);
        expect(readText('Heading South between Long Point and Snake').direction).toBe('south');
        expect(readText('Biggs Southbound (Randy Witter)').direction).toBe('south');
    });
});
