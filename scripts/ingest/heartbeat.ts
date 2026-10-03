/**
 * Ingest heartbeat/freshness check (salishsea-io-89d.4 / decisions 011, 012).
 *
 * Queries ingest.runs and exits non-zero when either silent-failure mode is live:
 *   - STALE:  the newest successful non-dry-run run for a source is older than
 *             FRESHNESS_MINUTES (or the source has no successful run at all).
 *             Catches a cron that stopped firing — the gap Sentry can't see,
 *             because a job that never runs throws no exception.
 *   - STUCK:  a run has started_at but no finished_at for longer than
 *             STUCK_MINUTES (decision 011's started-orphan pattern: the audit
 *             row is written outside the data txn, so a crashed/hung run leaves
 *             a visible orphan).
 *   - GAP:    within the last LOOKBACK_MINUTES, two consecutive runs for a
 *             source that were either successful or failed transiently were
 *             more than FRESHNESS_MINUTES apart. STALE only
 *             sees an outage that is still going on when the check happens to
 *             run, and this observer's schedule is best-effort: over 2026-08-23
 *             → 09-10 the median interval between checks was 68 minutes and the
 *             longest 12.5 hours, against a nominal 30. A 60-minute outage on
 *             2026-08-28 healed between two checks and was never seen
 *             (salish-oyf). ingest.runs keeps the history, so the check reads
 *             the worst gap since, not just the age now — detection no longer
 *             depends on when the observer runs.
 *   - UPSTREAM_OUTAGE: no successful run for UPSTREAM_MINUTES, while our side
 *             kept running and every failure was transient (decision 042's
 *             classifier, recorded on the row). The source is down, not us —
 *             iNaturalist's maintenance returns 503 for half an hour or more,
 *             which is not news until it has lasted long enough for the map to
 *             look stale (decision 060). Reported ongoing or healed, like the
 *             stale/gap pair above.
 *
 * STALE and GAP measure OUR pipeline, so a transient failure counts as a sign
 * of life there: the cron fired, the function ran, it recorded an outcome, and
 * the fault was upstream. A failure that is not transient does not count — a
 * defect that keeps every run failing is ours, and trips at FRESHNESS_MINUTES.
 *
 * Invoked by .github/workflows/ingest-heartbeat.yml on a schedule, against prod
 * via SUPABASE_DB_URL (session pooler). Staleness is measured against the DB
 * server's clock (SELECT now()), not the runner's, so clock skew can't lie.
 *
 * On trip: writes a human-readable report to dist/ingest/heartbeat-report.txt
 * (the workflow files it as a GitHub issue) and exits 1.
 *
 * Security: NEVER log the DSN — errors are scrubbed via maskDsn() (T-7-01,
 * same rule as scripts/dwca/guard.ts).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';

// ---------------------------------------------------------------------------
// Constants (env-overridable; the workflow sets both explicitly)
// ---------------------------------------------------------------------------

const REPORT_PATH = 'dist/ingest/heartbeat-report.txt';

/** Sources the ingest pipeline must keep fresh — mirrors the ingest.runs CHECK. */
export const SOURCES = ['maplify', 'inaturalist', 'orcasound'] as const;

/** Cron fires every 5 min; 30 min of no success = 6 consecutive missed/failed runs. */
const FRESHNESS_MINUTES = Number(process.env['FRESHNESS_MINUTES'] ?? 30);

/** Edge Function wall clock tops out well under 15 min; older unfinished = dead. */
const STUCK_MINUTES = Number(process.env['STUCK_MINUTES'] ?? 15);

/**
 * How far back the gap check looks. Must exceed the longest interval between two
 * checks, or a gap can fall between them unseen — 12.5 hours observed, so a day.
 * The price is that a healed gap keeps tripping until it ages out of the window;
 * the workflow closes the issue again once a check passes.
 */
const LOOKBACK_MINUTES = Number(process.env['LOOKBACK_MINUTES'] ?? 24 * 60);

/**
 * How long a source may be down — every run failing transiently — before it is
 * news (decision 060). The ten-day window re-covers any outage shorter than
 * that, so this is not about data loss; it is about a person noticing the map
 * has gone stale before a visitor does.
 */
const UPSTREAM_MINUTES = Number(process.env['UPSTREAM_MINUTES'] ?? 6 * 60);

// ---------------------------------------------------------------------------
// Functional core — pure evaluation over already-fetched rows
// ---------------------------------------------------------------------------

export type Thresholds = {
    readonly freshnessMinutes: number;
    readonly stuckMinutes: number;
    readonly upstreamMinutes: number;
};

export type SuccessAt = {
    readonly source: string;
    readonly finishedAt: Date;
};

/** A failed run the fetch layer classified as transient (decision 042). */
export type TransientFailureAt = SuccessAt;

export type LastSuccess = {
    readonly source: string;
    readonly finishedAt: Date;
};

export type OrphanRun = {
    readonly id: number;
    readonly source: string;
    readonly trigger: string;
    readonly dryRun: boolean;
    readonly startedAt: Date;
};

export type HeartbeatInput = {
    /** DB server clock at query time — the reference for all age math. */
    readonly now: Date;
    /** Newest successful non-dry-run finished_at per source (absent = never succeeded). */
    readonly lastSuccesses: readonly LastSuccess[];
    /** All runs with no finished_at, oldest first. */
    readonly orphans: readonly OrphanRun[];
    /**
     * Every successful non-dry-run finish inside the lookback window, plus the
     * newest one before it per source so a gap straddling the window's start
     * is measured whole. Any order; the predicate sorts.
     */
    readonly recentSuccesses: readonly SuccessAt[];
    /**
     * Every transient non-dry-run failure inside the lookback window, plus the
     * newest one before it per source — the same shape as recentSuccesses, so
     * the newest of either is always present.
     */
    readonly recentTransientFailures: readonly TransientFailureAt[];
};

export type Finding = {
    readonly kind: 'never_succeeded' | 'stale' | 'stuck' | 'gap' | 'upstream_outage';
    readonly source: string;
    readonly message: string;
};

const minutesBetween = (from: Date, to: Date): number =>
    Math.round((to.getTime() - from.getTime()) / 60_000);

/**
 * The heartbeat predicate. Healthy = empty array. An orphan younger than
 * stuckMinutes is a run legitimately in flight and produces no finding; ages
 * exactly at a threshold do not trip (strictly-older-than semantics).
 */
export function evaluateHeartbeat(input: HeartbeatInput, thresholds: Thresholds): Finding[] {
    const findings: Finding[] = [];
    const bySource = new Map(input.lastSuccesses.map((s) => [s.source, s.finishedAt]));
    const finishesOf = (rows: readonly SuccessAt[], source: string): Date[] =>
        rows
            .filter((r) => r.source === source)
            .map((r) => r.finishedAt)
            .sort((a, b) => a.getTime() - b.getTime());

    for (const source of SOURCES) {
        const lastSuccess = bySource.get(source);
        if (lastSuccess === undefined) {
            findings.push({
                kind: 'never_succeeded',
                source,
                message: `no successful (non-dry-run) ${source} run recorded at all`,
            });
            continue;
        }

        const successes = finishesOf(input.recentSuccesses, source);
        // Signs that our side ran: a success, or a failure that was upstream's.
        const alive = [...successes, ...finishesOf(input.recentTransientFailures, source)]
            .sort((a, b) => a.getTime() - b.getTime());

        // Holes on our side, healed. The interval from the newest sign of life
        // to now is the stale check below, not a gap: a gap is over by
        // definition, so it is reported as healed, with when.
        const ourGaps: [Date, Date][] = [];
        for (let i = 1; i < alive.length; i++) {
            const from = alive[i - 1]!;
            const to = alive[i]!;
            const gapMinutes = minutesBetween(from, to);
            if (gapMinutes > thresholds.freshnessMinutes) {
                ourGaps.push([from, to]);
                findings.push({
                    kind: 'gap',
                    source,
                    message:
                        `no ${source} run succeeded, or failed for an upstream reason, for ` +
                        `${gapMinutes}m, between ${from.toISOString()} and ${to.toISOString()} ` +
                        `(threshold ${thresholds.freshnessMinutes}m); healed ` +
                        `${minutesBetween(to, input.now)}m ago`,
                });
            }
        }
        // A hole of our own inside an interval without success makes the
        // interval ours, and it is already reported; the source is not to blame.
        const oursWithin = (from: Date, to: Date) =>
            ourGaps.some(([f, t]) => f >= from && t <= to);

        // Our pipeline, now. If it has stopped, that is the finding, and how
        // long ago the source last succeeded adds nothing.
        const newest = alive.at(-1);
        const lastAlive = newest !== undefined && newest > lastSuccess ? newest : lastSuccess;
        const aliveAge = minutesBetween(lastAlive, input.now);
        const successAge = minutesBetween(lastSuccess, input.now);
        if (aliveAge > thresholds.freshnessMinutes) {
            findings.push({
                kind: 'stale',
                source,
                message:
                    lastAlive === lastSuccess
                        ? `newest successful ${source} run finished ${successAge}m ago ` +
                          `(threshold ${thresholds.freshnessMinutes}m)`
                        : `newest successful ${source} run finished ${successAge}m ago, and no run ` +
                          `has failed for an upstream reason in the last ${aliveAge}m either ` +
                          `(threshold ${thresholds.freshnessMinutes}m)`,
            });
        } else if (successAge > thresholds.upstreamMinutes && !oursWithin(lastSuccess, input.now)) {
            findings.push({
                kind: 'upstream_outage',
                source,
                message:
                    `${source} has been unavailable for ${successAge}m: every run since ` +
                    `${lastSuccess.toISOString()} failed transiently (threshold ${thresholds.upstreamMinutes}m)`,
            });
        }

        // The source, healed.
        for (let i = 1; i < successes.length; i++) {
            const from = successes[i - 1]!;
            const to = successes[i]!;
            const gapMinutes = minutesBetween(from, to);
            if (gapMinutes > thresholds.upstreamMinutes && !oursWithin(from, to)) {
                findings.push({
                    kind: 'upstream_outage',
                    source,
                    message:
                        `${source} was unavailable for ${gapMinutes}m, between ` +
                        `${from.toISOString()} and ${to.toISOString()}, every run failing ` +
                        `transiently (threshold ${thresholds.upstreamMinutes}m); healed ` +
                        `${minutesBetween(to, input.now)}m ago`,
                });
            }
        }
    }

    for (const orphan of input.orphans) {
        const ageMinutes = minutesBetween(orphan.startedAt, input.now);
        if (ageMinutes > thresholds.stuckMinutes) {
            findings.push({
                kind: 'stuck',
                source: orphan.source,
                message:
                    `run #${orphan.id} (${orphan.source}, trigger=${orphan.trigger}` +
                    `${orphan.dryRun ? ', dry-run' : ''}) started ${ageMinutes}m ago ` +
                    `and never finished (threshold ${thresholds.stuckMinutes}m)`,
            });
        }
    }

    return findings;
}

// ---------------------------------------------------------------------------
// Shell — fetch, evaluate, report
// ---------------------------------------------------------------------------

/**
 * The five reads behind the predicate. dry_run runs are excluded here
 * (they prove the pipeline runs but write nothing, so they don't make data
 * fresh); a failed run counts only as a transient failure, and only if the
 * fetch layer marked it so (decision 042). The last-success query walks
 * runs_source_finished_idx (partial on outcome = 'success'); so does the
 * recent-success one, as a range on its second column.
 *
 * Accepts a plain connection or a transaction (postgres.js types them as
 * unrelated siblings) so the integration test can call it inside a rollback.
 */
export async function fetchHeartbeatInput(
    sql: Sql | TransactionSql,
    lookbackMinutes = LOOKBACK_MINUTES,
): Promise<HeartbeatInput> {
    const [nowRow] = await sql<{ db_now: Date }[]>`SELECT now() AS db_now`;
    const successRows = await sql<{ source: string; finished_at: Date }[]>`
        SELECT source, max(finished_at) AS finished_at
        FROM ingest.runs
        WHERE outcome = 'success' AND NOT dry_run
        GROUP BY source`;
    const orphanRows = await sql<
        { id: number; source: string; trigger: string; dry_run: boolean; started_at: Date }[]
    >`
        SELECT id, source, trigger, dry_run, started_at
        FROM ingest.runs
        WHERE finished_at IS NULL
        ORDER BY started_at`;
    // Inside the window, plus one before it per source (the newest), so the
    // first in-window interval is measured from a real event rather than from
    // the window's edge. Successes and transient failures alike.
    const recentFinishes = (kind: ReturnType<typeof sql>) => sql<
        { source: string; finished_at: Date }[]
    >`
        WITH window_start AS (
            SELECT now() - make_interval(mins => ${lookbackMinutes}) AS at
        ), finishes AS (
            SELECT source, finished_at
            FROM ingest.runs
            WHERE NOT dry_run AND ${kind}
        )
        SELECT source, finished_at
        FROM finishes, window_start
        WHERE finished_at > window_start.at
        UNION ALL
        SELECT source, max(finished_at)
        FROM finishes, window_start
        WHERE finished_at <= window_start.at
        GROUP BY source`;
    const recentRows = await recentFinishes(sql`outcome = 'success'`);
    const transientRows = await recentFinishes(sql`outcome = 'failed' AND transient`);

    return {
        now: nowRow!.db_now,
        lastSuccesses: successRows.map((r) => ({ source: r.source, finishedAt: r.finished_at })),
        recentSuccesses: recentRows.map((r) => ({ source: r.source, finishedAt: r.finished_at })),
        recentTransientFailures: transientRows.map((r) => ({
            source: r.source,
            finishedAt: r.finished_at,
        })),
        orphans: orphanRows.map((r) => ({
            id: Number(r.id),
            source: r.source,
            trigger: r.trigger,
            dryRun: r.dry_run,
            startedAt: r.started_at,
        })),
    };
}

/** Mask the password in any DSN-shaped substring (mirrors scripts/dwca/guard.ts). */
function maskDsn(s: string): string {
    const masked = s.replace(/\b(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]+(@)/gi, '$1***$2');
    if (masked !== s) return masked;
    return s.includes('://') ? '<redacted>' : s;
}

function reportBody(findings: readonly Finding[], input: HeartbeatInput): string {
    const lines = findings.map((f) => `- [${f.kind}] ${f.message}`).join('\n');
    return (
        `Ingest heartbeat tripped at ${input.now.toISOString()} (DB clock)\n\n` +
        `${lines}\n\n` +
        `stale / never_succeeded: the pg_cron → pg_net → Edge Function ingest has stopped\n` +
        `producing successful runs for that source. stuck: a run crashed or hung mid-flight\n` +
        `(started row never got its outcome — decision 011's orphan pattern). gap: it\n` +
        `stopped and started again between two checks; the outage is over, but it happened,\n` +
        `and this is the only place it will be reported. A gap keeps tripping until it is\n` +
        `older than the lookback window; the issue closes itself once a check passes.\n` +
        `upstream_outage: our side kept running, but every run failed because the source\n` +
        `was unavailable, for longer than we tolerate (decision 060). Check the source's\n` +
        `status before ours; nothing is lost if it comes back within ten days.\n\n` +
        `Diagnose (npx supabase db query --linked, or psql via the session pooler):\n` +
        `  SELECT * FROM ingest.runs ORDER BY started_at DESC LIMIT 20;\n` +
        `  SELECT jobname, status, return_message, start_time FROM cron.job_run_details\n` +
        `    ORDER BY start_time DESC LIMIT 20;\n` +
        `  SELECT id, status_code, error_msg, created FROM net._http_response\n` +
        `    ORDER BY created DESC LIMIT 20;\n\n` +
        `Also check the ingest Edge Function logs in the Supabase dashboard.\n` +
        `The window self-heals: once the cause is fixed, the next successful run\n` +
        `re-fetches the whole 10-day window (decision 011).\n`
    );
}

export async function main(): Promise<void> {
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(1);
    }

    const sql = postgres(dsn, { prepare: false, max: 1 });
    let input: HeartbeatInput;
    try {
        input = await fetchHeartbeatInput(sql);
    } finally {
        await sql.end();
    }

    const thresholds: Thresholds = {
        freshnessMinutes: FRESHNESS_MINUTES,
        stuckMinutes: STUCK_MINUTES,
        upstreamMinutes: UPSTREAM_MINUTES,
    };
    const findings = evaluateHeartbeat(input, thresholds);

    if (findings.length === 0) {
        const ages = SOURCES.map((source) => {
            const hit = input.lastSuccesses.find((s) => s.source === source);
            return `${source} last success ${minutesBetween(hit!.finishedAt, input.now)}m ago`;
        }).join('; ');
        console.log(
            `heartbeat ok: ${ages}; ${input.orphans.length} run(s) in flight; no gap in the ` +
                `last ${LOOKBACK_MINUTES}m (freshness<=${thresholds.freshnessMinutes}m, ` +
                `stuck<=${thresholds.stuckMinutes}m, upstream<=${thresholds.upstreamMinutes}m)`,
        );
        return;
    }

    mkdirSync('dist/ingest', { recursive: true });
    writeFileSync(REPORT_PATH, reportBody(findings, input));
    for (const f of findings) console.error(`heartbeat tripped: [${f.kind}] ${f.message}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when invoked as a script, not when imported.
// ---------------------------------------------------------------------------

if (import.meta.main) {
    main().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[heartbeat] FAILED:', maskDsn(msg));
        process.exit(1);
    });
}
