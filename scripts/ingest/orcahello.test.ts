import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { CYCLE_MINUTES, FIRST_DAY, OLD_MINUTES, parseOrcaHelloPage, plan, RECENT_MINUTES, type ScheduleState } from './orcahello.ts';

/** Five OrcaHello detections from 2026 (fixtures/orcahello-detections.json), trimmed to the fields the mirror keeps. */
const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'orcahello-detections.json'), 'utf8'));

describe('parseOrcaHelloPage', () => {
    const result = parseOrcaHelloPage(raw);
    if (!result.ok) throw new Error(result.error);
    const [unanswered, , yes, no, dontKnow] = result.rows;

    it('reads every detection', () => {
        expect(result.rows.map(r => r.id.slice(0, 8))).toEqual(['0eb7ac31', 'b782f093', 'ae470d85', '87b10932', 'd7ea990a']);
        expect(unanswered).toMatchObject({
            location_id: 'rpi_andrews_bay', location_name: 'Andrews Bay', ai_model: 'PODS-AI',
            model_id: 'davethaler/whale-call-detector', global_prediction_label: 'resident', timestamp: '2026-11-24T16:40:55Z',
        });
        expect(JSON.parse(unanswered!.annotations)[0]).toEqual({ startTime: 20, endTime: 23, confidence: 0.849692463874817, label: 'transient' });
    });

    it('keeps the moderator\'s answer and tags, and when it was given only if it was', () => {
        // the API's default for a detection nobody has answered is found 'No', reviewed false
        expect(unanswered).toMatchObject({ reviewed: 0, found: 'No', moderated_at: null, tags: '["srkw","vessel"]' });
        expect(yes).toMatchObject({ reviewed: 1, found: 'yes', tags: '[]' });
        expect(yes!.moderated_at).toMatch(/^2026-/);
        expect(no).toMatchObject({ reviewed: 1, found: 'no', tags: '["humpback","whale"]' });
        expect(dontKnow).toMatchObject({ reviewed: 1, found: "don't know" });
    });

    it('never carries the moderator, their comment or the clip\'s links, whatever the page says', () => {
        const withExtras = raw.map((d: object) => ({
            ...d, moderator: 'someone@example.org', comments: 'a note', audioUri: 'https://example.org/a.wav', spectrogramUri: 'https://example.org/s.png',
        }));
        const parsed = parseOrcaHelloPage(withExtras);
        if (!parsed.ok) throw new Error(parsed.error);
        expect(JSON.stringify(parsed.rows)).not.toMatch(/someone@|a note|a\.wav|s\.png|moderator|comments|audioUri/);
        expect(JSON.stringify(raw)).not.toMatch(/moderator|comments|audioUri|spectrogramUri|@/);
    });

    it('fails the whole page on a detection it cannot read', () => {
        expect(parseOrcaHelloPage([{ ...raw[0], timestamp: 'yesterday' }]).ok).toBe(false);
        expect(parseOrcaHelloPage({ detections: [] }).ok).toBe(false);
    });

    it('takes an empty page', () => {
        expect(parseOrcaHelloPage([])).toEqual({ ok: true, rows: [] });
    });
});

// The schedule is a pure function of the state and the clock, so OrcaHello's API is never
// asked faster than it allows whatever the build's tick.
describe('plan', () => {
    const NOW = new Date('2026-11-26T12:00:00Z');
    const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
    const never: ScheduleState = { recent: null, cycle: null, old: null };
    const kinds = (days: {kind: string}[]) => days.map(d => d.kind);

    it('a mirror that has never fetched is due for everything: today, yesterday, one of the month, one old day', () => {
        const days = plan(never, new Map(), NOW, 0.5);
        expect(days.slice(0, 2)).toEqual([{ kind: 'recent', day: '2026-11-26' }, { kind: 'recent', day: '2026-11-25' }]);
        expect(kinds(days)).toEqual(['recent', 'recent', 'cycle', 'old']);
        // the old day is before the month the cycle covers, and not before OrcaHello began
        const old = days.find(d => d.kind === 'old')!.day;
        expect(old < '2026-10-27' && old >= FIRST_DAY).toBe(true);
    });

    it('fetches nothing when nothing is due, however soon the build comes back', () => {
        const state = { recent: ago(RECENT_MINUTES - 1), cycle: ago(CYCLE_MINUTES - 1), old: ago(OLD_MINUTES - 1) };
        expect(plan(state, new Map(), NOW, 0.5)).toEqual([]);
        expect(plan({ ...state, cycle: ago(CYCLE_MINUTES) }, new Map(), NOW, 0.5).map(d => d.kind)).toEqual(['cycle']);
        expect(plan({ ...state, recent: ago(RECENT_MINUTES) }, new Map(), NOW, 0.5).map(d => d.kind)).toEqual(['recent', 'recent']);
        expect(plan({ ...state, old: ago(OLD_MINUTES) }, new Map(), NOW, 0.5).map(d => d.kind)).toEqual(['old']);
    });

    it('the cycle takes the day of the last thirty fetched longest ago, a day never fetched before any', () => {
        const state = { recent: ago(1), cycle: null, old: ago(1) };
        const fetched = new Map<string, string>();
        // every day of the month fetched, today's neighbours most recently; 2026-11-10 longest ago
        for (let i = 0; i < 30; i++) {
            const d = new Date(NOW.getTime() - i * 86_400_000).toISOString().slice(0, 10);
            fetched.set(d, d === '2026-11-10' ? '2026-11-01T00:00:00.000Z' : ago(10 + i));
        }
        expect(plan(state, fetched, NOW, 0.5)).toEqual([{ kind: 'cycle', day: '2026-11-10' }]);
        // one day nobody fetched yet comes first
        fetched.delete('2026-10-30');
        expect(plan(state, fetched, NOW, 0.5)).toEqual([{ kind: 'cycle', day: '2026-10-30' }]);
        // with none fetched, the most recent day not already in the run
        expect(plan(state, new Map(), NOW, 0.5)).toEqual([{ kind: 'cycle', day: '2026-11-26' }]);
        expect(plan({ ...state, recent: null }, new Map(), NOW, 0.5).map(d => d.day)).toEqual(['2026-11-26', '2026-11-25', '2026-11-24']);
    });

    it('an old day is drawn from before the month, recent days likelier than distant ones', () => {
        const state = { recent: ago(1), cycle: ago(1), old: null };
        const draw = (random: number) => plan(state, new Map(), NOW, random)[0]!.day;
        expect(draw(0)).toBe(FIRST_DAY);
        expect(draw(0.999999) <= '2026-10-27').toBe(true);
        // weight 1 / (1 + age in years): the newer half of the span holds well over half the draws
        const draws = Array.from({ length: 100 }, (_, i) => draw(i / 100));
        expect(draws.filter(d => d >= '2023-11-01').length).toBeGreaterThan(60);
    });
});
