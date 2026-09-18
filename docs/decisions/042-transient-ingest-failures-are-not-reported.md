# 042 — A transient ingest failure is recorded, not reported

**Status:** accepted · **Decided:** 2026-09-18 · **Applies:** [011](011-ingest-imperative-shell.md), [012](012-ingest-heartbeat.md) · **Context:** `salish-w9n`; one upstream outage produced eighteen Sentry errors for a condition that healed itself in eighty-five minutes.

## Decision

A failed ingest run that the fetch layer classified as **retryable** writes its `failed` row to `ingest.runs` and is not sent to Sentry. Every other failure reports exactly as before.

Transient is not a second opinion about an error. It means precisely *what the retry policy already retries* — `isRetryableStatus` (429 and 5xx), plus anything thrown at the fetch level: an abort, a timeout, a refused connection, a 200 carrying a non-JSON body. One classifier serves both policies, in [`scripts/ingest/retry.ts`](../../scripts/ingest/retry.ts), so the two cannot drift apart. Unmarked is the default, and an unmarked failure alerts.

## Why a failed tick is not news

The cron fires every five minutes over a rolling ten-day window, so a tick that fails is re-covered by the next one over exactly the same ground. Nothing is lost, and there is nothing for a person to do. The [heartbeat](012-ingest-heartbeat.md) already covers the case that *is* news — no successful run for a source in thirty minutes — and it is the alert Sentry structurally cannot produce, because a cron that stops firing throws no exception.

So the per-tick capture was a second, noisier channel for the case the first one deliberately declines to fire on. `SALISHSEA-IO-3K` is the worked example: iNaturalist returned 503 for eighty-five minutes on 2026-09-17, eighteen consecutive ticks failed, every tick before and after succeeded, no row was deleted or lost, and the day ended with thirty observations against neighbours of forty-two, twenty-nine and fifty-one. Eighteen error reports, one escalation, nothing to do.

## What decided it: silence would have hidden a real bug

The tempting version of this change is to stop reporting failed ingest runs altogether and let `ingest.runs` plus the heartbeat be the whole story. The record says otherwise. Every failure the mirror has ever logged, by class:

| class | n | when | what it was |
|---|---|---|---|
| timeout / abort | 35 | 2026-07-08 → 08-31 | upstream, self-healing |
| upstream 5xx | 18 | 2026-09-17 | upstream, self-healing |
| connection | 1 | 2026-08-31 | upstream, self-healing |
| **pagination incomplete** | **32** | 2026-07-06 → 07-10 | **a real bug**, fixed by [018](018-inat-id-keyset-pagination.md) |
| **parse / schema** | **3** | 2026-07-08 → 09-18 | **real defects**, the latest being [041](041-inaturalist-history-backfilled.md)'s null photo dimensions |

The thirty-five genuine defects were **interleaved with successful runs**, so the heartbeat never tripped and never would have: it fires on the absence of success, and success kept arriving. The null-dimensions failure was a manual backfill run while the cron carried on succeeding — invisible to the heartbeat by construction. Blanket silence would have left both to be noticed by someone reading `ingest.runs` by hand, which is to say not noticed.

That is the whole argument for classifying rather than silencing: the failures worth hearing about are exactly the ones the heartbeat cannot see.

## Rejected

- **Stop capturing failed runs entirely.** Loses the pagination-incomplete and parse-failure classes, as above. This is the option the data killed.
- **Keep the capture but drop transient failures to `warning`.** Still files issues, still escalates, still asks a person to decide the same thing every time. The volume is the problem, not the colour.
- **Alert only after N consecutive failures.** Needs no classifier and so cannot misclassify, which is genuinely attractive. But it stays silent on an intermittent defect — pagination-incomplete failed thirty-two times in five days without ever failing twice in a row.
- **A separate list of "quiet" error patterns.** A regex over error messages is a second classifier that drifts from the retry policy the first time either changes. Marking the error where it is thrown keeps one source of truth.

## Consequences

- A transient failure is still fully recorded: the `ingest.runs` row with its `error` text, and the structured log line, now carrying `transient`. Nothing becomes unobservable; it stops paging.
- **The risk this accepts** is a defect misclassified as transient going quiet. It is bounded by the marker being applied only where the fetch layer already decided to retry, and by unmarked being the default — but a genuine upstream failure that is really our fault (say, a malformed request that earns a 500) will now pass unreported. The heartbeat remains the backstop if it persists.
- Widening `isRetryableStatus` silently widens what goes unreported. `scripts/ingest/retry.test.ts` pins the two together so that cannot happen unnoticed.
- The three issues held ignored-until-escalating pending this decision — `SALISHSEA-IO-2E` (Maplify timeout), `SALISHSEA-IO-3C` (connection refused), `SALISHSEA-IO-3J` (socket death under a query) — are all transient classes and should be resolved once this ships. `SALISHSEA-IO-3J`'s `write EBADF` is a postgres.js socket dying rather than an upstream fetch, so it is *not* covered by this change and stays reported.
