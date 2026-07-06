/**
 * Heartbeat check (salishsea-io-89d.4): unit tier for the pure predicate,
 * integration tier for the ingest.runs reads (decision 011's two tiers).
 *
 * The integration suite runs against local Supabase, gated on SUPABASE_DB_URL
 * (set by build.yml in CI; skips on a fresh checkout). It empties and reseeds
 * ingest.runs INSIDE a transaction that is always rolled back, so results are
 * deterministic regardless of prior local runs and the DB is left untouched.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';
import {
    evaluateHeartbeat,
    fetchHeartbeatInput,
    type HeartbeatInput,
    type Thresholds,
} from './heartbeat.ts';

const THRESHOLDS: Thresholds = { freshnessMinutes: 30, stuckMinutes: 15 };
const NOW = new Date('2026-07-06T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const healthy: HeartbeatInput = {
    now: NOW,
    lastSuccesses: [
        { source: 'maplify', finishedAt: minutesAgo(4) },
        { source: 'inaturalist', finishedAt: minutesAgo(6) },
    ],
    orphans: [],
};

describe('evaluateHeartbeat', () => {
    test('fresh successes for every source, no orphans → healthy', () => {
        expect(evaluateHeartbeat(healthy, THRESHOLDS)).toEqual([]);
    });

    test('one stale source trips only that source', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                lastSuccesses: [
                    { source: 'maplify', finishedAt: minutesAgo(47) },
                    { source: 'inaturalist', finishedAt: minutesAgo(6) },
                ],
            },
            THRESHOLDS,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ kind: 'stale', source: 'maplify' });
        expect(findings[0]!.message).toContain('47m ago');
    });

    test('a source with no success at all → never_succeeded', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                lastSuccesses: [{ source: 'maplify', finishedAt: minutesAgo(4) }],
            },
            THRESHOLDS,
        );
        expect(findings).toEqual([
            expect.objectContaining({ kind: 'never_succeeded', source: 'inaturalist' }),
        ]);
    });

    test('age exactly at the freshness threshold does not trip', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                lastSuccesses: [
                    { source: 'maplify', finishedAt: minutesAgo(30) },
                    { source: 'inaturalist', finishedAt: minutesAgo(6) },
                ],
            },
            THRESHOLDS,
        );
        expect(findings).toEqual([]);
    });

    test('an orphan older than stuckMinutes → stuck', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                orphans: [
                    {
                        id: 42,
                        source: 'maplify',
                        trigger: 'cron',
                        dryRun: false,
                        startedAt: minutesAgo(22),
                    },
                ],
            },
            THRESHOLDS,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ kind: 'stuck', source: 'maplify' });
        expect(findings[0]!.message).toContain('run #42');
    });

    test('a young orphan is a run in flight, not a finding', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                orphans: [
                    {
                        id: 43,
                        source: 'inaturalist',
                        trigger: 'cron',
                        dryRun: false,
                        startedAt: minutesAgo(3),
                    },
                ],
            },
            THRESHOLDS,
        );
        expect(findings).toEqual([]);
    });

    test('stale and stuck findings accumulate', () => {
        const findings = evaluateHeartbeat(
            {
                now: NOW,
                lastSuccesses: [{ source: 'inaturalist', finishedAt: minutesAgo(90) }],
                orphans: [
                    {
                        id: 7,
                        source: 'maplify',
                        trigger: 'manual',
                        dryRun: true,
                        startedAt: minutesAgo(60),
                    },
                ],
            },
            THRESHOLDS,
        );
        expect(findings.map((f) => f.kind).sort()).toEqual([
            'never_succeeded',
            'stale',
            'stuck',
        ]);
    });
});

// ---------------------------------------------------------------------------
// Integration: the reads against local Supabase
// ---------------------------------------------------------------------------

const DSN = process.env['SUPABASE_DB_URL'];

/** Run fn in a transaction that is ALWAYS rolled back. */
class Rollback extends Error {}
async function withRollback(sql: Sql, fn: (tx: TransactionSql) => Promise<void>): Promise<void> {
    await sql
        .begin(async (tx) => {
            await fn(tx);
            throw new Rollback();
        })
        .catch((err: unknown) => {
            if (!(err instanceof Rollback)) throw err;
        });
}

describe.skipIf(!DSN)('fetchHeartbeatInput (local Supabase)', () => {
    let sql: Sql;

    beforeAll(() => {
        sql = postgres(DSN as string, { prepare: false, max: 1 });
    });

    afterAll(async () => {
        await sql.end();
    });

    test('excludes dry-run and failed runs from last success; surfaces orphans', async () => {
        await withRollback(sql, async (tx) => {
            await tx`DELETE FROM ingest.runs`;
            await tx`
                INSERT INTO ingest.runs
                    (source, trigger, dry_run, window_start, window_end,
                     started_at, finished_at, outcome, error)
                VALUES
                    -- the real last success for maplify
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '20 minutes', now() - interval '19 minutes', 'success', NULL),
                    -- newer, but dry-run: must NOT count as freshness
                    ('maplify', 'manual', true, '2026-06-26', '2026-07-06',
                     now() - interval '5 minutes', now() - interval '4 minutes', 'success', NULL),
                    -- newer, but failed: must NOT count either
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '3 minutes', now() - interval '2 minutes', 'failed', 'boom'),
                    -- inaturalist success
                    ('inaturalist', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '6 minutes', now() - interval '5 minutes', 'success', NULL),
                    -- an orphan: started, never finished
                    ('inaturalist', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '45 minutes', NULL, NULL, NULL)`;

            const input = await fetchHeartbeatInput(tx);

            expect(input.now).toBeInstanceOf(Date);

            const bySource = new Map(input.lastSuccesses.map((s) => [s.source, s.finishedAt]));
            const maplifyAge = input.now.getTime() - bySource.get('maplify')!.getTime();
            // ~19 minutes, i.e. the non-dry-run success — not the 4m dry run or 2m failure
            expect(maplifyAge).toBeGreaterThan(18 * 60_000);
            expect(bySource.get('inaturalist')).toBeInstanceOf(Date);

            expect(input.orphans).toHaveLength(1);
            expect(input.orphans[0]).toMatchObject({
                source: 'inaturalist',
                trigger: 'cron',
                dryRun: false,
            });
            expect(typeof input.orphans[0]!.id).toBe('number');
        });
    });

    test('a source with no rows simply has no lastSuccess entry', async () => {
        await withRollback(sql, async (tx) => {
            await tx`DELETE FROM ingest.runs`;
            await tx`
                INSERT INTO ingest.runs
                    (source, trigger, dry_run, window_start, window_end,
                     started_at, finished_at, outcome)
                VALUES ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                        now() - interval '2 minutes', now() - interval '1 minutes', 'success')`;

            const input = await fetchHeartbeatInput(tx);
            expect(input.lastSuccesses.map((s) => s.source)).toEqual(['maplify']);
            expect(
                evaluateHeartbeat(input, THRESHOLDS).map((f) => [f.kind, f.source]),
            ).toEqual([['never_succeeded', 'inaturalist']]);
        });
    });
});
