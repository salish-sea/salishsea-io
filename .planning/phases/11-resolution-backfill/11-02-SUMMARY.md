# Plan 11-02 Summary — Prod Census + Human Sign-off

**Status:** Complete (both tasks)
**Date:** 2026-06-19
**Requirements:** RESOLVE-02, RESOLVE-03 (census precondition)

## What was done

### Task 1 — Read-only prod census
Ran the `SELECT DISTINCT` provenance census (bracket tag → trailing attribution → structured `source`, highest-precedence per row) against **prod** (`grztmjpzamcxlzecmqca`) over the IPv4 pooler (`aws-1-us-west-1.pooler.supabase.com:5432`, session mode) — the direct `db.<ref>.supabase.co` host is IPv6-only and unroutable from here. Strictly read-only; `maplify.sightings.comments` untouched (SC#2). Committed `.planning/phases/11-resolution-backfill/maplify_census.tsv` (26 distinct signals, 6832 total rows).

### Task 2 — Human sign-off (blocking checkpoint, operator approved)
Every bracket tag and attribution value maps deterministically to an existing Phase-9 collection slug (incl. all 4 "Orca Network" typos → `orca-network`). Operator decisions on the structured-source long tail:
- `whale_alert` (2484) → **new** collection `whale-alert` (name "Whale Alert", parent org Whale Alert), to be seeded in 11-03; distinct from the Global/Alaska channels.
- `FARPB` (384) → STAY_NULL (expansion unknown).
- `wras` (50) → **DROP** — operator: "there ought not to be any wras records; they should be dropped on ingestion." 11-04 adds a one-time guarded DELETE of existing `source='wras'` rows + a `WHERE source IS DISTINCT FROM 'wras'` filter in `maplify.update_sightings`.
- Acronym real-name expansions (PSWS/MCW/CWW/WSSJI/HIWS/SBW/WA/PSWW/SA/SSCH) deferred — slug mapping suffices for backfill; collection `name` backfill skipped (optional D-10 UPDATE).

## Key findings / deviations

- **CRITICAL — prod is two phases behind:** Phase 9 (`reference_tables`) and Phase 10 (`source_table_fk_columns`) migrations are committed but **not deployed to prod** (prod's last applied migration is v1.2's `20260617203900`; `public.collections/providers/organizations` and the `maplify.sightings` FK columns do not exist in prod). Local stack has them. Decision: continue local-only; defer ALL prod pushes to one reviewed `supabase db push` bundle (9+10+11) at the end, with explicit approval. **11-04's prod-mutating steps are blocked on this.**
- Attribution counts are far below EXEC-SUMMARY §3 (e.g. Cascadia 52 vs ~2014) because the census assigns each row to its highest-precedence signal (bracket wins) — confirmed as the intended resolution.
- New scope item from operator: drop `wras` records (filter + delete) — folded into 11-04.

## Artifacts produced
- `.planning/phases/11-resolution-backfill/maplify_census.tsv` — human-confirmed census with `target_collection_slug` per row.

## Follow-ups for downstream plans
- **11-03:** seed `maplify.collection_rule` from this census; create the new `whale-alert` collection + its org link; do NOT add rules for FARPB (STAY_NULL) or wras (drop).
- **11-04:** add guarded DELETE of `source='wras'` + ingestion filter; all prod mutation deferred to the reviewed 9+10+11 push.

## Self-Check: PASSED
Census committed and non-empty; provably read-only (single SELECT; prod row count unchanged at 6832); every row annotated with a human-confirmed target.
