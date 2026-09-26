/**
 * Vitest suite for the Orcasound functional core (salish-8vr.26 / decision 013).
 *
 * Pure unit tests — no DB, no network. `fixtures/orcasound-bouts.json` is the whole live
 * corpus as `/api/json/bouts` returned it on 2026-09-25 (222 bouts, 7 feeds, 94 tags, one
 * page), fetched with the same sparse fieldsets the shell asks for. Every tag's `iri` was
 * still null that day, which is the state the ingest has to be correct in.
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
const bout = (id = 'bout_1', over: Record<string, unknown> = {}, tags: string[] = []) => ({
    type: 'bout', id,
    attributes: {
        name: 'SRKW at the Lab', category: 'biophony', feed_id: 'feed_1',
        start_time: '2026-09-01T10:00:00.000000Z', end_time: '2026-09-01T10:30:00.000000Z',
        ...over,
    },
    relationships: { feed: { data: { id: 'feed_1', type: 'feed' } }, tags: { data: tags.map((t) => ({ id: t, type: 'tag' })) } },
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

    test('no tag cited a register identifier on 2026-09-25, so no bout names an animal', () => {
        if (!result.ok) throw new Error(result.error);
        expect(result.bouts.every((b) => b.entities.length === 0)).toBe(true);
    });

    test('the J+K+L? bout keeps its title verbatim and its five tags contribute nothing', () => {
        if (!result.ok) throw new Error(result.error);
        const b = result.bouts.find((x) => x.id === 'bout_031YvAeJ4O13YgkbQlc8yJ')!;
        expect(b.title).toBe('SRKW signals at PT (J+K +L? pods)');
        expect(b.startedAt).toBe('2025-11-10T04:00:50.373000Z');
        expect(b.endedAt).toBe('2025-11-10T04:30:32.358000Z');
        expect(b.entities).toEqual([]);
    });
});

describe('parseBoutsPage identity', () => {
    test('reads register identifiers from iri, unique and sorted, whatever the tag kind', () => {
        const r = parseBoutsPage(page(
            [bout('bout_1', {}, ['j', 'srkw', 'srkw2', 'call'])],
            [feed(), tag('j', 'SSA:0000020'), tag('srkw', 'SSA:0000001'), tag('srkw2', 'SSA:0000001', null), tag('call', null, 'signal')],
        ));
        expect(r.ok && r.bouts[0]!.entities).toEqual([
            { entityId: 'SSA:0000001', certainty: null },
            { entityId: 'SSA:0000020', certainty: null },
        ]);
    });

    test('an iri that is not a register identifier contributes nothing', () => {
        const r = parseBoutsPage(page(
            [bout('bout_1', {}, ['x', 'y'])],
            [feed(), tag('x', 'https://example.org/vessel/367479990'), tag('y', 'SSA:20')],
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

describe('parseBoutsPage fails the whole page rather than drop a bout', () => {
    test('a bout whose feed is not included', () => {
        const r = parseBoutsPage(page([bout('bout_1', { feed_id: 'feed_9' })], [feed()]));
        expect(r).toEqual({ ok: false, error: 'bout bout_1: feed feed_9 is not in included' });
    });

    test('a bout whose tag is not included', () => {
        const r = parseBoutsPage(page([bout('bout_1', {}, ['ghost'])], [feed()]));
        expect(r).toEqual({ ok: false, error: 'bout bout_1: tag ghost is not in included' });
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
