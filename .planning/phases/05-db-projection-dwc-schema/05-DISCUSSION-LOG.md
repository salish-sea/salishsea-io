# Phase 5: DB Projection (`dwc` schema) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 05-db-projection-dwc-schema
**Areas discussed:** dwc.occurrences materialization, dwc.datasets form (D-15), Taxonomy hierarchy walk (ALIGN-03)

---

## dwc.occurrences materialization

| Option | Description | Selected |
|--------|-------------|----------|
| Plain view | DuckDB ATTACH executes query at COPY time; no refresh, no storage, no staleness; trivial cost for once-daily nightly job. | ✓ |
| Materialized view | Matches `public.occurrences` precedent; cheap to query repeatedly; needs `REFRESH`, occupies storage, can go stale. | |
| Table populated by a procedure | Heaviest; explicit timing control; useful only for adding indexes/constraints on the projection itself. | |

**User's choice:** Plain view.
**Notes:** The matview precedent (`public.occurrences`) is for runtime UI reads; Phase 5's consumer is once-daily DuckDB COPY — different use case.

### Follow-up: branch structure inside the view

| Option | Description | Selected |
|--------|-------------|----------|
| Two intermediate views, UNION ALL in `dwc.occurrences` | `dwc._native_occurrences` + `dwc._maplify_occurrences` UNION'd; each testable in isolation; D-03 filter lives cleanly in Maplify branch. | ✓ |
| Single view with inline UNION ALL | Fewer objects; harder to inspect one branch alone; D-03 filter buried inside the maplify branch. | |

**User's choice:** Two intermediate views (`dwc._native_occurrences`, `dwc._maplify_occurrences`), UNION ALL'd in `dwc.occurrences`.

---

## dwc.datasets form (D-15)

| Option | Description | Selected |
|--------|-------------|----------|
| View over a VALUES list in a migration | Dataset metadata as source code; every edit is a migration; survives DB resets; adding constituents = one-line migration. | ✓ |
| Table with seed migration | Editable via plain SQL ad-hoc; needs re-seed after resets; prod can drift from migration history. | |
| Table seeded from supabase/seed.sql | Same as B, explicit about seed location; same drift risk. | |

**User's choice:** View over a VALUES list.
**Notes:** Fits the sole-maintainer, change-via-PR workflow; rationale satisfies POLICY §6.1's "Phase 5 picks one with a written rationale" delegation.

### Follow-up: contact_email handling

| Option | Description | Selected |
|--------|-------------|----------|
| Commit the email in the migration | `supabase/migrations/` is app code, not `.planning/`; address is public in EML anyway. | ✓ |
| Read email from env var at projection time | Migration defines the column; env var supplies the value; extra machinery for the same public end value. | |
| Placeholder for now | Use a placeholder; swap at Phase 6 EML authoring time. | |

**User's choice:** Commit `rainhead@gmail.com` directly in the migration.

---

## Taxonomy hierarchy walk (ALIGN-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Helper view `dwc.taxa_classification` joined by both branches | One row per taxon_id with rank columns; walk encoded once via `WITH RECURSIVE`; inspectable in isolation; single test surface for higher-rank-only logic. | ✓ |
| `dwc.classification(taxon_id)` IMMUTABLE function returning composite type | Function does walk per call; no extra view; harder to inspect in bulk; signature change ripples to callers. | |
| Inline `WITH RECURSIVE` inside each branch view | Zero new objects; walk logic duplicated; harder to test higher-rank-only cases. | |

**User's choice:** Helper view `dwc.taxa_classification`, JOINed by both branch views.

---

## Claude's Discretion

These were not discussed and are explicitly left to the planner:

- SQL file layout (one migration vs. split) — default to one cohesive migration
- D-03 per-`maplify.source` filter **mechanism** must be present; no source is actually filtered in v1.2
- `rwsas` exclusion verification (POLICY §5.3) — planner queries production-shaped data
- `maplify.source` distinct-values query before encoding the source→display-name mapping (Assumption A2, POLICY §2.2)
- Dataset slug — default `occurrences-v1`
- `dynamicProperties` JSON-assembly SQL technique
- `occurrenceID` uniqueness smoke test (cheap insurance)
- D-05 Maplify-data QA harness is **not** in Phase 5 scope (POLICY §4.5 — out-of-band review)

## Deferred Ideas

- D-07 native-only archive variant — punted to Phase 7/8 by POLICY §4.1
- INDIV-01 / `organismID` — v2 milestone (REQUIREMENTS.md)
- Future per-constituent `dwc.datasets` rows — schema sized for them; v1.2 ships one row
- D-08 submission-form license notice — separate roadmap item, touches app runtime
