/**
 * The reader against the gold set (decision 102): the rows it gets wrong today, by field,
 * so a change to its rules shows here as a change to the list, reviewed in its pull request.
 */

import { describe, expect, test } from 'vitest';
import { loadGold } from '../scripts/gold/gold.ts';
import { FIELDS, scoreRow, type Field } from '../scripts/gold/score.ts';
import { absent, hedged, identifierLabels, podLetters, present, readDirection, readSighting, readText, reportText } from './sighting-text.ts';

/**
 * Row 143 excludes an animal it fails to name ("T46s minus T46s"); row 136 names a calf's mother as context, which costs it
 * codes present and certainty alike.
 */
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
            {code: "Bigg's", presence: 'present', certainty: 'certain', kind: 'population'},
            {code: 'T137s', presence: 'present', certainty: 'certain', kind: 'code'},
            {code: 'T36A1s', presence: 'present', certainty: 'probable', kind: 'code'},
            {code: 'T65A5', presence: 'present', certainty: 'possible', kind: 'code'},
        ]);
        expect(readText('T46s (-D) northbound').claims).toEqual([
            {code: 'T46s', presence: 'present', certainty: 'certain', kind: 'code'},
            {code: 'T46D', presence: 'absent', certainty: 'certain', kind: 'code'},
        ]);
    });

    test('a pod list', () => {
        expect(podLetters(readText('J, K, and L pods spread out northbound'))).toEqual(['J', 'K', 'L']);
        expect(podLetters(readText('Js and Ks southbound, possibly Ls'))).toEqual(['J', 'K', 'L']);
        expect(podLetters(readText('J Pod SB'))).toEqual(['J']);
        expect(podLetters(readText('J POD and K Pod spread out'))).toEqual(['J', 'K']);
        expect(podLetters(readText('J AND K PODS NB'))).toEqual(['J', 'K']);
        expect(readDirection('SRKWs very spread N to S, leaders SW bound')).toBe('southwest');
        expect(readDirection('kpod, very spread out south and east bound')).toBe('southeast');
        expect(readDirection('south and east bound, then turned northbound')).toBe('north');
    });

    test('pods and populations are claims, in the register\'s words, in the order the text gives them (decision 121)', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('J and K pods NB, T65A5 with them')).toEqual(['J pod', 'K pod', 'T65A5']);
        expect(labels("Biggs and southern residents both")).toEqual(["Bigg's", 'Southern Resident']);
        expect(labels('Transients near the ferry, SRKWs further out')).toEqual(["Bigg's", 'Southern Resident']);
        expect(labels("Bigg's southbound")).toEqual(["Bigg's"]);
        expect(readText('J pod').claims).toEqual([{code: 'J pod', presence: 'present', certainty: 'certain', kind: 'pod'}]);
        // the codes alone, for the readers that want catalogue codes
        expect(present(readText('J pod and T65A5'))).toEqual(['T65A5']);
    });

    test('a hedge word reaches a pod or a population as it reaches a code', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('Faint calls, likely J pod, northbound')).toEqual(['J pod']);
        expect(readText('likely J pod').claims[0]!.certainty).toBe('probable');
        expect(labels('possibly J pod, Biggs seen too')).toEqual(['J pod?', "Bigg's"]);
        expect(labels('maybe SRKW')).toEqual(['Southern Resident?']);
    });

    test('a hedge word before a pod list reaches every pod in it', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('possibly J, K and L pods')).toEqual(['J pod?', 'K pod?', 'L pod?']);
        expect(labels('likely J, K and L pods')).toEqual(['J pod', 'K pod', 'L pod']);
    });

    test('a name given plainly anywhere is not made possible by a "?" on another mention', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('J pod confirmed by CWR. More Js?')).toEqual(['J pod']);
        expect(labels('J pod? More Js?')).toEqual(['J pod?']);
    });

    test('a pod or a population right after a negation is dropped, not read as present or absent', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('Not SRKW, these are transients')).toEqual(["Bigg's"]);
        expect(labels('No J pod today, only T65As')).toEqual(['T65As']);
        expect(readText('No J pod today').claims).toEqual([]);
        expect(labels('residents, not transients')).toEqual([]);
        expect(labels('no transients today')).toEqual([]);
        expect(labels('no J and K pods')).toEqual([]);
        // "not sure" is a hedge, "not only" and "not just" affirm, a negated question asks
        expect(labels('not sure J pod')).toEqual(['J pod?']);
        expect(labels('not only J pod')).toEqual(['J pod']);
        expect(labels('not just Biggs')).toEqual(["Bigg's"]);
        expect(labels('Isn\'t it J pod?')).toEqual(['J pod?']);
        // a name mentioned elsewhere without a negation stays
        expect(labels('J pod here. Not J pod later')).toEqual(['J pod']);
    });

    test('pod spellings: a curly apostrophe, a slash list, run-together letters', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('J’s northbound')).toEqual(['J pod']);
        expect(labels('J/K pods')).toEqual(['J pod', 'K pod']);
        expect(labels('JK pods')).toEqual(['J pod', 'K pod']);
        expect(labels('JKL pods')).toEqual(['J pod', 'K pod', 'L pod']);
        expect(labels('JK northbound')).toEqual([]);
    });

    test('a bare "Bigg" is not a population', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('Michael Bigg catalogue')).toEqual([]);
        for (const word of ['Biggs', "Bigg's", 'Bigg’s', 'transient', 'transients']) expect(labels(`${word} southbound`)).toEqual(["Bigg's"]);
    });

    test('a "?" directly after a name makes that name possible and reaches no further', () => {
        const labels = (text: string) => identifierLabels(readText(text));
        expect(labels('Js? and Ks heading north')).toEqual(['J pod?', 'K pod']);
        expect(labels('T65A? and T65B heading north')).toEqual(['T65A?', 'T65B']);
        expect(labels('J pod? Biggs also')).toEqual(['J pod?', "Bigg's"]);
        // a "?" after the last pod of a list reaches the whole list
        expect(labels('J and K pods?')).toEqual(['J pod?', 'K pod?']);
        expect(labels('Are these Js or Ks?')).toEqual(['J pod?', 'K pod?']);
        expect(labels('Are these Js, Ks & Ls?')).toEqual(['J pod?', 'K pod?', 'L pod?']);
        // a plural's apostrophe may stand between the name and its "?"
        expect(labels("T46B's? and T65A")).toEqual(['T46B?', 'T65A']);
        // a "?" standing apart still hedges the names after it, up to the comma
        expect(labels('Who is that ? T65A, T65B')).toEqual(['T65A?', 'T65B']);
    });

    test('a body as Maplify stores it: the collection tag and the attribution are not read', () => {
        const got = readSighting('[Orca Network] Biggs T046s (-D) heading NB (Jane Doe)<br><br>Submitted by T10 Trusted Observer Via Webmap');
        expect(got.claims).toEqual([
            {code: "Bigg's", presence: 'present', certainty: 'certain', kind: 'population'},
            {code: 'T46s', presence: 'present', certainty: 'certain', kind: 'code'},
            {code: 'T46D', presence: 'absent', certainty: 'certain', kind: 'code'},
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

    test("all three prefixes of the BC humpback catalogue, a nickname after the code left alone", () => {
        expect(present(readText('12:20, BCY0141 Falcon is feeding around Richmond Beach'))).toEqual(['BCY141']);
        expect(present(readText('BCY0458 Raptor and BCX1068 Split Fluke circling'))).toEqual(['BCY458', 'BCX1068']);
        expect(present(readText('BCX1856 Honu, BCZ0338 Geometry'))).toEqual(['BCX1856', 'BCZ338']);
        // only X, Y and Z: other letters after BC are not the catalogue's
        expect(present(readText('BCA0141 and BC0141'))).toEqual([]);
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
        expect(readText('not sure but maybe T65A').claims).toEqual([{code: 'T65A', presence: 'present', certainty: 'possible', kind: 'code'}]);
        expect(readText("Not sure if it's T65A").claims).toEqual([{code: 'T65A', presence: 'present', certainty: 'possible', kind: 'code'}]);
        expect(readText('No doubt T19B Galiano').claims).toEqual([{code: 'T19B', presence: 'present', certainty: 'certain', kind: 'code'}]);
        expect(present(readText('Not only T19B but T19C too'))).toEqual(['T19B', 'T19C']);
        expect(present(readText('Not just T65A but T65B'))).toEqual(['T65A', 'T65B']);
        // a question asks; its "?" hedges
        expect(readText("Isn't it T65A?").claims).toEqual([{code: 'T65A', presence: 'present', certainty: 'possible', kind: 'code'}]);
        expect(absent(readText("It isn't T65A. Maybe T65B?"))).toEqual(['T65A']);
        // a later question doesn't cancel an earlier negation
        for (const text of ['No T65A, but is it T65B?', 'No T65A, is it T65B?']) {
            expect(absent(readText(text))).toEqual(['T65A']);
            expect(present(readText(text))).toEqual(['T65B']);
        }
        expect(readText("Isn't it T65A, or T65B?").claims.map(c => [c.code, c.presence, c.certainty]))
            .toEqual([['T65A', 'present', 'possible'], ['T65B', 'present', 'possible']]);
    });

    test('more negations: a verb of seeing, a letter alone in a list, and not a word', () => {
        expect(absent(readText("I don't see T65A here"))).toEqual(['T65A']);
        expect(absent(readText('Not seen T65A today'))).toEqual(['T65A']);
        // "never seen" is said of animals that are there
        expect(present(readText('Have never seen the T65As this far north before!'))).toEqual(['T65As']);
        expect(absent(readText('No T65A & B today'))).toEqual(['T65A', 'T65B']);
        // "I" is a word, not T65I, and "E of" a bearing, not T65E
        expect(absent(readText('not T65A, I think'))).toEqual(['T65A']);
        expect(absent(readText('No T65A, E of Lime Kiln'))).toEqual(['T65A']);
    });

    test('a correction after a comma is present; a list in a parenthesis is not', () => {
        for (const [text, gone, there] of [
            ['Not T090s, T030Bs', ['T90s'], ['T30Bs']],
            ['not the T65As, the T65Bs', ['T65As'], ['T65Bs']],
            ['T49As (no T049A1, T049A2)', ['T49A1', 'T49A2'], ['T49As']],
            ['no T65A, A4 and A6 either', ['T65A', 'T65A4', 'T65A6'], []],
        ] as const) {
            expect(absent(readText(text)), text).toEqual(gone);
            expect(present(readText(text)), text).toEqual(there);
        }
    });

    test('what is not a negation of the code after it', () => {
        expect(present(readText('Unsure whether or not T65A2 was with them'))).toEqual(['T65A2']);
        expect(present(readText('If not T65A, then T65B'))).toEqual(['T65A', 'T65B']);
        expect(present(readText("This is not T65A's usual range"))).toEqual(['T65A']);
        // an ellipsis or "i.e." stays inside the question
        expect(readText("Isn't it T65A... or T65B?").claims.map(c => [c.code, c.presence, c.certainty]))
            .toEqual([['T65A', 'present', 'possible'], ['T65B', 'present', 'possible']]);
        // a question with an auxiliary and a pronoun runs to its "?", past commas, "i.e." and an ellipsis
        for (const text of ["Isn't it T65A, the one with the notch?", "Isn't that the T65As, Peter?",
                            "Isn't it T65A i.e. T65A2's mom?", "Isn't it T65A... Or T65B?"]) {
            expect(absent(readText(text)), text).toEqual([]);
        }
        // an apostrophe plural is still negated; "not T65A or not T65B" negates both
        expect(absent(readText("No T124D's with them today"))).toEqual(['T124D']);
        expect(absent(readText('Not T65A or not T65B'))).toEqual(['T65A', 'T65B']);
        // a bare "not" before a comma is a correction, even with alternatives after "or"
        expect(present(readText('Not T090s, T030Bs or T037s'))).toEqual(['T30Bs', 'T37s']);
        expect(present(readText('Not T65A, T65B or something like that'))).toEqual(['T65B']);
        // any possessive is about something of the animal's
        for (const text of ["Not T65A's son", "not T65A's new calf", "isn't T65A's boy"]) {
            expect(absent(readText(text)), text).toEqual([]);
        }
        expect(absent(readText("no T46B's, T46C's or T46D's"))).toEqual(['T46B', 'T46C', 'T46D']);
        for (const text of ["no T65A's spotted", "no T65A's yesterday", "No T65A's were seen", "no T65A's off Lime Kiln"]) {
            expect(absent(readText(text)), text).toEqual(['T65A']);
        }
        // "nor" makes a list even after a bare "not"; a determiner may come before the last code
        expect(absent(readText('Not T65A, T65B nor T65C'))).toEqual(['T65A', 'T65B', 'T65C']);
        expect(absent(readText('No T65A, T65B or the T65Cs'))).toEqual(['T65A', 'T65B', 'T65Cs']);
        // an abbreviation doesn't end a sentence
        expect(absent(readText('(approx. 10 whales, no T65A, T65B)'))).toEqual(['T65A', 'T65B']);
        expect(absent(readText("Isn't that T65A off Pt. Roberts?"))).toEqual([]);
        // a question in form, without its "?"
        expect(absent(readText("Isn't it T65A, that's for sure"))).toEqual([]);
        expect(absent(readText("It isn't T65A, that's for sure"))).toEqual(['T65A']);
        // after "no", a comma list ending in "or" is one list
        expect(absent(readText('no T65A, T65B or T65C seen'))).toEqual(['T65A', 'T65B', 'T65C']);
        // a parenthesis left open in an earlier sentence doesn't make a later comma a list
        expect(present(readText('(T65As seen. Not T090s, T030Bs'))).toEqual(['T65As', 'T30Bs']);
        // a distant "?" in a later clause neither cancels the negation nor hedges other codes
        const distant = readText('No T65A today, lots of T137s though, anyone know who else?');
        expect(absent(distant)).toEqual(['T65A']);
        expect(distant.claims.find(c => c.code === 'T137s')).toEqual({code: 'T137s', presence: 'present', certainty: 'certain', kind: 'code'});
    });

    test("a compass word in a reporter's name is not a direction", () => {
        expect(readText('Likely Jpod, spread out moving south, southeast (Katie West)').direction).toBe('southeast');
        expect(readText('Biggs T65As southbound (Steve East)').direction).toBe('south');
        expect(readText('Biggs. Off East Sooke Park near shore').direction).toBe(null);
        expect(readText('Heading South between Long Point and Snake').direction).toBe('south');
        expect(readText('Biggs Southbound (Randy Witter)').direction).toBe('south');
    });
});
