# 011 — Network ingest as a TypeScript imperative shell over a functional core

**Status:** accepted · **Decided:** 2026-07-05 · **Amended by:** [018](018-inat-id-keyset-pagination.md) (iNaturalist completeness proof is now an id-keyset terminal-page sweep, not a `total_results` page-count sum)

## Context

All external network ingest (Maplify, iNaturalist) runs **inside Postgres**: `pg_cron`
fires SQL functions every 5 minutes that use the `http` extension to fetch upstream JSON
and `MERGE` it into the mirror schemas. This braids network I/O, control flow, taxon
mapping, dedup, and destructive writes into an environment with no exception handling, no
structured logging, no retry/backoff, and no test harness. Two data-loss defects followed
directly from that shape (`salishsea-io-t4v` blind-delete, `salishsea-io-biz` page-1
truncation). This record fixes the architecture; the two bugs are patched in place first as
urgent stopgaps and then superseded by this migration.

## Decision

Move network ingest into a TypeScript **imperative shell** (effects: fetch, retry, log,
persist, schedule) wrapping a **functional core** (pure, unit-tested transforms). Postgres
becomes a store, not an HTTP client.

### Runtime & scheduling
- The shell is a **Supabase Edge Function** (Deno). Scheduling stays in Postgres:
  `pg_cron` + `pg_net` invoke the function every 5 minutes. Cron never leaves the DB; only
  the fetch/transform/persist moves out.
- The function is also a **manually invocable ingest endpoint** for a **Curator** — accepts
  `source`, a window (`start`/`end`), and a `dry_run` flag. Cron calls it with the rolling
  10-day window and writes on; a curator calls it to force-refetch a specific window (writes
  on) or preview (dry run). The dry-run affordance and manual re-fetch are the same interface.

### Persistence
- The shell connects **directly** to Postgres over the session pooler as a **dedicated
  privileged ingest role** (not the anon/RLS path), and issues **parameterized SQL authored
  in TS**. Postgres is a genuinely dumb store; transform *and* the statements that persist it
  live in version-controlled TypeScript. No stored procedures own ingest logic.
- One **atomic transaction** wraps the upserts + reconcile delete: a run either lands its
  whole window or changes nothing. The `ingest_runs` audit row is written **outside** that
  transaction (a `started` row before, an outcome update after) so a crashed run leaves a
  visible orphan.

### The completeness / reconcile invariant (the core safety rule)
- A fetch failing and a fetch returning empty are **different**. A successful empty result
  (HTTP 200, `total_results = 0`) is **authoritative** and reconciles the window to empty. A
  **non-200, network error, unparseable body, or incomplete pagination** aborts the entire
  persist step — **write nothing** (no upsert, no delete).
- Reconcile (upsert present rows + delete rows upstream no longer returns, bounded to the
  window) happens **iff the fetch is provably complete**: every page `200` through
  `total_results`, and — for iNaturalist — the full taxon ancestor closure resolved. Any
  partial or failed fetch → abort. There is **no `partial` outcome**; partial persists cannot
  structurally happen.
- The old design's flaw was that SQL filtered `WHERE status = 200`, collapsing a non-200 to
  the same zero-row source as a legitimate empty 200. The shell distinguishes them by
  inspecting the response *before* touching the DB.

### Taxon resolution (iNaturalist)
- Resolve the **full ancestor chain to completeness in the shell before opening the
  transaction** — no HTTP inside a DB write. Core computes the missing-taxa set (pure diff);
  the shell loops fetch → recompute-still-missing until closed. A taxon-API failure counts
  against fetch-completeness (abort, write nothing).

### Retry
- **Minimal in-invocation retry**: 2–3 attempts with short backoff, honor `Retry-After` on
  429, else abort and let the next 5-minute cron be the real retry. No durable retry queue —
  the cron cadence plus self-healing 10-day windows already provide free retry with no data
  loss.

### Authorization
- A **dedicated shared trigger secret** (`INGEST_TRIGGER_SECRET`) gates *who may invoke*
  ingest; both `pg_net` and the curator's `curl` pass it. This is separate from the DB role
  the function connects with. A multi-curator JWT flow is deferred.

### Testing
- **vitest only**, two tiers on the repo's existing local-Supabase CI harness (`build.yml`
  boots the stack and passes `SUPABASE_DB_URL`):
  1. **Unit (no DB)** — the functional core: JSON → normalized rows, taxon-graph resolution,
     coordinate parsing, the completeness predicate, the reconcile diff.
  2. **Integration (local Postgres)** — the actual TS persist function against a seeded DB:
     the guarded reconcile touches **only** in-window rows, upsert idempotency, and
     abort-writes-nothing.
- The Deno shell stays thin and has no unit harness of its own; its validation is the dry-run
  mode plus a smoke invocation.

### Scope & cutover
- Migrate **Maplify first, then iNaturalist**. HappyWhale (on-demand per-encounter, not a
  cron) is **out of scope** pending a green light on the integration itself.
- **Clean atomic switch**: one migration schedules the `pg_net` invocation and
  `cron.unschedule`s the old SQL job together — never two live reconcilers. **Downtime is
  acceptable**: every run re-fetches a 10-day window via idempotent upsert, so any cutover gap
  self-heals on the first new run. Rollback is a single migration revert.

## Rejected alternatives

- **Scheduled GitHub Action (Node/tsx), matching `dwca-nightly`.** Rejected as the *host*:
  GitHub's cron floor is 5 min *and* best-effort/often 10–30 min late — unacceptable for a
  near-real-time sighting map. (Node/tsx remains the world of the pure core, which is
  runtime-agnostic and imported by both the Deno shell and vitest.)
- **Always-on worker (container).** New standing infrastructure; violates the README's
  "light, nimble, minimize volatile dependencies" principle.
- **Thin SQL upsert RPCs / PostgREST `.upsert()`** for persistence. Both re-trap ingest logic
  (or half of it) in the DB — the exact environment this migration escapes.
- **Split hot-path upsert from a separate reconcile pass.** Initially proposed, then
  rejected: it wrongly treated an empty result as dangerous. The real distinction is
  success vs. failure, not empty vs. non-empty; a guarded single path is correct and simpler.
- **pgTAP for the ingest tests.** The repo already runs DB-backed vitest tests against local
  Supabase in CI. Under "PG as dumb store," the delete-bounds invariant lives in a TS-authored
  statement that pgTAP cannot see — pgTAP would test schema *proxies* while vitest integration
  executes the operation itself. A second test language/runner fails the "minimize
  dependencies" bar for a handful of ingest statements. Reopen pgTAP only if real DB-side
  logic (RLS, triggers, named functions) returns.
- **Named SQL persist functions (to make persist pgTAP-testable).** Re-fragments the persist
  logic we deliberately consolidated into TS.

## Consequences

- Ingest holds privileged DB credentials outside the RLS path — a new, trusted access
  pattern for this codebase.
- `ingest_runs` becomes the durable per-source metrics record: `source`, `trigger`
  (cron/manual), `dry_run`, window, `started_at`/`finished_at`, `outcome` (success/failed),
  `pages_fetched`, `total_results`, `rows_upserted`, `rows_deleted`, `error`. Dry-run rows are
  recorded with would-have counts.
- A **heartbeat/freshness alert** ("no successful run in N minutes") is a follow-on, cheap
  once `ingest_runs` exists — it closes the silent-stop gap that Sentry alone can't
  (`salishsea-io-ior`).
- Sentry gains a server-side (Deno) surface for ingest exceptions.

## Reference

Epic: `salishsea-io-89d`. In-place stopgaps: `salishsea-io-t4v`, `salishsea-io-biz`.
Upstream-mirror model: [008](008-source-schemas-are-upstream-mirrors.md). Taxonomic scope:
[009](009-taxonomic-scope-marine-mammals.md). Export/test-harness precedent:
[003](003-dwc-export-pipeline.md).
