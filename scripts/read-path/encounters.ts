/**
 * Each animal's and matriline's encounters, for its timeline in the map page's sidebar
 * (decision 098).
 *
 *   EXPORT_DIR=… node scripts/read-path/encounters.ts <snapshot.duckdb> [--water-mask <png> <json>]
 *
 * Writes $EXPORT_DIR/encounters/individuals/<id>.json and encounters/matrilines/<id>.json,
 * one for every subject with a page (<id> is its register identifier's seven digits, as
 * the page's is), newest first: src/encounter.ts's Encounter. An encounter is one of a
 * day's travel segments that holds a report of the subject, so it needs every report of
 * that day, not only the subject's: the days are joined into segments here as the day
 * files' writer joins them (src/segments.ts, decision 111), from the same rows in the
 * same order, and each segment summarized for each subject it holds a report of. The
 * Distance is by sea when given the water mask, as the day files' writer is (salish-20u7.3). The
 * browser doing the same would fetch every day file a subject was reported on: 14 MB for T065A5.
 *
 * A subject's reports are its page's links (build.individual_occurrences and
 * build.group_occurrences, deduplicated as the page's are): a matriline's include its
 * sub-lineages' and members' (salish-fwyt.7). The directory is replaced
 * whole each run; it reruns whenever the occurrences do, as the whales page does.
 */

import * as path from 'node:path';

import { dedupeOccurrenceLinks, newestFirst as newer, observedDate } from '../../src/catalog.ts';
import type { DistanceM } from '../../src/segments.ts';
import { dayEncounters, type CalfFirst, type DayOccurrence, type Encounter, type SubjectReport } from '../../src/encounter.ts';
import { withSnapshot } from './duckdb-budget.ts';
import { dayOf } from './pacific-day.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';
import { waterMaskArgs } from './water-mask.ts';
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
    t: {individuals: Doc[], social_groups: Doc[], individual_occurrences: Doc[], group_occurrences: Doc[], matriline_members: Doc[]},
): {reports: Map<string, SubjectReport<SubjectFile>[]>, files: SubjectFile[], firsts: Map<string, (CalfFirst & {subjects: SubjectFile[]})[]>} {
    const reports = new Map<string, SubjectReport<SubjectFile>[]>();
    const files: SubjectFile[] = [];
    // Each individual's link rows as the build wrote them, for its first report below.
    const rowsOf = new Map<number, Doc[]>();
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
            const links = dedupeOccurrenceLinks((bySubject.get(s['id']) ?? []) as never);
            if (kind === 'individuals') rowsOf.set(s['id'], bySubject.get(s['id']) ?? []);
            for (const {occurrence_id, via_group, via_member, possibly} of links) {
                const report = {subject: file, via_group, ...(via_member ? {via_member} : {}), ...(possibly ? {possibly} : {})};
                const list = reports.get(occurrence_id);
                if (list) list.push(report);
                else reports.set(occurrence_id, [report]);
            }
        }
    };
    add(t.individuals.filter(i => i['entity_id']), 'individuals', t.individual_occurrences, 'individual_id');
    // The matrilines that have pages (profiles.ts's assembleMatrilines).
    add(t.social_groups.filter(g => g['kind'] === 'matriline' && g['entity_id']), 'matrilines', t.group_occurrences, 'social_group_id');
    return {reports, files: files.sort(), firsts: calfFirsts(t, rowsOf)};
}

/**
 * Each calf's first report (decision 096's notable sighting, salish-fwyt.4.2): the
 * earliest report that names the animal itself rather than its matriline, and not only
 * possibly, for the animal and each matriline with a page that it is in. The register
 * gives a birth year, not a date, and most calves are reported only through their
 * matriline, so this is the first report naming the calf, not the first that saw it. It
 * counts only when the build holds a report of the animal from its birth year (or its
 * birth years, when the register gives a range): otherwise its first report here may not
 * be its first at all, as for an animal born before the sources begin.
 *
 * Read from the link rows, not the page's merged links: a report of the matriline that
 * says "possibly T036B1A" merges into one plain link, since a plain claim outranks a
 * hedged one on a page (decision 054), but it doesn't name the calf.
 */
export function calfFirsts(
    t: {individuals: Doc[], social_groups: Doc[], matriline_members: Doc[]},
    rowsOf: ReadonlyMap<number, readonly Doc[]>,
): Map<string, (CalfFirst & {subjects: SubjectFile[]})[]> {
    const pageOf = new Map(t.social_groups.filter(g => g['kind'] === 'matriline' && g['entity_id'])
        .map(g => [g['id'] as number, `matrilines/${localPart(g['entity_id'])}.json`]));
    const matrilinesOf = new Map<number, SubjectFile[]>();
    for (const m of t.matriline_members) {
        const page = pageOf.get(m['group_id']);
        if (page) (matrilinesOf.get(m['individual_id']) ?? matrilinesOf.set(m['individual_id'], []).get(m['individual_id'])!).push(page);
    }
    const firsts = new Map<string, (CalfFirst & {subjects: SubjectFile[]})[]>();
    for (const i of t.individuals) {
        const born = i['born_earliest'] as number | null;
        const rows = rowsOf.get(i['id']) ?? [];
        const links = dedupeOccurrenceLinks(rows as never);
        if (born == null || !i['entity_id'] || !links.length) continue;
        // newest first, so the last is the earliest
        const year = observedDate(links.at(-1)!.observed_at).year;
        if (year < born || year > (i['born_latest'] ?? born)) continue;
        // The earliest row that names it, plainly, and isn't absent or rejected.
        const first = rows.filter(r => !r['via_group'] && r['certainty'] !== 'possible' && r['is_present'] !== false
                && r['status'] !== 'rejected' && r['occurrence_id'] && r['observed_at'])
            // ties by id, so the same input always marks the same report
            .sort((a, b) => newer(b['observed_at'], a['observed_at']) || (a['occurrence_id'] < b['occurrence_id'] ? -1 : 1)).at(0);
        if (!first) continue;
        const subjects = [`individuals/${localPart(i['entity_id'])}.json`, ...(matrilinesOf.get(i['id']) ?? [])];
        const id = first['occurrence_id'] as string;
        const list = firsts.get(id) ?? firsts.set(id, []).get(id)!;
        list.push({label: i['primary_designation'], born, subjects});
    }
    return firsts;
}

export async function writeEncounters(snapshot: string, exportDir: string, distanceM?: DistanceM): Promise<{subjects: number, encounters: number, days: number}> {
    const outDir = path.join(exportDir, 'encounters');
    await recoverDir(outDir);
    const {reports, files, firsts} = await readSnapshot(snapshot, async s =>
        subjectReports(await s.tables(['individuals', 'social_groups', 'individual_occurrences', 'group_occurrences', 'matriline_members'] as const)));

    const bySubject = new Map<SubjectFile, Encounter[]>(files.map(f => [f, []]));
    const counts = {subjects: files.length, encounters: 0, days: 0};
    await withSnapshot(snapshot, {memory: '128MB'}, async conn => {
        const finish = (d: string, rows: DayOccurrence[]) => {
            counts.days++;
            for (const [subject, encounter] of dayEncounters(d, rows, id => reports.get(id) ?? [], id => firsts.get(id) ?? [], distanceM)) {
                bySubject.get(subject)!.push(encounter);
                counts.encounters++;
            }
        };
        // Only the days that hold a report of a subject, and those a batch at a time. Measured
        // on 66,000 production documents, 1,620 of whose days held a report of a subject:
        // sorting them all at once peaked at 470 MB, above the day files' run (about 380);
        // 25 days at a time, at 340 MB and 2.5 s. A lower cap saved nothing more. The ids go
        // in as a table rather than SQL text.
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
    });
    // Newest first, as the timeline lists them.
    const newestFirst = (a: Encounter, b: Encounter) => newer(a.end, b.end) || newer(a.start, b.start);
    await replaceDir(outDir, files.map(f => [f, JSON.stringify(bySubject.get(f)!.sort(newestFirst))]));
    return counts;
}

export async function main(): Promise<void> {
    const {rest: [snapshot, ...extra], distanceM} = waterMaskArgs(process.argv.slice(2));
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || extra.length || !exportDir) {
        console.error('usage: EXPORT_DIR=… encounters.ts <snapshot.duckdb> [--water-mask <png> <json>]');
        process.exit(2);
    }
    const {subjects, encounters, days} = await writeEncounters(snapshot, exportDir, distanceM);
    console.log(`encounters/: ${encounters} encounters on ${days} days, for ${subjects} subjects`);
}

if (import.meta.main) {
    await main();
}
