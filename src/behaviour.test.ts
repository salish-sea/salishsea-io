/**
 * Behaviour tags and the part of a group (decision 116), and the gold rows whose
 * hand-read behaviour the phrases disagree with today, so a change to the list shows up
 * as a change to that list.
 */
import { describe, expect, test } from 'vitest';
import { loadGold } from '../scripts/gold/gold.ts';
import { PHRASES, readBehaviour, readGroupPart } from './behaviour.ts';

describe('readBehaviour', () => {
    test('reads the reporters\' own words, normalised only for form', () => {
        expect(readBehaviour('Biggs T65A5 milled on a kill, then hunting again')).toEqual(['milling', 'hunting', 'kill']);
        expect(readBehaviour('J pod foraging, some feeding near the surface')).toEqual(['foraging', 'feeding']);
        expect(readBehaviour('Js and Ks NB quickly, surface active, spread from shore to E of mid'))
            .toEqual(['quickly', 'spread out', 'surface active']);
    });

    test('a behaviour put in the past or denied is not read', () => {
        expect(readBehaviour('Biggs, southbound after feeding (Mollie Segall)')).toEqual([]);
        expect(readBehaviour('now committed to northbound travels after feeding')).toEqual([]);
        expect(readBehaviour('J pod and K pod, spread out, no surface activity')).toEqual(['spread out']);
        // the rule reaches only within its clause
        expect(readBehaviour('No ID yet. Feeding off the point')).toEqual(['feeding']);
        // and a turn ends it
        expect(readBehaviour('not milling but feeding')).toEqual(['feeding']);
        expect(readBehaviour('no longer milling, now hunting')).toEqual(['hunting']);
        expect(readBehaviour("J pod isn't feeding")).toEqual([]);
        expect(readBehaviour("they weren't milling, heading north")).toEqual([]);
        // a parenthesis or a dash ends the clause, and Point No Point is a place
        expect(readBehaviour('T65As (not T137s) hunting seals')).toEqual(['hunting']);
        expect(readBehaviour('No direction - milling')).toEqual(['milling']);
        expect(readBehaviour('J pod off Point No Point milling (Jane Doe)')).toEqual(['milling']);
        // but a hyphen inside a word doesn't end it, and "no point" is a denial
        expect(readBehaviour('no full-body breaches')).toEqual([]);
        expect(readBehaviour('No sign of J-pod foraging')).toEqual([]);
        expect(readBehaviour('no point breaching today')).toEqual([]);
        // and only a few words back: a longer reach suppressed only behaviour that was
        // still going on, over a year of reports ("finished feeding at this time and is resting")
        expect(readBehaviour('CRC53 appears to be finished feeding at this time and is resting while slowly making his way north'))
            .toEqual(['resting', 'slowly']);
    });

    test('names and other senses of a word are not behaviour', () => {
        expect(readBehaviour('ID as Skipper, the 2025 calf of BCX1193 Zig Zag')).toEqual([]);
        expect(readBehaviour('Humpback Split Fluke west of the buoy')).toEqual([]);
        expect(readBehaviour('Biggs T46Bs loosely grouped traveling northwest')).toEqual([]);
        expect(readBehaviour('Orcas passing the fast ferry route')).toEqual([]);
        expect(readBehaviour('It sounded like a blow')).toEqual([]);
        expect(readBehaviour('Zigzag and Mantis')).toEqual([]);
        // a capital in the middle of a sentence is a name: a place, or a reporter's credit
        expect(readBehaviour('T65As off Mill Bay, northbound (Steve Mills)')).toEqual([]);
        expect(readBehaviour('T137s NB off Alki (Jim Chase)')).toEqual([]);
        expect(readBehaviour('T99s southbound (Sara Quick)')).toEqual([]);
        expect(readBehaviour('2 orcas SB past Hunts Point (Mary Hunt)')).toEqual([]);
        expect(readBehaviour('Location: Mill Bay')).toEqual([]);
        expect(readBehaviour('Screenshots from videos by Chase and Sarah.')).toEqual([]);
        expect(readBehaviour('Screenshots from videos (Chase Gagliardi, Sarah Plane)')).toEqual([]);
        // elsewhere a capital is just a capital
        for (const [text, tags] of [
            ['Hunted down by transient orcas', ['hunting']],
            ['J POD MILLING', ['milling']],
            ['J Pod Milling', ['milling']],
            ['Seen today\nMilling near shore', ['milling']],
            ['J pod (Milling)', ['milling']],
            ['milling/Foraging', ['milling', 'foraging']],
            ['Direction: North, Behavior: Foraging/Feeding', ['foraging', 'feeding']],
            ['2 orcas, Milling', ['milling']],
        ] as const) expect(readBehaviour(text), text).toEqual(tags);
    });

    test('tail slapping, however it is put', () => {
        for (const text of ['tail slaps', 'slapping their tails', 'slapping its tail', 'slapping their tales in the water'])
            expect(readBehaviour(text), text).toEqual(['tail slapping']);
    });

    test('every tag is a phrase\'s, so the list is the vocabulary', () => {
        const tags = new Set(PHRASES.map(p => p.tag));
        expect(tags.size).toBe(PHRASES.length);
    });
});

describe('readGroupPart', () => {
    test('the part the text puts here', () => {
        expect(readGroupPart('J pod southbound spread out, leaders here')).toBe('leaders');
        expect(readGroupPart('Biggs T36A1s, T65A5, T137s northbound in two groups, lead group here')).toBe('leaders');
        expect(readGroupPart('J and K pod trailers milling here, trending N after leaders')).toBe('trailers');
        expect(readGroupPart('J pod and K pod northbound, trailing group here')).toBe('trailers');
    });

    test('a part placed somewhere else is not the position\'s', () => {
        expect(readGroupPart('J and K pod leaders N of here, trailing male milling/foraging here before following others NB')).toBe('trailers');
        expect(readGroupPart('J, K, and L pod leaders southbound, trailers spread toward Richmond Beach')).toBeNull();
        expect(readGroupPart('J pod leaders not here yet')).toBeNull();
        expect(readGroupPart('No leaders here, only a few stragglers')).toBeNull();
        expect(readGroupPart('No sign of leaders here')).toBeNull();
        expect(readGroupPart('We did not see trailers here')).toBeNull();
        expect(readGroupPart("Didn't see the leaders here")).toBeNull();
        expect(readGroupPart('Passing Point No Point - leaders here, NB')).toBe('leaders');
        expect(readGroupPart('J pod leaders and trailers here, all bunched')).toBeNull();
        expect(readGroupPart("Leaders aren't here, still south")).toBeNull();
        // the leaders are named first, but the trailers are the ones here
        expect(readGroupPart('J pod leaders northbound, trailers here')).toBe('trailers');
        expect(readGroupPart('J pod leaders northbound trailers here')).toBe('trailers');
    });

    test('without "here" it is not said (decision 116 leaves that question open)', () => {
        expect(readGroupPart('K pod leaders northbound')).toBeNull();
        expect(readGroupPart('Trailing group of Biggs T36/36Bs and T99s northbound')).toBeNull();
    });
});

describe('against the gold set', () => {
    test('which gold rows disagree with the hand-read behaviour', () => {
        // A row's labels are its behaviour phrases as written; put through the same list,
        // they are what the labeller saw, and the text's reading should match them.
        const wrong = loadGold().filter(row => {
            const labelled = new Set(row.behaviour.flatMap(phrase => readBehaviour(phrase)));
            const read = new Set(readBehaviour(row.text));
            return labelled.size !== read.size || [...read].some(tag => !labelled.has(tag));
        }).map(row => row.row);
        // 182: "after feeding" is labelled feeding; the reader rightly reads it as over.
        // 185: "changed direction" is not labelled; the reader is right.
        // 192: "Two traveling north together" — a miss: "together" needs a word before it.
        expect(wrong).toEqual([182, 185, 192]);
    });
});
