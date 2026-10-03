/**
 * Date windows for the read-path build's own ingests (decision 061): Maplify's
 * (ingest-maplify.ts) and iNaturalist's (ingest-inaturalist.ts). Days are 'YYYY-MM-DD',
 * a window's ends both inclusive. Pure, except firstCoveredDay, which reads a mirror's
 * `covered_days`.
 */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type { IngestWindow } from '../ingest/persist.ts';

/** 'YYYY-MM-01' of the month containing `day`. */
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

/** 'YYYY-MM-01' of the month after the one containing `day`: 31 days on from its 1st is always in it. */
const nextMonth = (day: string) => monthOf(addDays(monthOf(day), 31));

/**
 * The anti-entropy window: one calendar month from the one containing `earliest` up to
 * the day before `before` (the regular window's start), the last one cut off there,
 * chosen with weight 1 / (1 + age in years), `random` in [0, 1), as BeeAtlas's
 * anti_entropy_pipeline.py weights its sample. Null when there is no such month.
 */
export function antiEntropyWindow(earliest: string, before: string, now: Date, random: number): IngestWindow | null {
    const last = addDays(before, -1);
    if (last < earliest) return null;
    const months: IngestWindow[] = [];
    for (let start = monthOf(earliest); start <= last; start = nextMonth(start)) {
        const end = addDays(nextMonth(start), -1);
        months.push({start, end: end < last ? end : last});
    }
    const weight = (w: IngestWindow) =>
        1 / (1 + (now.getTime() - new Date(`${w.end}T00:00:00Z`).getTime()) / (365 * 86_400_000));
    const total = months.reduce((sum, w) => sum + weight(w), 0);
    let at = random * total;
    for (const w of months) {
        at -= weight(w);
        if (at < 0) return w;
    }
    return months.at(-1) ?? null;
}

/** The first day the mirror covers, or null when it covers none (or isn't there yet). */
export function firstCoveredDay(path: string): string | null {
    if (!existsSync(path)) return null;
    const db = new DatabaseSync(path, {readOnly: true});
    try {
        return (db.prepare('SELECT min(day) AS day FROM covered_days').get() as {day: string | null}).day;
    } catch {
        return null;
    } finally {
        db.close();
    }
}

/** 'YYYY-MM-DD' plus `n` days. */
export function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/**
 * A curator's window, or null when it isn't one: both ends real calendar days written
 * 'YYYY-MM-DD' (Date would roll 2026-02-30 over into March rather than refuse it), start
 * no later than end. Checked before fetching, so a typo never reaches the reconcile.
 */
export function curatorWindow(start: string, end: string): IngestWindow | null {
    const isDay = (s: string) => {
        const d = new Date(`${s}T00:00:00Z`);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    };
    return isDay(start) && isDay(end) && start <= end ? {start, end} : null;
}

/** Every day of a window, both ends included. */
export function windowDays(window: IngestWindow): string[] {
    const days: string[] = [];
    for (let day = window.start; day <= window.end; day = addDays(day, 1)) days.push(day);
    return days;
}
