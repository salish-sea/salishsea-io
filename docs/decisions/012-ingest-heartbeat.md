# 012 — Ingest heartbeat: an external observer via scheduled GitHub Action

**Status:** accepted · **Decided:** 2026-07-06

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

Issue: `salishsea-io-89d.4`. Substrate: `ingest.runs`
([20260705130000_ingest_runs.sql](../../supabase/migrations/20260705130000_ingest_runs.sql)).
Alert-channel precedent: [003](003-dwc-export-pipeline.md) (DwC-A nightly failure issue).
