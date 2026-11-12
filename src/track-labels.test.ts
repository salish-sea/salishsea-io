/**
 * The join rule against the hand-labelled days (salish-2rki.1): for each day, the
 * parties it splits across tracks and the tracks on which it mixes parties, today.
 * The labels are the truth; this list changes when the rule does, as a reviewed edit.
 * The rule runs as the build runs it, measuring by sea on the water mask.
 */
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';

import { segmentIds } from './segments.ts';
import { seaDistanceFor } from './sea-distance.ts';
import type { Occurrence } from './types.ts';
import { loadWaterGrid } from '../scripts/read-path/water-mask.ts';
import { partyOf, scoreDay, type DayScore, type Labelled } from '../scripts/gold/tracks.ts';

const at = (name: string) => new URL(`../scripts/read-path/fixtures/${name}`, import.meta.url).pathname;
const bySea = seaDistanceFor(loadWaterGrid(at('water-mask/water-mask.png'), at('water-mask/water-mask.json')));

type Row = Labelled & {observed_at: string, note: string | null};
const days = fs.readdirSync(at('tracks')).filter(f => f.endsWith('.json')).sort()
    .map(f => ({day: f.slice(0, -5), rows: JSON.parse(fs.readFileSync(at(`tracks/${f}`), 'utf-8')) as Row[]}));

const WRONG_TODAY: Record<string, DayScore> = {
    // A report 25 km by sea from the last, past the rule's 20 km; two humpbacks named again 37 km on.
    '2025-07-14': {split: {'BCX1856-BCZ0338': 2, J: 2, T69s: 2}, mixed: []},
    // K pod, very spread: a report 8 km north six minutes after the last.
    '2025-12-11': {split: {K: 2}, mixed: []},
    // Two gray whales feeding 5 km apart, each named in the reports, drawn as one and then as two.
    '2026-01-02': {split: {CRC531: 2}, mixed: [['CRC53', 'CRC531']]},
    '2026-01-23': {split: {}, mixed: [['CRC53', 'CRC531']]},
    '2026-03-29': {split: {J: 2}, mixed: [['T46B1s-T65Bs', 'T86A1s-T124A4s']]},
    '2026-09-03': {split: {J: 2, KL: 3}, mixed: []},
    // The day that began this (salish-2rki): leaders and trailers, a bout placed at its hydrophone,
    // and one report filed twice at two places.
    '2026-11-10': {split: {JK: 3, 'JK/possession-sound': 2}, mixed: []},
};

describe('the join rule on the hand-labelled days', () => {
    test('which parties it splits and which tracks mix parties, by day', () => {
        const wrong: Record<string, DayScore> = {};
        for (const {day, rows} of days) {
            const occurrences = rows.map(row => ({...row, observed_at_ms: Date.parse(row.observed_at)}) as unknown as Occurrence);
            const score = scoreDay(rows, segmentIds(occurrences, bySea));
            if (Object.keys(score.split).length || score.mixed.length) wrong[day] = score;
        }
        expect(wrong).toEqual(WRONG_TODAY);
    });

    test('the labels are well formed', () => {
        expect(days.map(d => d.day)).toHaveLength(11);
        for (const {day, rows} of days) {
            expect(new Set(rows.map(r => r.id)).size, day).toBe(rows.length);
            for (const row of rows) {
                // A report left unlabelled says why.
                if (row.track === null) expect(row.note, `${day} ${row.id}`).toBeTruthy();
                else expect(row.track, `${day} ${row.id}`).toMatch(/^[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)?$/);
            }
            // A part is a part of a party that has more than one, or that is also reported whole.
            const labels = new Set(rows.flatMap(r => r.track ?? []));
            for (const label of labels) if (label.includes('/'))
                expect([...labels].filter(l => l !== label && partyOf(l) === partyOf(label)).length, `${day} ${label}`).toBeGreaterThan(0);
        }
    });
});

describe('scoreDay', () => {
    const rows: Labelled[] = [
        {id: 'a', track: 'J'}, {id: 'b', track: 'J'}, {id: 'c', track: 'J/north'},
        {id: 'd', track: 'T18s'}, {id: 'e', track: null},
    ];
    test('a label on two tracks is split; a part on another track is not', () => {
        expect(scoreDay(rows, new Map([['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'], ['e', '1']])))
            .toEqual({split: {J: 2}, mixed: []});
    });
    test('a track with two parties is mixed; an unlabelled report mixes nothing', () => {
        expect(scoreDay(rows, new Map([['a', '1'], ['b', '1'], ['c', '1'], ['d', '1'], ['e', '1']])))
            .toEqual({split: {}, mixed: [['J', 'T18s']]});
    });
});
