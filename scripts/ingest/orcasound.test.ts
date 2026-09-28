/**
 * Vitest suite for the Orcasound functional core (salish-8vr.26 / decision 013).
 *
 * Pure unit tests — no DB, no network. `fixtures/orcasound-bouts.json` is the whole live
 * corpus as `FIRST_PAGE_URL` returned it on 2026-09-27 (222 bouts, 7 feeds, 94 tags, 622 tag
 * applications, one page). Sixteen tags cited a register identifier by then; no moderator
 * had yet stated a certainty on any application, which is the state the ingest has to be
 * correct in until the picker (salish-8vr.9) ships.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseBoutsPage, isIngestable, reconcile, type NormalizedBout } from './orcasound.ts';

const fixture = JSON.parse(
    readFileSync(path.resolve(__dirname, 'fixtures/orcasound-bouts.json'), 'utf8'),
);

const feed = (id = 'feed_1', over: Record<string, unknown> = {}) => ({
    type: 'feed', id,
    attributes: { name: 'Orcasound Lab', location_point: { type: 'Point', coordinates: [-123.17, 48.56] }, ...over },
});
const tag = (id: string, iri: string | null, kind: string | null = 'animal') => ({
    type: 'tag', id, attributes: { name: id, kind, iri },
});
/** One application of a tag to a bout, with the moderator's certainty. */
const itemTag = (id: string, tagId: string, certainty: string | null = null) => ({
    type: 'item_tag', id, attributes: { certainty }, relationships: { tag: { data: { id: tagId, type: 'tag' } } },
});
const bout = (id = 'bout_1', over: Record<string, unknown> = {}, itemTags: string[] = []) => ({
    type: 'bout', id,
    attributes: {
        name: 'SRKW at the Lab', category: 'biophony', feed_id: 'feed_1',
        start_time: '2026-09-01T10:00:00.000000Z', end_time: '2026-09-01T10:30:00.000000Z',
        ...over,
    },
    relationships: {
        feed: { data: { id: 'feed_1', type: 'feed' } },
        item_tags: { data: itemTags.map((t) => ({ id: t, type: 'item_tag' })) },
    },
});
const page = (data: unknown[], included: unknown[], next: string | null = null) => ({ data, included, links: { next } });

describe('parseBoutsPage on the live corpus', () => {
    const result = parseBoutsPage(fixture);

    test('parses every bout of the single page', () => {
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bouts).toHaveLength(222);
        expect(result.next).toBeNull();
    });

    test('carries the three categories through unfiltered', () => {
        if (!result.ok) throw new Error(result.error);
        const counts = new Map<string, number>();
        for (const b of result.bouts) counts.set(b.category, (counts.get(b.category) ?? 0) + 1);
        expect(counts.get('biophony')).toBe(156);
        expect(counts.get('anthrophony')).toBe(44);
        expect(counts.get('geophony')).toBe(22);
    });

    test('every bout has its hydrophone name and position', () => {
        if (!result.ok) throw new Error(result.error);
        for (const b of result.bouts) {
            expect(b.feedName.length).toBeGreaterThan(0);
            expect(b.lon).toBeLessThan(-121);
            expect(b.lat).toBeGreaterThan(47);
        }
    });

    test('97 bouts cite a register entity, and no application states a certainty yet', () => {
        if (!result.ok) throw new Error(result.error);
        const named = result.bouts.filter((b) => b.entities.length > 0);
        expect(named).toHaveLength(97);
        expect(named.flatMap((b) => b.entities).every((e) => e.certainty === null)).toBe(true);
    });

    test('the J+K+L? bout keeps its title verbatim and cites SRKW, J and K, not L', () => {
        if (!result.ok) throw new Error(result.error);
        const b = result.bouts.find((x) => x.id === 'bout_031YvAeJ4O13YgkbQlc8yJ')!;
        expect(b.title).toBe('SRKW signals at PT (J+K +L? pods)');
        expect(b.startedAt).toBe('2025-11-10T04:00:50.373000Z');
        expect(b.endedAt).toBe('2025-11-10T04:30:32.358000Z');
        expect(b.entities).toEqual([
            { entityId: 'SSA:0000010', certainty: null },
            { entityId: 'SSA:0000020', certainty: null },
            { entityId: 'SSA:0000021', certainty: null },
        ]);
    });
});

describe('parseBoutsPage identity', () => {
    test('reads register identifiers from iri, unique and sorted, whatever the tag kind', () => {
        const r = parseBoutsPage(page(
            [bout('bout_1', {}, ['a1', 'a2', 'a3', 'a4'])],
            [
                feed(), tag('j', 'SSA:0000020'), tag('srkw', 'SSA:0000001'), tag('srkw2', 'SSA:0000001', null), tag('call', null, 'signal'),
                itemTag('a1', 'j'), itemTag('a2', 'srkw'), itemTag('a3', 'srkw2'), itemTag('a4', 'call'),
            ],
        ));
        expect(r.ok && r.bouts[0]!.entities).toEqual([
            { entityId: 'SSA:0000001', certainty: null },
            { entityId: 'SSA:0000020', certainty: null },
        ]);
    });

    test('an iri that is not a register identifier contributes nothing', () => {
        const r = parseBoutsPage(page(
            [bout('bout_1', {}, ['a1', 'a2'])],
            [feed(), tag('x', 'https://example.org/vessel/367479990'), tag('y', 'SSA:20'), itemTag('a1', 'x'), itemTag('a2', 'y')],
        ));
        expect(r.ok && r.bouts[0]!.entities).toEqual([]);
    });

    test('a blank name is no title; an open bout has no end', () => {
        const r = parseBoutsPage(page([bout('bout_1', { name: '  ', end_time: null })], [feed()]));
        expect(r.ok && r.bouts[0]!.title).toBeNull();
        expect(r.ok && r.bouts[0]!.endedAt).toBeNull();
    });

    test('takes the position from the feed as [lon, lat]', () => {
        const r = parseBoutsPage(page([bout()], [feed('feed_1', { location_point: { type: 'Point', coordinates: [-122.3, 47.3] } })]));
        expect(r.ok && [r.bouts[0]!.lon, r.bouts[0]!.lat]).toEqual([-122.3, 47.3]);
    });

    test('passes the next link through', () => {
        const r = parseBoutsPage(page([bout()], [feed()], 'https://live.orcasound.net/api/json/bouts?page[offset]=250'));
        expect(r.ok && r.next).toBe('https://live.orcasound.net/api/json/bouts?page[offset]=250');
    });
});

describe('parseBoutsPage certainty', () => {
    test('takes each entity\'s certainty from the application that cites it', () => {
        const r = parseBoutsPage(page(
            [bout('bout_1', {}, ['a1', 'a2', 'a3'])],
            [
                feed(), tag('j', 'SSA:0000020'), tag('k', 'SSA:0000021'), tag('l', 'SSA:0000022'),
                itemTag('a1', 'j', 'certain'), itemTag('a2', 'k', 'probable'), itemTag('a3', 'l', 'possible'),
            ],
        ));
        expect(r.ok && r.bouts[0]!.entities).toEqual([
            { entityId: 'SSA:0000020', certainty: 'certain' },
            { entityId: 'SSA:0000021', certainty: 'probable' },
            { entityId: 'SSA:0000022', certainty: 'possible' },
        ]);
    });

    test('two applications citing one entity keep the surer, and a stated certainty beats none', () => {
        const r = parseBoutsPage(page(
            [bout('bout_1', {}, ['a1', 'a2', 'a3', 'a4'])],
            [
                feed(), tag('srkw', 'SSA:0000010'), tag('srkw2', 'SSA:0000010'), tag('j', 'SSA:0000020'), tag('j2', 'SSA:0000020'),
                itemTag('a1', 'srkw', 'probable'), itemTag('a2', 'srkw2', 'possible'),
                itemTag('a3', 'j', null), itemTag('a4', 'j2', 'possible'),
            ],
        ));
        expect(r.ok && r.bouts[0]!.entities).toEqual([
            { entityId: 'SSA:0000010', certainty: 'probable' },
            { entityId: 'SSA:0000020', certainty: 'possible' },
        ]);
    });

    test('an absent certainty is nobody asked', () => {
        const app = { type: 'item_tag', id: 'a1', attributes: {}, relationships: { tag: { data: { id: 'j', type: 'tag' } } } };
        const r = parseBoutsPage(page([bout('bout_1', {}, ['a1'])], [feed(), tag('j', 'SSA:0000020'), app]));
        expect(r.ok && r.bouts[0]!.entities).toEqual([{ entityId: 'SSA:0000020', certainty: null }]);
    });
});

describe('parseBoutsPage fails the whole page rather than drop a bout', () => {
    test('a bout whose feed is not included', () => {
        const r = parseBoutsPage(page([bout('bout_1', { feed_id: 'feed_9' })], [feed()]));
        expect(r).toEqual({ ok: false, error: 'bout bout_1: feed feed_9 is not in included' });
    });

    test('a bout whose tag application is not included', () => {
        const r = parseBoutsPage(page([bout('bout_1', {}, ['ghost'])], [feed()]));
        expect(r).toEqual({ ok: false, error: 'bout bout_1: item_tag ghost is not in included' });
    });

    test('a tag application whose tag is not included', () => {
        const r = parseBoutsPage(page([bout('bout_1', {}, ['a1'])], [feed(), itemTag('a1', 'ghost')]));
        expect(r).toEqual({ ok: false, error: 'bout bout_1: tag ghost is not in included' });
    });

    test('a certainty outside the enum', () => {
        const r = parseBoutsPage(page([bout('bout_1', {}, ['a1'])], [feed(), tag('j', 'SSA:0000020'), itemTag('a1', 'j', 'likely')]));
        expect(r.ok).toBe(false);
    });

    test('an id that is not a bout id', () => {
        const r = parseBoutsPage(page([bout('cand_1')], [feed()]));
        expect(r.ok).toBe(false);
    });

    test('an end that is not after its start', () => {
        const r = parseBoutsPage(page([bout('bout_1', { end_time: '2026-09-01T10:00:00.000000Z' })], [feed()]));
        expect(r.ok).toBe(false);
        expect(!r.ok && r.error).toMatch(/end_time is not after start_time/);
    });

    test('but an end half a second after a start of coarser precision is fine', () => {
        const r = parseBoutsPage(page([bout('bout_1', { start_time: '2026-09-01T10:00:00Z', end_time: '2026-09-01T10:00:00.5Z' })], [feed()]));
        expect(r.ok).toBe(true);
    });

    test('an unknown category', () => {
        const r = parseBoutsPage(page([bout('bout_1', { category: 'whale' })], [feed()]));
        expect(r.ok).toBe(false);
    });

    test('an included resource of a type we did not ask for', () => {
        const r = parseBoutsPage(page([bout()], [feed(), { type: 'feed_stream', id: 'fs_1', attributes: {} }]));
        expect(r.ok).toBe(false);
    });

    test('not a JSON:API page at all', () => {
        expect(parseBoutsPage({ results: [] }).ok).toBe(false);
        expect(parseBoutsPage(null).ok).toBe(false);
    });
});

describe('isIngestable and reconcile', () => {
    const nb = (id: string, category: NormalizedBout['category'] = 'biophony'): NormalizedBout => ({
        id, feedId: 'feed_1', feedName: 'Lab', lon: -123, lat: 48, startedAt: '2026-09-01T10:00:00Z',
        endedAt: null, title: null, category, entities: [],
    });

    test('only biophony is an occurrence', () => {
        expect(isIngestable(nb('bout_1'))).toBe(true);
        expect(isIngestable(nb('bout_2', 'anthrophony'))).toBe(false);
        expect(isIngestable(nb('bout_3', 'geophony'))).toBe(false);
    });

    test('upserts the biophony bouts and deletes what is stored but no longer fetched, or no longer biophony', () => {
        const plan = reconcile(
            [nb('bout_kept'), nb('bout_new'), nb('bout_now_boat', 'anthrophony')],
            ['bout_kept', 'bout_now_boat', 'bout_gone'],
        );
        expect(plan.upsert.map((b) => b.id)).toEqual(['bout_kept', 'bout_new']);
        expect(plan.delete).toEqual(['bout_now_boat', 'bout_gone']);
    });

    test('an empty corpus would delete everything — which is why the shell must never pass one', () => {
        expect(reconcile([], ['bout_1', 'bout_2']).delete).toEqual(['bout_1', 'bout_2']);
    });
});
