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

const THRESHOLDS: Thresholds = { freshnessMinutes: 30, stuckMinutes: 15, upstreamMinutes: 360 };
const NOW = new Date('2026-07-06T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const healthy: HeartbeatInput = {
    now: NOW,
    lastSuccesses: [
        { source: 'maplify', finishedAt: minutesAgo(4) },
        { source: 'inaturalist', finishedAt: minutesAgo(6) },
        { source: 'orcasound', finishedAt: minutesAgo(5) },
    ],
    orphans: [],
    recentSuccesses: [],
    recentTransientFailures: [],
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
                    { source: 'orcasound', finishedAt: minutesAgo(5) },
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
                lastSuccesses: [{ source: 'maplify', finishedAt: minutesAgo(4) }, { source: 'orcasound', finishedAt: minutesAgo(5) }],
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
                    { source: 'orcasound', finishedAt: minutesAgo(5) },
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
                lastSuccesses: [{ source: 'inaturalist', finishedAt: minutesAgo(90) }, { source: 'orcasound', finishedAt: minutesAgo(5) }],
                recentSuccesses: [],
                recentTransientFailures: [],
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

describe('evaluateHeartbeat: gaps between successes', () => {
    // A 5-minute cadence that stopped for an hour and came back, all of it
    // before the check ran. The stale check sees a 4-minute-old success and
    // says healthy; this is the outage that was invisible on 2026-08-28.
    const healedOutage = [
        { source: 'maplify', finishedAt: minutesAgo(74) },
        { source: 'maplify', finishedAt: minutesAgo(69) },
        { source: 'maplify', finishedAt: minutesAgo(9) },
        { source: 'maplify', finishedAt: minutesAgo(4) },
    ];

    test('an outage that healed between two checks is still reported, as a gap', () => {
        const findings = evaluateHeartbeat(
            { ...healthy, recentSuccesses: healedOutage },
            THRESHOLDS,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ kind: 'gap', source: 'maplify' });
        expect(findings[0]!.message).toContain('for 60m');
        expect(findings[0]!.message).toContain('healed 9m ago');
    });

    test('the interval from the newest success to now is staleness, not a gap', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                lastSuccesses: [
                    { source: 'maplify', finishedAt: minutesAgo(47) },
                    { source: 'inaturalist', finishedAt: minutesAgo(6) },
                    { source: 'orcasound', finishedAt: minutesAgo(5) },
                ],
                recentSuccesses: [
                    { source: 'maplify', finishedAt: minutesAgo(52) },
                    { source: 'maplify', finishedAt: minutesAgo(47) },
                ],
            },
            THRESHOLDS,
        );
        expect(findings.map((f) => f.kind)).toEqual(['stale']);
    });

    test('a gap exactly at the threshold does not trip', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                recentSuccesses: [
                    { source: 'inaturalist', finishedAt: minutesAgo(36) },
                    { source: 'inaturalist', finishedAt: minutesAgo(6) },
                ],
            },
            THRESHOLDS,
        );
        expect(findings).toEqual([]);
    });

    test('sources are measured separately, whatever order the rows arrive in', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                recentSuccesses: [
                    { source: 'inaturalist', finishedAt: minutesAgo(6) },
                    { source: 'maplify', finishedAt: minutesAgo(4) },
                    { source: 'inaturalist', finishedAt: minutesAgo(11) },
                    { source: 'maplify', finishedAt: minutesAgo(60) },
                ],
            },
            THRESHOLDS,
        );
        // maplify's 56m hole is real; inaturalist's rows interleaved with it are not.
        expect(findings.map((f) => [f.kind, f.source])).toEqual([['gap', 'maplify']]);
    });

    test('every gap in the window is reported, not just the worst', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                recentSuccesses: [
                    { source: 'maplify', finishedAt: minutesAgo(200) },
                    { source: 'maplify', finishedAt: minutesAgo(150) },
                    { source: 'maplify', finishedAt: minutesAgo(145) },
                    { source: 'maplify', finishedAt: minutesAgo(100) },
                    { source: 'maplify', finishedAt: minutesAgo(4) },
                ],
            },
            THRESHOLDS,
        );
        expect(findings.map((f) => f.kind)).toEqual(['gap', 'gap', 'gap']);
    });
});

/** A run every five minutes from `from` down to `to` minutes ago, inclusive. */
const every5 = (source: string, from: number, to: number) =>
    Array.from({ length: (from - to) / 5 + 1 }, (_, i) => ({
        source,
        finishedAt: minutesAgo(from - i * 5),
    }));

describe('evaluateHeartbeat: upstream outages', () => {
    // 2026-09-30, 04:00–04:25 UTC: iNaturalist answered 503 to six ticks in a
    // row, our side ran every one of them, and 04:30 caught up (#523).
    const maintenance: HeartbeatInput = {
        ...healthy,
        recentSuccesses: [
            { source: 'inaturalist', finishedAt: minutesAgo(46) },
            ...every5('inaturalist', 11, 1),
        ],
        recentTransientFailures: every5('inaturalist', 41, 16),
    };

    test('a short upstream outage is not news', () => {
        expect(evaluateHeartbeat(maintenance, THRESHOLDS)).toEqual([]);
    });

    test('the same hole with no transient failures in it is ours, and trips', () => {
        const findings = evaluateHeartbeat(
            { ...maintenance, recentTransientFailures: [] },
            THRESHOLDS,
        );
        expect(findings.map((f) => [f.kind, f.source])).toEqual([['gap', 'inaturalist']]);
        expect(findings[0]!.message).toContain('for 35m');
    });

    test('an ongoing upstream outage is tolerated up to the threshold', () => {
        const input = (downFor: number): HeartbeatInput => ({
            ...healthy,
            lastSuccesses: [
                { source: 'maplify', finishedAt: minutesAgo(4) },
                { source: 'inaturalist', finishedAt: minutesAgo(downFor) },
                { source: 'orcasound', finishedAt: minutesAgo(5) },
            ],
            recentSuccesses: [{ source: 'inaturalist', finishedAt: minutesAgo(downFor) }],
            recentTransientFailures: every5('inaturalist', downFor - 5, 1),
        });
        expect(evaluateHeartbeat(input(356), THRESHOLDS)).toEqual([]);
        const findings = evaluateHeartbeat(input(366), THRESHOLDS);
        expect(findings.map((f) => [f.kind, f.source])).toEqual([
            ['upstream_outage', 'inaturalist'],
        ]);
        expect(findings[0]!.message).toContain('unavailable for 366m');
    });

    test('a healed upstream outage past the threshold is reported as one', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                recentSuccesses: [
                    { source: 'inaturalist', finishedAt: minutesAgo(500) },
                    ...every5('inaturalist', 101, 1),
                ],
                recentTransientFailures: every5('inaturalist', 495, 106),
            },
            THRESHOLDS,
        );
        expect(findings.map((f) => [f.kind, f.source])).toEqual([
            ['upstream_outage', 'inaturalist'],
        ]);
        expect(findings[0]!.message).toContain('unavailable for 399m');
        expect(findings[0]!.message).toContain('healed 101m ago');
    });

    test('if our side stops during an upstream outage, that is the finding', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                lastSuccesses: [
                    { source: 'maplify', finishedAt: minutesAgo(4) },
                    { source: 'inaturalist', finishedAt: minutesAgo(400) },
                    { source: 'orcasound', finishedAt: minutesAgo(5) },
                ],
                recentSuccesses: [{ source: 'inaturalist', finishedAt: minutesAgo(400) }],
                // failing upstream, then nothing at all for the last 45 minutes
                recentTransientFailures: every5('inaturalist', 395, 45),
            },
            THRESHOLDS,
        );
        expect(findings.map((f) => [f.kind, f.source])).toEqual([['stale', 'inaturalist']]);
        expect(findings[0]!.message).toContain('in the last 45m');
    });

    test('a hole of ours inside a long outage is reported as ours, not upstream', () => {
        const findings = evaluateHeartbeat(
            {
                ...healthy,
                recentSuccesses: [
                    { source: 'inaturalist', finishedAt: minutesAgo(500) },
                    ...every5('inaturalist', 11, 1),
                ],
                // upstream failures with an hour of silence from 300m to 240m ago
                recentTransientFailures: [
                    ...every5('inaturalist', 495, 300),
                    ...every5('inaturalist', 240, 16),
                ],
            },
            THRESHOLDS,
        );
        expect(findings.map((f) => [f.kind, f.source])).toEqual([['gap', 'inaturalist']]);
        expect(findings[0]!.message).toContain('for 60m');
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
            ).toEqual([['never_succeeded', 'inaturalist'], ['never_succeeded', 'orcasound']]);
        });
    });

    test('recent successes: everything inside the lookback plus the newest before it', async () => {
        await withRollback(sql, async (tx) => {
            await tx`DELETE FROM ingest.runs`;
            await tx`
                INSERT INTO ingest.runs
                    (source, trigger, dry_run, window_start, window_end,
                     started_at, finished_at, outcome, error)
                VALUES
                    -- before the window: two, only the newer is wanted
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '200 minutes', now() - interval '199 minutes', 'success', NULL),
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '130 minutes', now() - interval '129 minutes', 'success', NULL),
                    -- inside the window, after a 60m hole
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '70 minutes', now() - interval '69 minutes', 'success', NULL),
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '51 minutes', now() - interval '50 minutes', 'success', NULL),
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '21 minutes', now() - interval '20 minutes', 'success', NULL),
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '5 minutes', now() - interval '4 minutes', 'success', NULL),
                    -- inside the window but dry-run / failed: not successes
                    ('maplify', 'manual', true, '2026-06-26', '2026-07-06',
                     now() - interval '40 minutes', now() - interval '39 minutes', 'success', NULL),
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '30 minutes', now() - interval '29 minutes', 'failed', 'boom'),
                    -- inaturalist and orcasound: fine
                    ('inaturalist', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '6 minutes', now() - interval '5 minutes', 'success', NULL),
                    ('orcasound', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '7 minutes', now() - interval '6 minutes', 'success', NULL)`;

            const input = await fetchHeartbeatInput(tx, 120);

            const maplify = input.recentSuccesses
                .filter((s) => s.source === 'maplify')
                .map((s) => Math.round((input.now.getTime() - s.finishedAt.getTime()) / 60_000))
                .sort((a, b) => a - b);
            // 4m…69m are in the window; 129m is the newest before it; 199m is not wanted
            expect(maplify).toEqual([4, 20, 50, 69, 129]);

            expect(input.recentTransientFailures).toEqual([]);

            // And the whole thing, end to end: the hole between 129m and 69m ago is a
            // gap even though maplify's newest success is 4 minutes old.
            const findings = evaluateHeartbeat(input, THRESHOLDS);
            expect(findings.map((f) => [f.kind, f.source])).toEqual([['gap', 'maplify']]);
            expect(findings[0]!.message).toContain('for 60m');
        });
    });

    test('transient failures: only failed, non-dry-run rows marked transient', async () => {
        await withRollback(sql, async (tx) => {
            await tx`DELETE FROM ingest.runs`;
            await tx`
                INSERT INTO ingest.runs
                    (source, trigger, dry_run, window_start, window_end,
                     started_at, finished_at, outcome, error, transient)
                VALUES
                    ('inaturalist', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '46 minutes', now() - interval '45 minutes', 'success', NULL, false),
                    -- upstream down: these are signs of life, not successes
                    ('inaturalist', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '31 minutes', now() - interval '30 minutes', 'failed', 'HTTP 503', true),
                    ('inaturalist', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '16 minutes', now() - interval '15 minutes', 'failed', 'HTTP 503', true),
                    -- a defect: not a sign of life
                    ('inaturalist', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '11 minutes', now() - interval '10 minutes', 'failed', 'parse', false),
                    -- a dry run: not a sign of anything
                    ('inaturalist', 'manual', true, '2026-06-26', '2026-07-06',
                     now() - interval '6 minutes', now() - interval '5 minutes', 'failed', 'HTTP 503', true),
                    ('maplify', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '5 minutes', now() - interval '4 minutes', 'success', NULL, false),
                    ('orcasound', 'cron', false, '2026-06-26', '2026-07-06',
                     now() - interval '5 minutes', now() - interval '4 minutes', 'success', NULL, false)`;

            const input = await fetchHeartbeatInput(tx, 120);
            const ages = input.recentTransientFailures
                .map((s) => [s.source, Math.round((input.now.getTime() - s.finishedAt.getTime()) / 60_000)])
                .sort((a, b) => (b[1] as number) - (a[1] as number));
            expect(ages).toEqual([['inaturalist', 30], ['inaturalist', 15]]);

            // 45m without success, but our side was alive 15m ago: not stale.
            expect(evaluateHeartbeat(input, THRESHOLDS)).toEqual([]);
        });
    });

    test('transient is refused on a run that did not fail', async () => {
        await withRollback(sql, async (tx) => {
            await expect(tx`
                INSERT INTO ingest.runs
                    (source, trigger, window_start, window_end, finished_at, outcome, transient)
                VALUES ('maplify', 'cron', '2026-06-26', '2026-07-06', now(), 'success', true)`,
            ).rejects.toThrow(/runs_transient_only_on_failure/);
        });
    });
});
