# 012 — Ingest heartbeat: an external observer via scheduled GitHub Action

**Status:** accepted, amended by [060](060-an-upstream-outage-is-held-to-a-longer-threshold.md) and below (2026-10-07) · **Decided:** 2026-07-06

**Amended 2026-10-07: whether the build is publishing is watched by a Sentry cron monitor** (bd `salish-d7tr`). This record expected detection "roughly 30–60 minutes" after a stall. By October GitHub ran the `*/30` heartbeat four to six hours apart: five runs on 2026-10-06. A 46-minute stall that night, the whales page failing every build and holding `manifest.json` back with it, fell between two runs and was never reported. Each scheduled build on the Fly machine now checks in to the Sentry monitor `read-path-build` ([`fly/build.sh`](../../fly/build.sh)): `ok` when it rewrote the manifest, `error` when it didn't. A build that never runs checks in nothing, and Sentry counts that as missed, so the monitor still catches the case this record exists for: a schedule that stops. Six check-ins in a row without an `ok` (half an hour) open an issue. The rejection below assumed Sentry would be a second channel added for this alone. The site already reports to Sentry, and a channel that fires in half an hour is worth more than a single channel that fires in hours. The check-ins are unauthenticated, posted with the DSN's public key as the site's error events are, so anyone could post an `ok` and mask a stall; the monitor guards against the build failing, not against someone hiding that it has. The heartbeat stays, for the checks Sentry can't make from a build's exit: per-source freshness, gaps between successes, upstream outages, the archive's age, and planned maintenance, which the monitor has to be muted for ([runbook](../runbook/read-path-build.md#is-the-build-publishing-the-sentry-cron-monitor)).

## Context

Decision [011](011-ingest-imperative-shell.md) anticipated a heartbeat/freshness alert as a
cheap follow-on once `ingest.runs` existed, closing the silent-stop gap Sentry alone can't
catch: a cron that stops firing throws no exception. The 2026-07-06 cutover proved the gap
immediately — prod `pg_cron` failed for ~10 minutes on a missing `pg_net` extension, silently,
and was caught only by active polling.

Two failure modes need coverage, both readable from `ingest.runs` (decision 011's write
protocol):

- **Stale**: the newest successful non-dry-run run per source is older than a threshold —
  the cron stopped firing, or every run is failing.
- **Stuck**: a run has `started_at` but no `finished_at` past a threshold — the started-orphan
  pattern; the shell crashed or hung between opening and resolving the audit row.
- **Gap** *(added 2026-09-10, see below)*: two consecutive successful runs for a source were
  further apart than the freshness threshold, at any point in the last day.

## Decision

A **scheduled GitHub Action** (`.github/workflows/ingest-heartbeat.yml`, every 30 minutes)
runs [`scripts/ingest/heartbeat.ts`](../../scripts/ingest/heartbeat.ts) against prod over the
session pooler and **fails loudly by filing/updating a labeled GitHub issue**
(`ingest-heartbeat-failed`), the same alert channel as the DwC-A nightly guard.

- The check must live **outside the database**: `pg_cron` cannot observe its own death, and
  the pg_net incident was precisely a scheduler-side failure. GitHub Actions is the external
  scheduler this repo already operates.
- GitHub cron's best-effort lateness (10–30 min) — the reason it was rejected as the *ingest*
  host in 011 — is acceptable for the *observer*: staleness is measured against the DB
  server's clock, so a late check delays detection but never falsifies it.
- Structure follows 011: a pure, unit-tested predicate (`evaluateHeartbeat`) over fetched
  rows; a thin shell that connects, fetches, and reports. Integration tests run the real
  reads against local Supabase inside a rolled-back transaction.
- Thresholds: freshness 30 min (six consecutive missed 5-minute runs), stuck 15 min (an Edge
  Function's wall clock is minutes at most). Dry-run successes don't count toward freshness —
  they write nothing. Both env-overridable in the workflow.
- A DB-unreachable check run also files the issue (fail-loud default body) — unreachability
  is itself an ingest outage.

## Rejected alternatives

- **pg_cron self-check** (a SQL job raising on staleness). Cannot catch the scheduler dying,
  which is the primary threat; also has no notification channel of its own.
- **Sentry cron monitors / check-ins.** A capable fit, but a new external dependency and
  configuration surface; the repo already alerts via labeled GitHub issues for the DwC-A
  nightly, and one channel beats two. Revisit if/when Sentry gains the server-side ingest
  surface planned in 011.
- **Alerting from inside the ingest Edge Function.** The function can report its own failures
  (Sentry will cover that), but by definition never runs when the cron is dead.

## Consequences

- Detection latency is bounded by check cadence + GitHub cron lateness: roughly 30–60 minutes
  after the freshness window is exceeded, which fits the self-healing 10-day window design.
- The heartbeat reuses the production environment's existing `DB_PASSWORD` /
  `SUPABASE_PROJECT_ID`; no new secrets.
- An open `ingest-heartbeat-failed` issue is updated, not duplicated, on repeated failures.

## Reference

Issue: `salish-89d.4`. Substrate: `ingest.runs`
([20260705130000_ingest_runs.sql](../../supabase/migrations/20260705130000_ingest_runs.sql)).
Alert-channel precedent: [003](003-dwc-export-pipeline.md) (DwC-A nightly failure issue).

## Amended 2026-09-10 — the observer's lateness did falsify detection (bd `salish-oyf`)

The claim above, that a late check "delays detection but never falsifies it", holds for an
outage that is still going on when the check runs and not for one that healed between two
checks. Both ingest sources stopped for 60 minutes on 2026-08-28, 15:50 → 16:50 UTC, twice the
freshness threshold, and no alert was filed: the only heartbeat run between 14:30 and 18:00
was at 17:35, by which time the newest success was minutes old.

The lateness is also much worse than the "10–30 min" this record assumed. Over 2026-08-23 →
09-10 the workflow ran 200 times where the schedule asked for about 890: a median of 68
minutes between checks, a 90th percentile of five hours, and a longest silence of 12.5 hours.
GitHub drops scheduled runs rather than queueing them, so a 30-minute schedule is a request,
not a cadence.

**Decision.** A third check, **gap**: `heartbeat.ts` reads every successful non-dry-run finish
within a lookback window (24 hours, `LOOKBACK_MINUTES`) plus the newest one before it per
source, and trips on any interval between consecutive successes longer than the freshness
threshold. `ingest.runs` keeps the history, so the check sees what happened since, not just
the age now; detection no longer depends on when the observer happens to run, which is the
property the original design assumed it had. The window is a day because it must exceed the
longest silence between checks with margin, or a gap can still fall between them.

A healed gap keeps tripping until it ages out of the window — the price of the window being
long — so the workflow now closes the `ingest-heartbeat-failed` issue when a check passes,
as `deploy.yml` does for `deploy-failed`. An open issue thereby means the last check tripped,
not that something tripped once: #378 sat open for 18 days after its outage healed, and
because the workflow updates an open issue rather than filing a new one, it would have
absorbed the next alert silently.

**Rejected.** *Measuring since the previous check* (reading the last workflow run's time from
the Actions API) — exact, but it makes the window depend on the observer's own history, needs
another permission, and gives a check that failed before evaluating nothing to measure from.
*A shorter window with a more frequent schedule* — the schedule is not honoured now; asking
for more of it does not make it so.

*Amended 2026-10-03 (`salish-xv35.9`, [decision 061](061-ingest-and-derivation-move-into-the-build.md)):* the ingest runs in the read-path build on the Fly app, so the heartbeat reads the build's run log ([`scripts/read-path/ingest-runs.ts`](../../scripts/read-path/ingest-runs.ts)), served at `/status/ingest-runs.json`, instead of `ingest.runs`. The checks are the same. Ages are measured against the checker's clock rather than the file's, so a build that stopped entirely reads as stale. A run left unfinished by a restart is closed as interrupted when the source's next run starts, so "stuck" still means nothing has run since.

*Amended 2026-10-04 (`salish-xv35.24`):* the build machine has a maintenance mode in which the site keeps serving its last published files and the builds are paused on purpose (`fly/start.sh`; the [runbook](../runbook/read-path-build.md)). It publishes `/status/maintenance.json` with the moment it began; the heartbeat reads that first and, finding it, reports the window and checks nothing else — every other check would trip, and none would be news — unless the window has run past `MAINTENANCE_MINUTES` (a day), which files `maintenance_overrun`: the one way a planned pause becomes a problem.
