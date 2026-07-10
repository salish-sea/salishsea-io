# 018 — iNaturalist ingest paginates by id-keyset, not page number

**Status:** accepted · **Decided:** 2026-07-10 · **Amends:** [011](011-ingest-imperative-shell.md)

## Context

Decision [011](011-ingest-imperative-shell.md) made a *provably complete* fetch the precondition
for reconcile: the shell may delete stored rows the fetch no longer returns only if it can prove
it saw the whole window. For iNaturalist the original proof was a **page-number sweep**: fetch
`page=1..N` where `N = ceil(total_results / per_page)`, and require that every page reported the
same `total_results`, the page numbers were exactly `1..N`, and the per-page counts summed to
`total_results`.

That proof depends on `total_results` and per-page offsets being **stable across the whole
sweep**, but iNaturalist's window is live (`d2` = "today"). An observation created, edited, or
deleted between two sequential page requests shifts `total_results` or slides records across the
`per_page` offset boundary, and the accumulated pages fail the completeness check. This surfaced
as Sentry **SALISHSEA-IO-2D**. PR #327 added a bounded **re-page** (retry the whole window a few
times, hoping it settles) — a mitigation that narrows the race window but never closes it, and
that still cannot express a window larger than iNat's `page * per_page ≤ 10 000` hard cap.

## Decision

Sweep the window by **ascending observation id** (id-keyset / cursor pagination):

```text
order_by=id & order=asc & id_above=<lastMaxId> & per_page=200   (id_above=0 to start)
```

Loop, advancing the cursor to each page's **max raw id**, until a page returns **fewer than
`per_page` rows** — the **terminal page**. Under ascending-id ordering a short (or empty) page
cannot be followed by more, so it *is* the completeness proof.

- **`total_results` is no longer load-bearing.** iNat still returns it; the shell records it (as
  raw records fetched) but never gates completeness on it. This is the specific amendment to
  011's completeness invariant: the proof is now "a terminal short page was reached," not "the
  per-page counts summed to `total_results`."
- **The cursor is an immutable id**, so a mutation mid-sweep cannot drift the proof: a new
  observation always gets a *higher* id (naturally swept if in range, ignored if past the
  cursor), an edit keeps its id and place, a deletion simply doesn't appear. This eliminates the
  drift class outright rather than retrying around it — so **PR #327's re-page loop is removed**.
- **iNat's `page * per_page ≤ 10 000` cap no longer applies** (it bounds offset pagination, not
  `id_above`), so the old `MAX_PAGE` guard is gone. A single generous `MAX_KEYSET_PAGES` backstop
  (1000 pages ≈ 200 000 records) turns a pathological window or cursor bug into a loud throw
  instead of a hung edge invocation.
- **The cursor is computed over RAW page ids**, before the shell skips out-of-scope
  `time_observed_at = null` records, so a trailing skipped record still advances the sweep.
- Split unchanged per 011: `isTerminalPage` / `isPaginationComplete` are pure predicates in the
  functional core ([`scripts/ingest/inaturalist.ts`](../../scripts/ingest/inaturalist.ts)); the
  sweep loop is the shell
  ([`supabase/functions/ingest/fetch-inaturalist.ts`](../../supabase/functions/ingest/fetch-inaturalist.ts)).
  The shell asserts `isPaginationComplete` after the loop as a defensive invariant.

## Rejected alternatives

- **Keep page-number pagination, widen PR #327's re-page retries.** Only shrinks the race; a busy
  window can drift on every attempt, and the 10 000-record cap remains. Treats a structural flaw
  as a flake.
- **Snapshot the window by a frozen upper time bound** (fetch only `updated_at < run_start`) to
  make offset pagination atomic. Adds a time-boundary correctness argument of its own and still
  inherits the 10 000-record cap; id-keyset needs neither.
- **Trust `total_results` for a light cross-check** alongside keyset. Reintroduces the exact
  drifting quantity this decision removes from the trusted path; its only honest use now is a log
  field.

## Consequences

- One extra request per window in the exact-multiple-of-`per_page` case (a full last page forces
  one confirming empty page). Negligible against the drift-retry requests this removes.
- `ingest.runs.total_results` now records **raw records fetched across the sweep**, not iNat's
  reported total — the same number on a complete fetch, and the honest one under keyset.
- Windows over 10 000 records are now ingestable in a single run (still bounded by
  `MAX_KEYSET_PAGES` and the edge invocation's wall clock).
- A genuinely short *non-terminal* page (an iNat server returning fewer than `per_page` rows while
  more exist) would be read as terminal and truncate the sweep. This is outside the documented
  cursor contract; `isPaginationComplete`'s "every page but the last is full" assertion is the
  guard, and the self-healing 10-day window re-fetches on the next run.

## Reference

Issue: `salishsea-io-7up` (durable fix for `salishsea-io-2f`/Sentry SALISHSEA-IO-2D). Amends the
completeness invariant of [011](011-ingest-imperative-shell.md). Prior mitigation: PR #327
(bounded re-page). Upstream-mirror boundary: [008](008-source-schemas-are-upstream-mirrors.md).
