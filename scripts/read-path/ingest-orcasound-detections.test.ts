import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { parseDetectionsPage, type NormalizedDetection } from '../ingest/orcasound-detections.ts';
import { ensureMirror, reconcileWindow } from './ingest-orcasound-detections.ts';

/** The five detections of 2026-11-24 orcasite returned (scripts/ingest/fixtures/orcasound-detections.json). */
const page = parseDetectionsPage(JSON.parse(readFileSync(path.join(import.meta.dirname, '../ingest/fixtures/orcasound-detections.json'), 'utf8')));
if (!page.ok) throw new Error(page.error);
const response = {detections: page.detections, feeds: page.feeds};
const window = {start: '2026-11-24', end: '2026-11-24'};

const rowsIn = (file: string) => {
    const db = new DatabaseSync(file, {readOnly: true});
    try { return db.prepare('SELECT * FROM detections ORDER BY id').all() as unknown as Record<string, unknown>[]; } finally { db.close(); }
};
const count = (file: string, table: string) => {
    const db = new DatabaseSync(file, {readOnly: true});
    try { return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n: number}).n; } finally { db.close(); }
};

describe('the mirror of orcasite\'s detections', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'orcasound-detections-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });

    test('a new window writes its detections, the feeds they name and the days it covered', () => {
        const file = path.join(dir, 'new.sqlite');
        expect(reconcileWindow(file, window, response)).toMatchObject({upserted: 5, deleted: 0, changed: 5});
        const rows = rowsIn(file);
        expect(rows).toHaveLength(5);
        expect(rows.find(r => r['id'] === 'det_03532XCYoDONefXIHiNfh7')).toEqual({
            id: 'det_03532XCYoDONefXIHiNfh7', feed_id: 'feed_02u8r4EOo8cuSHdC7xDqMI', timestamp: '2026-11-24T08:11:00.000000Z',
            source: 'human', category: 'whale', listener_count: 1, visible: 0, orcahello_id: null, candidate_id: expect.stringMatching(/^cand_/),
        });
        expect(count(file, 'feeds')).toBe(3);
        expect(count(file, 'covered_days')).toBe(1);
    });

    test('the same window again changes nothing', () => {
        const file = path.join(dir, 'again.sqlite');
        reconcileWindow(file, window, response);
        expect(reconcileWindow(file, window, response)).toMatchObject({upserted: 5, deleted: 0, changed: 0});
    });

    test('a detection whose flag changed is replaced, and one orcasite no longer has is deleted', () => {
        const file = path.join(dir, 'changes.sqlite');
        reconcileWindow(file, window, response);
        const [first, second, ...rest] = response.detections;
        const shown: NormalizedDetection = {...second!, visible: true};
        expect(reconcileWindow(file, window, {detections: [first!, shown, ...rest.slice(0, 2)], feeds: response.feeds}, {maxDeleteShare: null}))
            .toMatchObject({deleted: 1, changed: 2});
        expect(rowsIn(file)).toHaveLength(4);
        expect(rowsIn(file).find(r => r['id'] === second!.id)).toMatchObject({visible: 1});
    });

    test('only the window is reconciled: a detection outside it stays whatever the fetch says', () => {
        const file = path.join(dir, 'outside.sqlite');
        reconcileWindow(file, {start: '2026-11-23', end: '2026-11-23'},
            {detections: [{...response.detections[0]!, id: 'det_before', timestamp: '2026-11-23T23:59:59.000000Z'}], feeds: response.feeds});
        reconcileWindow(file, window, response);
        expect(rowsIn(file).map(r => r['id'])).toContain('det_before');
        expect(rowsIn(file)).toHaveLength(6);
    });

    test('a scheduled run refuses to delete more than a tenth of what the window holds, and writes nothing', () => {
        const file = path.join(dir, 'floor.sqlite');
        const many = Array.from({length: 30}, (_, i) => ({...response.detections[0]!, id: `det_many${String(i).padStart(2, '0')}`}));
        reconcileWindow(file, window, {detections: many, feeds: response.feeds});
        expect(() => reconcileWindow(file, window, {detections: many.slice(0, 20), feeds: response.feeds}))
            .toThrow(/lacks 10 of the 30 detections .* nothing written/);
        expect(rowsIn(file)).toHaveLength(30);
        // a curator's backfill applies it
        expect(reconcileWindow(file, window, {detections: many.slice(0, 20), feeds: response.feeds}, {maxDeleteShare: null}).deleted).toBe(10);
        expect(rowsIn(file)).toHaveLength(20);
    });

    test('a mirror made empty has its tables, so a derivation can attach it before any fetch', () => {
        const file = path.join(dir, 'empty.sqlite');
        ensureMirror(file);
        ensureMirror(file);
        expect(count(file, 'detections')).toBe(0);
        expect(count(file, 'feeds')).toBe(0);
    });

    test('the mirror never holds a description or a source address', () => {
        const file = path.join(dir, 'columns.sqlite');
        reconcileWindow(file, window, response);
        const db = new DatabaseSync(file, {readOnly: true});
        try {
            const columns = (db.prepare("SELECT name FROM pragma_table_info('detections')").all() as {name: string}[]).map(c => c.name);
            expect(columns).not.toContain('description');
            expect(columns).not.toContain('source_ip');
        } finally { db.close(); }
    });
});
