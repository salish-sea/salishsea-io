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

    test('no two matview refreshes share a tick', () => {
        // Compared as whole schedule strings rather than parsed: two jobs on the
        // same cadence collide exactly when their expressions match, and any
        // difference here is a difference worth a human looking at.
        const seen = new Map<string, string[]>();
        for (const j of jobs) seen.set(j.schedule, [...(seen.get(j.schedule) ?? []), j.jobname]);

        const collisions = [...seen.entries()]
            .filter(([, names]) => names.length > 1)
            .map(([schedule, names]) => `${names.join(' + ')} all run at '${schedule}'`);

        expect(collisions, collisions.join('; ')).toEqual([]);
    });
});
