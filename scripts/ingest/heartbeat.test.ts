/**
 * Heartbeat check (salishsea-io-89d.4): the pure predicate, and the input it is
 * given from the read-path build's run log (salish-xv35.9; it read ingest.runs before).
 */

import { describe, test, expect } from 'vitest';
import {
    evaluateHeartbeat,
    heartbeatInput,
    maintenanceFinding,
    type HeartbeatInput,
    type Thresholds,
} from './heartbeat.ts';

// Maintenance mode (salish-xv35.24): a planned pause is reported, not alarmed —
// until it outlives its limit.
describe('maintenanceFinding', () => {
    const since = new Date('2026-10-04T20:00:00Z');
    test('a window inside its limit is nothing to file', () => {
        expect(maintenanceFinding(since, new Date('2026-10-05T19:59:00Z'), 24 * 60)).toBeNull();
    });
    test('exactly at the limit still passes', () => {
        expect(maintenanceFinding(since, new Date('2026-10-05T20:00:00Z'), 24 * 60)).toBeNull();
    });
    test('past it, one finding naming how long and since when', () => {
        const f = maintenanceFinding(since, new Date('2026-10-05T20:01:00Z'), 24 * 60);
        expect(f?.kind).toBe('maintenance_overrun');
        expect(f?.message).toMatch(/1441m \(since 2026-10-04T20:00:00.000Z\), longer than 1440m/);
    });
});
import type { Run, RunsFile } from '../read-path/ingest-runs.ts';

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

describe('evaluateHeartbeat: the Darwin Core archive', () => {
    const withArchive = {...THRESHOLDS, archiveMinutes: 26 * 60};

    test('an archive written within the day is fine', () => {
        expect(evaluateHeartbeat({...healthy, archivedAt: minutesAgo(20 * 60)}, withArchive)).toEqual([]);
    });

    test('one older than that, or none, is the finding', () => {
        expect(evaluateHeartbeat({...healthy, archivedAt: minutesAgo(30 * 60)}, withArchive).map((f) => [f.kind, f.source]))
            .toEqual([['archive_stale', 'dwca']]);
        expect(evaluateHeartbeat({...healthy, archivedAt: null}, withArchive).map((f) => f.kind)).toEqual(['archive_stale']);
    });
});

describe('evaluateHeartbeat: the published files', () => {
    const withPublished = {...THRESHOLDS, publishedMinutes: 30};

    test('a build that published recently is fine', () => {
        expect(evaluateHeartbeat({...healthy, publishedAt: minutesAgo(6)}, withPublished)).toEqual([]);
    });

    test('fresh ingests but files standing still is the finding: a task after the ingests failed', () => {
        const findings = evaluateHeartbeat({...healthy, publishedAt: minutesAgo(95)}, withPublished);
        expect(findings.map((f) => [f.kind, f.source])).toEqual([['unpublished', 'read-path']]);
        expect(findings[0]!.message).toContain('95m ago');
    });

    test('nothing published at all is the finding too', () => {
        expect(evaluateHeartbeat({...healthy, publishedAt: null}, withPublished).map((f) => f.kind))
            .toEqual(['unpublished']);
    });

    test('unchecked when either side is absent', () => {
        expect(evaluateHeartbeat({...healthy, publishedAt: minutesAgo(95)}, THRESHOLDS)).toEqual([]);
        expect(evaluateHeartbeat(healthy, withPublished)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// The input, from the build's run log (scripts/read-path/ingest-runs.ts)
// ---------------------------------------------------------------------------

let nextId = 1;
/** A run that started `startedMinutesAgo` and, unless `finishedMinutesAgo` is null, ended. */
function run(
    source: Run['source'], startedMinutesAgo: number, finishedMinutesAgo: number | null,
    outcome: Run['outcome'], transient: boolean | null = null,
): Run {
    return {
        id: nextId++, source, trigger: 'cron',
        started_at: minutesAgo(startedMinutesAgo).toISOString(),
        finished_at: finishedMinutesAgo === null ? null : minutesAgo(finishedMinutesAgo).toISOString(),
        outcome, transient, rows_changed: outcome === 'success' ? 0 : null, error: outcome === 'failed' ? 'boom' : null,
    };
}

/** The file as the build writes it: last_success from the runs given, unless overridden. */
function file(runs: Run[], lastSuccess?: RunsFile['last_success']): RunsFile {
    const last: RunsFile['last_success'] = {};
    for (const r of runs) {
        if (r.outcome === 'success' && r.finished_at && (!last[r.source] || last[r.source]! < r.finished_at))
            last[r.source] = r.finished_at;
    }
    return {version: 1, written_at: NOW.toISOString(), runs, last_success: lastSuccess ?? last};
}

describe('heartbeatInput (the build\'s run log)', () => {
    test('a failed run is no success; an unfinished one is an orphan', () => {
        const input = heartbeatInput(file([
            run('maplify', 20, 19, 'success'),
            run('maplify', 3, 2, 'failed'),
            run('inaturalist', 6, 5, 'success'),
            run('inaturalist', 45, null, null),
        ]), NOW);
        const bySource = new Map(input.lastSuccesses.map((s) => [s.source, s.finishedAt]));
        expect(bySource.get('maplify')).toEqual(minutesAgo(19));
        expect(input.orphans).toHaveLength(1);
        expect(input.orphans[0]).toMatchObject({source: 'inaturalist', trigger: 'cron', dryRun: false});
    });

    test('a source with no runs has no lastSuccess entry', () => {
        const input = heartbeatInput(file([run('maplify', 2, 1, 'success')]), NOW);
        expect(input.lastSuccesses.map((s) => s.source)).toEqual(['maplify']);
        expect(evaluateHeartbeat(input, THRESHOLDS).map((f) => [f.kind, f.source]))
            .toEqual([['never_succeeded', 'inaturalist'], ['never_succeeded', 'orcasound']]);
    });

    test('ages are measured against the checker\'s clock: a build that stopped reads as stale', () => {
        // The file was last written two hours ago, when everything was fine.
        const twoHoursLate = new Date(NOW.getTime() + 120 * 60_000);
        const input = heartbeatInput(file([
            run('maplify', 5, 4, 'success'), run('inaturalist', 5, 4, 'success'), run('orcasound', 5, 4, 'success'),
        ]), twoHoursLate);
        expect(evaluateHeartbeat(input, THRESHOLDS).map((f) => f.kind)).toEqual(['stale', 'stale', 'stale']);
    });

    test('recent successes: everything inside the lookback plus the newest before it', () => {
        const input = heartbeatInput(file([
            run('maplify', 200, 199, 'success'),
            run('maplify', 130, 129, 'success'),
            run('maplify', 70, 69, 'success'),
            run('maplify', 51, 50, 'success'),
            run('maplify', 21, 20, 'success'),
            run('maplify', 5, 4, 'success'),
            run('maplify', 30, 29, 'failed'),
            run('inaturalist', 6, 5, 'success'),
            run('orcasound', 7, 6, 'success'),
        ]), NOW, 120);
        const maplify = input.recentSuccesses
            .filter((s) => s.source === 'maplify')
            .map((s) => Math.round((NOW.getTime() - s.finishedAt.getTime()) / 60_000))
            .sort((a, b) => a - b);
        // 4m…69m are in the window; 129m is the newest before it; 199m is not wanted
        expect(maplify).toEqual([4, 20, 50, 69, 129]);
        expect(input.recentTransientFailures).toEqual([]);
        const findings = evaluateHeartbeat(input, THRESHOLDS);
        expect(findings.map((f) => [f.kind, f.source])).toEqual([['gap', 'maplify']]);
        expect(findings[0]!.message).toContain('for 60m');
    });

    test('transient failures: only failed runs marked transient', () => {
        const input = heartbeatInput(file([
            run('inaturalist', 46, 45, 'success'),
            // upstream down: these are signs of life, not successes
            run('inaturalist', 31, 30, 'failed', true),
            run('inaturalist', 16, 15, 'failed', true),
            // a defect, or a run interrupted by a restart: not a sign of life
            run('inaturalist', 11, 10, 'failed', false),
            run('maplify', 5, 4, 'success'),
            run('orcasound', 5, 4, 'success'),
        ]), NOW, 120);
        const ages = input.recentTransientFailures
            .map((s) => [s.source, Math.round((NOW.getTime() - s.finishedAt.getTime()) / 60_000)])
            .sort((a, b) => (b[1] as number) - (a[1] as number));
        expect(ages).toEqual([['inaturalist', 30], ['inaturalist', 15]]);
        // 45m without success, but our side was alive 15m ago: not stale.
        expect(evaluateHeartbeat(input, THRESHOLDS)).toEqual([]);
    });

    test('last success comes from the file, which reaches further back than its runs', () => {
        const input = heartbeatInput(file([], {maplify: minutesAgo(3000).toISOString()}), NOW);
        expect(input.lastSuccesses).toEqual([{source: 'maplify', finishedAt: minutesAgo(3000)}]);
    });
});
