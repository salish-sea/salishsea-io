/**
 * Each animal's and matriline's encounters, for its timeline in the map page's sidebar
 * (decision 098).
 *
 *   EXPORT_DIR=… node scripts/read-path/encounters.ts <snapshot.duckdb>
 *
 * Writes $EXPORT_DIR/encounters/individuals/<id>.json and encounters/matrilines/<id>.json,
 * one for every subject with a page (<id> is its register identifier's seven digits, as
 * the page's is), newest first: src/encounter.ts's Encounter. An encounter is one of a
 * day's travel segments that holds a report of the subject, so it needs every report of
 * that day, not only the subject's: the days are joined into segments here as the map
 * joins a day's file (src/segments.ts), from the same rows in the same order, and each
 * segment summarized for each subject it holds a report of. The browser doing the same
 * would fetch every day file a subject was reported on: 14 MB for T065A5.
 *
 * A subject's reports are its page's links (build.individual_occurrences and
 * build.group_occurrences, deduplicated as the page's are). The directory is replaced
 * whole each run; it reruns whenever the occurrences do, as the whales page does.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import * as path from 'node:path';

import { dedupeOccurrenceLinks } from '../../src/catalog.ts';
import { dayEncounters, type DayOccurrence, type Encounter, type SubjectReport } from '../../src/encounter.ts';
import { budget } from './duckdb-budget.ts';
import { dayOf } from './pacific-day.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';
import { readSnapshot, type Doc } from './snapshot-tables.ts';

/** How many days each query sorts and streams. */
const DAY_BATCH = 25;

/** A subject's file, relative to encounters/: `individuals/0010197.json`. */
type SubjectFile = string;

const localPart = (entityId: string) => entityId.replace(/^SSA:/, '');

/**
 * Which subjects each occurrence is a report of: an individual's links and a matriline's,
 * deduplicated as their pages' are (a rejected or absent link isn't one). Every subject
 * with a page is in `files`, so one with no encounters still gets its empty file.
 */
export function subjectReports(
    t: {individuals: Doc[], social_groups: Doc[], individual_occurrences: Doc[], group_occurrences: Doc[]},
): {reports: Map<string, SubjectReport<SubjectFile>[]>, files: SubjectFile[]} {
    const reports = new Map<string, SubjectReport<SubjectFile>[]>();
    const files: SubjectFile[] = [];
    const add = (subjects: Doc[], kind: string, links: Doc[], key: string) => {
        const bySubject = new Map<number, Doc[]>();
        for (const l of links) {
            const list = bySubject.get(l[key]);
            if (list) list.push(l);
            else bySubject.set(l[key], [l]);
        }
        for (const s of subjects) {
            const file = `${kind}/${localPart(s['entity_id'])}.json`;
            files.push(file);
            for (const {occurrence_id, via_group} of dedupeOccurrenceLinks((bySubject.get(s['id']) ?? []) as never)) {
                const list = reports.get(occurrence_id);
                if (list) list.push({subject: file, via_group});
                else reports.set(occurrence_id, [{subject: file, via_group}]);
            }
        }
    };
    add(t.individuals.filter(i => i['entity_id']), 'individuals', t.individual_occurrences, 'individual_id');
    // The matrilines that have pages (profiles.ts's assembleMatrilines).
    add(t.social_groups.filter(g => g['kind'] === 'matriline' && g['entity_id']), 'matrilines', t.group_occurrences, 'social_group_id');
    return {reports, files: files.sort()};
}

export async function writeEncounters(snapshot: string, exportDir: string): Promise<{subjects: number, encounters: number, days: number}> {
    const outDir = path.join(exportDir, 'encounters');
    await recoverDir(outDir);
    const {reports, files} = await readSnapshot(snapshot, async s =>
        subjectReports(await s.tables(['individuals', 'social_groups', 'individual_occurrences', 'group_occurrences'] as const)));

    const bySubject = new Map<SubjectFile, Encounter[]>(files.map(f => [f, []]));
    const counts = {subjects: files.length, encounters: 0, days: 0};
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        const finish = (d: string, rows: DayOccurrence[]) => {
            counts.days++;
            for (const [subject, encounter] of dayEncounters(d, rows, id => reports.get(id) ?? [])) {
                bySubject.get(subject)!.push(encounter);
                counts.encounters++;
            }
        };
        // Only the days that hold a report of a subject, and those a batch at a time. Measured
        // on 66,000 production documents, 1,620 of whose days held a report of a subject:
        // sorting them all at once peaked at 470 MB, above the day files' run (about 380);
        // 25 days at a time, at 340 MB and 2.5 s. A lower cap saved nothing more. The ids go
        // in as a table rather than SQL text.
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run('CREATE TEMP TABLE reported (id VARCHAR)');
        const appender = await conn.createAppender('reported');
        for (const id of reports.keys()) { appender.appendVarchar(id); appender.endRow(); }
        appender.closeSync();
        const day = dayOf('observed_at');
        const days = ((await conn.runAndReadAll(`
            SELECT DISTINCT ${day} AS day FROM store.build.occurrences
            WHERE id IN (SELECT id FROM reported) AND observed_at IS NOT NULL ORDER BY day
        `)).getRows() as [string][]).map(([d]) => d);
        for (let i = 0; i < days.length; i += DAY_BATCH) {
            const batch = days.slice(i, i + DAY_BATCH);
            // The day file's order, newest first and then by id, so the segments join as the map's do.
            const result = await conn.stream(`
                SELECT ${day} AS day, doc FROM store.build.occurrences
                WHERE ${day} IN (${batch.map(d => `'${d}'`).join(', ')})
                ORDER BY day, observed_at DESC, id
            `);
            let current: string | null = null;
            let rows: DayOccurrence[] = [];
            for await (const chunk of result.yieldRows() as AsyncIterable<[string, string][]>) {
                for (const [d, doc] of chunk) {
                    if (d !== current) {
                        if (current !== null) finish(current, rows);
                        current = d;
                        rows = [];
                    }
                    rows.push(JSON.parse(doc));
                }
            }
            if (current !== null) finish(current, rows);
        }
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    // Newest first, as the timeline lists them.
    const newestFirst = (a: Encounter, b: Encounter) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start);
    await replaceDir(outDir, files.map(f => [f, JSON.stringify(bySubject.get(f)!.sort(newestFirst))]));
    return counts;
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !exportDir) {
        console.error('usage: EXPORT_DIR=… encounters.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const {subjects, encounters, days} = await writeEncounters(snapshot, exportDir);
    console.log(`encounters/: ${encounters} encounters on ${days} days, for ${subjects} subjects`);
}

if (import.meta.main) {
    await main();
}
