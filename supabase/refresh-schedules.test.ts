/**
 * The two occurrence caches must not refresh on the same tick (bd salish-xfo).
 *
 * public.occurrence_index and public.occurrence_identifier_candidates cache the
 * same view, and each one's source is a full scan of public.occurrences — ~2.3s
 * on prod. While both were scheduled at '1-59/5' they ran that scan against
 * each other twice every five minutes, averaging 8.0s and 7.0s instead, and
 * 33.7s on the worst tick observed. A visitor's map query that started inside
 * that window was killed at the 3s anon statement_timeout (SALISHSEA-IO-3G);
 * the same query costs 50ms against a quiet database.
 *
 * Nothing in the schema stops a later migration from putting them back on the
 * same minute — cron.schedule upserts by name and asks no questions — and the
 * symptom would be an intermittent timeout for a stranger on a boat, weeks
 * later. Hence a test rather than a comment.
 *
 * Read-only, and gated on SUPABASE_DB_URL like the other integration tiers
 * (decision 011): it skips on a fresh checkout and runs in CI.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** Jobs whose command is a matview refresh — the ones that scan a whole view. */
type RefreshJob = { jobname: string; schedule: string; active: boolean };

/**
 * The minutes past the hour a schedule fires on.
 *
 * Comparing schedule *strings* would be wrong: a step of five and a step of ten
 * are different text and collide every ten minutes. What matters is the set of
 * ticks a schedule lands on, so expand it and compare those.
 *
 * Deliberately narrow. Every refresh schedule we run is minute-only, so the
 * other four fields must be '*' for this reasoning to hold, and a schedule that
 * is anything else — an hour field, a '@every' shorthand — throws rather than
 * quietly returning a set that means nothing. The next person to write a
 * fancier schedule gets told to teach this function about it.
 */
export function firingMinutes(schedule: string): Set<number> {
    const fields = schedule.trim().split(/\s+/);
    if (fields.length !== 5) {
        throw new Error(`Not a 5-field cron expression: '${schedule}' — teach firingMinutes about it.`);
    }
    const [minute, ...rest] = fields;
    if (rest.some((f) => f !== '*')) {
        throw new Error(
            `'${schedule}' constrains more than the minute field; this test only reasons about ` +
                `minute-only schedules. Teach firingMinutes about it.`,
        );
    }

    const minutes = new Set<number>();
    for (const term of minute!.split(',')) {
        const [range, stepText] = term.split('/');
        const step = stepText === undefined ? 1 : Number(stepText);
        let lo: number;
        let hi: number;
        if (range === '*') {
            [lo, hi] = [0, 59];
        } else if (range!.includes('-')) {
            const [a, b] = range!.split('-').map(Number);
            [lo, hi] = [a!, b!];
        } else {
            [lo, hi] = [Number(range), Number(range)];
        }
        if (![lo, hi, step].every((n) => Number.isInteger(n)) || step < 1 || lo < 0 || hi > 59 || lo > hi) {
            throw new Error(`Unparseable minute term '${term}' in '${schedule}'.`);
        }
        for (let m = lo; m <= hi; m += step) minutes.add(m);
    }
    return minutes;
}

describe('firingMinutes', () => {
    test('expands the forms our schedules actually use', () => {
        expect([...firingMinutes('1-59/5 * * * *')].slice(0, 4)).toEqual([1, 6, 11, 16]);
        expect([...firingMinutes('3-59/5 * * * *')].slice(0, 4)).toEqual([3, 8, 13, 18]);
        expect(firingMinutes('7 * * * *')).toEqual(new Set([7]));
        expect([...firingMinutes('*/30 * * * *')]).toEqual([0, 30]);
        expect([...firingMinutes('0,15 * * * *')]).toEqual([0, 15]);
    });

    test('catches the collision that identical-string comparison would miss', () => {
        const a = firingMinutes('*/5 * * * *');
        const b = firingMinutes('*/10 * * * *');
        expect([...a].some((m) => b.has(m))).toBe(true);
    });

    test('refuses a schedule it cannot reason about', () => {
        expect(() => firingMinutes('0 3 * * *')).toThrow(/only reasons about/);
        expect(() => firingMinutes('@hourly')).toThrow(/5-field/);
    });
});

describe.skipIf(!DSN)('materialized-view refresh schedules (local Supabase)', () => {
    let sql: Sql;
    let jobs: RefreshJob[];

    beforeAll(async () => {
        sql = postgres(DSN as string, { prepare: false, max: 1 });
        jobs = await sql<RefreshJob[]>`
            SELECT jobname, schedule, active
            FROM cron.job
            WHERE command ILIKE '%REFRESH MATERIALIZED VIEW%'
            ORDER BY jobname`;
    });

    afterAll(async () => {
        await sql.end();
    });

    test('both occurrence caches are still scheduled and active', () => {
        const byName = new Map(jobs.map((j) => [j.jobname, j]));
        for (const name of ['refresh-occurrence-index', 'refresh-identifier-candidates']) {
            expect(byName.get(name), `${name} is not scheduled`).toBeDefined();
            expect(byName.get(name)!.active, `${name} is inactive`).toBe(true);
        }
    });

    test('no two matview refreshes ever fire on the same minute', () => {
        const expanded = jobs.map((j) => ({ ...j, minutes: firingMinutes(j.schedule) }));

        const collisions: string[] = [];
        for (let i = 0; i < expanded.length; i++) {
            for (let j = i + 1; j < expanded.length; j++) {
                const a = expanded[i]!;
                const b = expanded[j]!;
                const shared = [...a.minutes].filter((m) => b.minutes.has(m));
                if (shared.length > 0) {
                    collisions.push(
                        `${a.jobname} ('${a.schedule}') and ${b.jobname} ('${b.schedule}') ` +
                            `both fire at minute ${shared.slice(0, 5).join(', ')}` +
                            `${shared.length > 5 ? ` (+${shared.length - 5} more)` : ''}`,
                    );
                }
            }
        }

        expect(collisions, collisions.join('; ')).toEqual([]);
    });
});
