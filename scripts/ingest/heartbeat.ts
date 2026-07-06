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
export const SOURCES = ['maplify', 'inaturalist'] as const;

/** Cron fires every 5 min; 30 min of no success = 6 consecutive missed/failed runs. */
const FRESHNESS_MINUTES = Number(process.env['FRESHNESS_MINUTES'] ?? 30);

/** Edge Function wall clock tops out well under 15 min; older unfinished = dead. */
const STUCK_MINUTES = Number(process.env['STUCK_MINUTES'] ?? 15);

// ---------------------------------------------------------------------------
// Functional core — pure evaluation over already-fetched rows
// ---------------------------------------------------------------------------

export type Thresholds = {
    readonly freshnessMinutes: number;
    readonly stuckMinutes: number;
};

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
};

export type Finding = {
    readonly kind: 'never_succeeded' | 'stale' | 'stuck';
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

    for (const source of SOURCES) {
        const finishedAt = bySource.get(source);
        if (finishedAt === undefined) {
            findings.push({
                kind: 'never_succeeded',
                source,
                message: `no successful (non-dry-run) ${source} run recorded at all`,
            });
            continue;
        }
        const ageMinutes = minutesBetween(finishedAt, input.now);
        if (ageMinutes > thresholds.freshnessMinutes) {
            findings.push({
                kind: 'stale',
                source,
                message: `newest successful ${source} run finished ${ageMinutes}m ago (threshold ${thresholds.freshnessMinutes}m)`,
            });
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
 * The three reads behind the predicate. dry_run successes are excluded here
 * (they prove the pipeline runs but write nothing, so they don't make data
 * fresh); failed runs never count. The last-success query walks
 * runs_source_finished_idx (partial on outcome = 'success').
 *
 * Accepts a plain connection or a transaction (postgres.js types them as
 * unrelated siblings) so the integration test can call it inside a rollback.
 */
export async function fetchHeartbeatInput(sql: Sql | TransactionSql): Promise<HeartbeatInput> {
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

    return {
        now: nowRow!.db_now,
        lastSuccesses: successRows.map((r) => ({ source: r.source, finishedAt: r.finished_at })),
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
        `(started row never got its outcome — decision 011's orphan pattern).\n\n` +
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
    };
    const findings = evaluateHeartbeat(input, thresholds);

    if (findings.length === 0) {
        const ages = SOURCES.map((source) => {
            const hit = input.lastSuccesses.find((s) => s.source === source);
            return `${source} last success ${minutesBetween(hit!.finishedAt, input.now)}m ago`;
        }).join('; ');
        console.log(
            `heartbeat ok: ${ages}; ${input.orphans.length} run(s) in flight ` +
                `(freshness<=${thresholds.freshnessMinutes}m, stuck<=${thresholds.stuckMinutes}m)`,
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

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[heartbeat] FAILED:', maskDsn(msg));
        process.exit(1);
    });
}
