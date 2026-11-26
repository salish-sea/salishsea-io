import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { parseOrcaHelloPage, type OrcaHelloRow } from '../ingest/orcahello.ts';
import { ensureMirror, markAttempt, markDay, readSchedule, upsertRows } from './ingest-orcahello.ts';

/** Five OrcaHello detections from 2026 (scripts/ingest/fixtures/orcahello-detections.json). */
const page = parseOrcaHelloPage(JSON.parse(readFileSync(path.join(import.meta.dirname, '../ingest/fixtures/orcahello-detections.json'), 'utf8')));
if (!page.ok) throw new Error(page.error);
const rows: OrcaHelloRow[] = [...page.rows];

const read = (file: string) => {
    const db = new DatabaseSync(file, {readOnly: true});
    try { return db.prepare('SELECT * FROM detections ORDER BY id').all() as unknown as OrcaHelloRow[]; } finally { db.close(); }
};

describe('the mirror of OrcaHello\'s detections', () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(path.join(tmpdir(), 'orcahello-mirror-')); });
    afterAll(async () => { await rm(dir, {recursive: true, force: true}); });

    test('holds the rows written, counts what was added, and a second write of them changes nothing', () => {
        const file = path.join(dir, 'a.sqlite');
        expect(upsertRows(file, rows)).toBe(5);
        expect(read(file).map(r => r.id).sort()).toEqual(rows.map(r => r.id).sort());
        expect(upsertRows(file, rows)).toBe(0);
    });

    test('a moderator\'s answer replaces the unanswered row, and counts as one change', () => {
        const file = path.join(dir, 'b.sqlite');
        upsertRows(file, rows);
        const answered = {...rows[0]!, reviewed: 1, found: 'no', moderated_at: '2026-11-25T10:00:00+00:00'};
        expect(upsertRows(file, [answered])).toBe(1);
        expect(read(file).find(r => r.id === answered.id)).toMatchObject({reviewed: 1, found: 'no'});
    });

    test('never deletes: a row OrcaHello stops sending stays', () => {
        const file = path.join(dir, 'c.sqlite');
        upsertRows(file, rows);
        upsertRows(file, rows.slice(0, 1));
        expect(read(file)).toHaveLength(5);
    });

    test('has no column for the moderator, their comment or the clip', () => {
        const file = path.join(dir, 'd.sqlite');
        ensureMirror(file);
        const db = new DatabaseSync(file, {readOnly: true});
        try {
            const columns = (db.prepare("SELECT name FROM pragma_table_info('detections')").all() as {name: string}[]).map(c => c.name);
            expect(columns.filter(c => /moderator|comment|audio|spectrogram/.test(c))).toEqual([]);
        } finally { db.close(); }
    });

    test('keeps the schedule\'s state: when each kind of fetch was attempted and when each day was read whole', () => {
        const file = path.join(dir, 'e.sqlite');
        expect(readSchedule(file)).toEqual({state: {recent: null, cycle: null, old: null}, fetchedAt: new Map()});
        markAttempt(file, 'recent', new Date('2026-11-26T12:00:00Z'));
        markDay(file, '2026-11-26', 120, new Date('2026-11-26T12:00:30Z'));
        markDay(file, '2026-11-26', 130, new Date('2026-11-26T12:20:30Z'));
        expect(readSchedule(file)).toEqual({
            state: {recent: '2026-11-26T12:00:00.000Z', cycle: null, old: null},
            fetchedAt: new Map([['2026-11-26', '2026-11-26T12:20:30.000Z']]),
        });
    });
});
