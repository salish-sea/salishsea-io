# 060 — An upstream outage is held to a longer threshold than our own

**Status:** accepted · **Decided:** 2026-09-30 · **Amends:** [012](012-ingest-heartbeat.md) · **Extends:** [042](042-transient-ingest-failures-are-not-reported.md) · **Context:** GitHub [#523](https://github.com/salish-sea/salishsea-io/issues/523) and [#456](https://github.com/salish-sea/salishsea-io/issues/456), bd `salish-1zgd`

## Context

Twice in two weeks the heartbeat filed an ingest-outage issue for iNaturalist's maintenance. On 2026-09-30 every iNaturalist run from 04:00 to 04:25 UTC failed with `iNaturalist observations HTTP 503`, a thirty-five-minute hole in successful runs against a thirty-minute threshold. On 2026-09-17 the same 503 began at the same minute and lasted ninety-five. Both times, Orcasound and Maplify ran every five minutes, every pg_cron job succeeded, and the next iNaturalist run after the outage caught up: 24 rows against a usual 0–4 on the 30th. Nothing was lost and there was nothing to do, but the alert stayed red for a day, because a healed gap trips until it ages out of the 24-hour lookback.

The heartbeat exists to catch *our* pipeline stopping silently ([012](012-ingest-heartbeat.md)): a cron that stops firing throws no exception. It measured that by the absence of success, which cannot tell "we stopped" from "the source said no". The fetch layer already can: [042](042-transient-ingest-failures-are-not-reported.md) marks an upstream 5xx or 429, a timeout, or a refused connection as *transient*, and keeps those failures out of Sentry. That verdict reached the log line but not the `ingest.runs` row, so the heartbeat never saw it.

## Decision

The run row records the verdict: `ingest.runs.transient`, true only on a failed run the fetch layer marked transient. It is not a second classifier. It is 042's, written down.

The heartbeat then asks two questions of each source instead of one:

- **Is our side running?** Thirty minutes, as before. A success counts as a sign of life, and so does a transient failure: the cron fired, the function ran, it recorded an outcome, and the fault was upstream. A failure that is not transient does not count, so a defect that fails every run still trips at thirty minutes. `stale` and `gap` now answer this question.
- **Is the source reachable?** Six hours. No success for that long, while our side kept running, is reported as `upstream_outage`, ongoing or healed. The ten-day rolling window re-covers any outage shorter than ten days, so this threshold is not about losing data. It is about a person noticing that the map has gone stale before a visitor does. Six hours clears both observed maintenance windows several times over and still catches an outage within one evening.

If our side stops *during* an upstream outage, that is reported as ours: an interval without success that contains a hole of our own is a `gap`, not an `upstream_outage`.

## Rejected

- **Raise the thirty-minute threshold for everything.** It would also slow detection of the case the heartbeat exists for. The pg_net gap that motivated 012 was ten minutes long.
- **Classify from the `error` text in the heartbeat.** A regex over `iNaturalist observations HTTP 503` is the second classifier 042 rejected: it drifts the first time either side changes. The verdict is taken where the error is thrown.
- **Never alert on an upstream outage.** A source that is down for a day is still worth knowing about, because the map is visibly stale. It could also be ours in disguise. A persistent 429 means we are being rate-limited, and 042 classifies 429 as transient.
- **Suppress iNaturalist's maintenance window by the clock.** Both outages began at 04:00 UTC, but nobody has published that schedule, and a rule keyed to it would hide a real outage that happened to start then.

## Consequences

- Rows written before this migration are `transient = false`, which reads as a defect, the conservative default 042 already uses. The heartbeat reads one day back, so they stop mattering after a day.
- The edge function deploys a few seconds before `supabase db push`. A run that fails inside that window tries to write a column that does not yet exist, and the best-effort `UPDATE` fails silently. That leaves an orphan, which the heartbeat reports as `stuck` until the row is fixed by hand. The window is seconds long and needs a failure to land in it; this is accepted rather than engineered around.
- A persistent 429, or a 500 that is really our malformed request, now waits six hours instead of thirty minutes to be noticed. 042 already accepted this risk for Sentry, and this extends it to the heartbeat.
- The threshold is `UPSTREAM_MINUTES` in [`ingest-heartbeat.yml`](../../.github/workflows/ingest-heartbeat.yml), overriding the default in [`heartbeat.ts`](../../scripts/ingest/heartbeat.ts).
