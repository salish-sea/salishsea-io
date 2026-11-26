import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDetectionsPage, reconcile } from './orcasound-detections.ts';

/** A page orcasite returned on 2026-11-26 for 2026-11-24, trimmed to five detections (fixtures/orcasound-detections.json). */
const raw = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'orcasound-detections.json'), 'utf8'));

describe('parseDetectionsPage', () => {
    it('reads every detection, its feed and the count', () => {
        const result = parseDetectionsPage(raw);
        if (!result.ok) throw new Error(result.error);
        expect(result.detections).toHaveLength(5);
        expect(result.total).toBe(5);
        expect(result.next).toBeNull();
        expect(result.feeds.map(f => f.name).sort()).toEqual(['Andrews Bay', 'Beach Camp at Sunset Bay', 'Bush Point']);
        const bush = result.feeds.find(f => f.name === 'Bush Point')!;
        expect([bush.lon, bush.lat]).toEqual([-122.6040035, 48.0336664]);
    });

    it("keeps a machine detection's idempotency key as OrcaHello's id, and a listener's as none", () => {
        const result = parseDetectionsPage(raw);
        if (!result.ok) throw new Error(result.error);
        const machine = result.detections.filter(d => d.source === 'machine');
        expect(machine.map(d => d.orcahelloId)).toEqual([
            '9e645e74-ae8d-4162-ab6b-953c0a62f473', '0eb7ac31-fa38-4735-87e8-a29c5b43a1fd', 'b782f093-5acc-4d0e-b1b1-718e794b1c38',
        ]);
        expect(result.detections.filter(d => d.source === 'human').map(d => d.orcahelloId)).toEqual([null, null]);
    });

    it('keeps every category and the visible flag, which the derivation reads', () => {
        const result = parseDetectionsPage(raw);
        if (!result.ok) throw new Error(result.error);
        expect(result.detections.map(d => [d.category, d.visible]))
            .toEqual([['vessel', true], ['whale', false], ['whale', true], ['whale', true], ['whale', true]]);
    });

    it('carries neither a description nor a source address, whatever the page says', () => {
        const withExtras = JSON.parse(JSON.stringify(raw));
        withExtras.data[0].attributes.description = 'a listener wrote this';
        withExtras.data[0].attributes.source_ip = '192.0.2.1';
        const result = parseDetectionsPage(withExtras);
        if (!result.ok) throw new Error(result.error);
        expect(JSON.stringify(result.detections)).not.toMatch(/listener wrote|192\.0\.2\.1|description|source_ip/);
    });

    it('fails the whole page on a detection it cannot account for', () => {
        const noFeed = JSON.parse(JSON.stringify(raw));
        noFeed.included = [];
        expect(parseDetectionsPage(noFeed)).toMatchObject({ ok: false, error: expect.stringMatching(/is not in included/) });
        const badCategory = JSON.parse(JSON.stringify(raw));
        badCategory.data[0].attributes.category = 'dolphin';
        expect(parseDetectionsPage(badCategory).ok).toBe(false);
        const badId = JSON.parse(JSON.stringify(raw));
        badId.data[0].id = 'bout_nope';
        expect(parseDetectionsPage(badId).ok).toBe(false);
    });

    it('has no total when the page was not asked to count', () => {
        const uncounted = JSON.parse(JSON.stringify(raw));
        delete uncounted.meta;
        const result = parseDetectionsPage(uncounted);
        expect(result).toMatchObject({ ok: true, total: null });
    });
});

describe('reconcile', () => {
    const parsed = parseDetectionsPage(raw);
    if (!parsed.ok) throw new Error(parsed.error);
    const fetched = parsed.detections;

    it('upserts each detection once and deletes what the fetch lacks', () => {
        const plan = reconcile([...fetched, fetched[0]!], [fetched[1]!.id, 'det_gone']);
        expect(plan.upsert.map(d => d.id)).toEqual(fetched.map(d => d.id));
        expect(plan.delete).toEqual(['det_gone']);
    });
});
