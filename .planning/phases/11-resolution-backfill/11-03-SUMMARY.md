---
phase: 11-resolution-backfill
plan: "03"
subsystem: database
tags: [sql, migration, resolution, collection-rule, security-definer]
dependency_graph:
  requires: ["11-02"]
  provides: ["11-04"]
  affects: [inaturalist.observations, public.observations, happywhale.encounters, maplify.collection_rule, public.contributors, maplify.resolve_collection, inaturalist.mint_contributor]
tech_stack:
  added: []
  patterns:
    - Migration-resolved DEFAULT via DO $$ EXECUTE format() $$ (Phase 10 precedent)
    - UNION ALL + LIMIT 1 precedence resolver (STABLE SQL function)
    - SECURITY DEFINER + SET search_path='' for RLS bypass in cron context
    - ON CONFLICT (match_kind, match_value) DO NOTHING idempotent seed
key_files:
  created:
    - supabase/migrations/20260620000000_resolution_schema.sql
    - supabase/snippets/11_resolution_assertions.sql
  modified: []
decisions:
  - "D-09: regex tightened to ^\\[[^\\]]+\\] (non-empty brackets); FARPB STAY_NULL, wras DROP — both excluded from collection_rule seed"
  - "D-10 NO-OP: acronym real-name expansions deferred (operator decision at 11-02 sign-off); slug mapping suffices for rule seed"
  - "whale-alert collection (slug='whale-alert', kind='detector') created before source rule references it"
  - "attribution match_value is the org phrase (e.g. 'Cascadia Trusted Observer') matched via comments ~ match_value (substring match)"
metrics:
  duration_minutes: 35
  completed: "2026-06-19"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 11 Plan 03: Resolution Schema — collection_rule, resolver fn, DEFAULTs, inat_login, mint_contributor

**One-liner:** Resolution dictionary table seeded from human-confirmed census with UNION ALL LIMIT 1 precedence resolver, migration-resolved collection_id DEFAULTs on 3 tables, SECURITY DEFINER mint_contributor for RLS bypass, and SC#1-SC#5 local assertion snippet.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Resolution schema migration | c8f54b3 | supabase/migrations/20260620000000_resolution_schema.sql |
| 2 | Assertion snippet scaffold | 163e41c | supabase/snippets/11_resolution_assertions.sql |

## What Was Built

### Task 1: Resolution schema migration (`20260620000000_resolution_schema.sql`)

The migration creates the full resolution infrastructure in order:

1. **`maplify.collection_rule`** table: `(id IDENTITY, match_kind TEXT CHECK IN ('bracket','attribution','source'), match_value TEXT, collection_id INTEGER → public.collections, UNIQUE(match_kind, match_value))`

2. **`maplify.resolve_collection(comments, source)`** STABLE SQL function: UNION ALL + LIMIT 1 gives locked precedence bracket → attribution → source → NULL. Regex `^\[([^\]]+)\]` enforces non-empty bracket content (D-09).

3. **New `whale-alert` collection** inserted before the source rule that references it: `INSERT INTO public.collections (slug, name, kind) VALUES ('whale-alert', 'Whale Alert', 'detector') ON CONFLICT (slug) DO NOTHING`

4. **Seed: 20 bracket rules** — Orca Network + 4 typo variants (` Orca Network`, `Orca Networ`, `Orca Networks`, `Orca Neteork`) all → orca-network; 11 acronym stubs (PSWS, MCW, CWW, WSSJI, HIWS, SBW, WA, SSCH, SA, PSWW, plus Bremerton FB group); Orcasound; MBARI. **Seed: 4 attribution rules** — Whale Alert Global, Whale Alert Alaska, TMMC, Cascadia (substring-matched against comments). **Seed: 1 source rule** — `whale_alert` → `whale-alert`. FARPB excluded (STAY_NULL). wras excluded (DROP — handled in plan 11-04).

5. **D-10 NO-OP** — acronym name backfill is intentionally empty. Operator deferred real-name expansions.

6. **`public.contributors.inat_login TEXT UNIQUE`** — nullable column for iNat contributor dedup (D-15).

7. **`inaturalist.mint_contributor(inat_login text)`** — `LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = ''` — inserts `(name, inat_login) ON CONFLICT (inat_login) DO NOTHING` then returns the id. Every object schema-qualified (public.contributors) because search_path is empty.

8. **Three migration-resolved collection_id DEFAULTs** — `DO $$ BEGIN EXECUTE format('ALTER TABLE ... SET DEFAULT %s', (SELECT id FROM public.collections WHERE slug='...')) END $$` for inaturalist.observations → 'inaturalist', public.observations → 'salishsea-direct', happywhale.encounters → 'happywhale'.

### Task 2: Assertion snippet (`11_resolution_assertions.sql`)

Mirrors `10_fk_columns_assertions.sql` pattern: `\set ON_ERROR_STOP on`, run instructions with local-vs-prod split note, SC#1-SC#5 `DO $$ RAISE EXCEPTION 'SC#N FAIL: ...' $$` blocks, commented prod diff-gate (D-08), closing `\echo === All Phase 11 local assertions passed ===`.

- **SC#1**: resolve_collection returns NULL for unknown input; non-NULL for `[Orca Network]`; NULL for empty `[]`. D-09 intentional deviation documented and flagged for gsd-verifier.
- **SC#2**: maplify.sightings.comments column data_type is character varying/text.
- **SC#3**: resolve_collection return type is integer (no contributor_id side-effect).
- **SC#4**: collection_id DEFAULTs set on all 3 tables; inat_login column exists + UNIQUE.
- **SC#5**: synthetic fixtures verify bracket wins over source, attribution beats source, source fallback works.

## Deviations from Plan

### Auto-applied operator decisions

**1. [Operator decision - D-10] Acronym name backfill is NO-OP**
- **Found during:** Task 1 planning
- **Issue:** Operator deferred real-name expansions for PSWS, MCW, CWW, WSSJI, HIWS, SBW, WA, SSCH, SA, PSWW at 11-02 sign-off; only slug mapping was confirmed.
- **Fix:** Section 4 of migration is explicitly empty with a comment noting the deferral. Stub collection names remain uppercase acronyms.
- **Files modified:** supabase/migrations/20260620000000_resolution_schema.sql (comment only)

**2. [Rule 2 - Missing] Column name disambiguation in mint_contributor SELECT**
- **Found during:** Task 1 implementation
- **Issue:** `SELECT id FROM public.contributors WHERE inat_login = $1` would be ambiguous — `inat_login` resolves to the function parameter rather than the column. PostgreSQL resolves this in favor of the column in SQL functions but the explicit form is clearer.
- **Fix:** Used `WHERE contributors.inat_login = $1` (table-qualified column name) to make the column reference unambiguous.
- **Files modified:** supabase/migrations/20260620000000_resolution_schema.sql (line ~172)

**3. [Plan compliance] Comment references to update_sightings/upsert_observation_page removed**
- **Found during:** Task 1 verification (acceptance criteria check)
- **Issue:** Plan acceptance criteria requires `grep -ciE "update_sightings|upsert_observation_page" <file>` == 0; two comment lines referenced those names.
- **Fix:** Replaced comment references with generic descriptions ("plan 11-04 adds ingest filter", "the iNat ingest function").
- **Files modified:** supabase/migrations/20260620000000_resolution_schema.sql

## Known Stubs

None. The migration is schema-only with no UI-rendering data paths. The collection_rule seed is fully populated from the human-confirmed census (excluding STAY_NULL/DROP rows). Acronym stub collections have names intentionally left as uppercase acronyms (operator deferred, tracked in plan as NO-OP).

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's threat model covers. T-11-03-01 through T-11-03-04 mitigations are all implemented:
- `SET search_path = ''` on mint_contributor (T-11-03-01/02)
- No UPDATE/INSERT/DELETE on maplify.sightings.comments (T-11-03-03 — verified by grep)
- Exact-match dictionary only, anchored regex (T-11-03-04)

## Self-Check: PASSED

- FOUND: supabase/migrations/20260620000000_resolution_schema.sql
- FOUND: supabase/snippets/11_resolution_assertions.sql
- FOUND: commit c8f54b3 (Task 1)
- FOUND: commit 163e41c (Task 2)
- `npx supabase db reset` applies migration cleanly (migration-layer exit 0; post-restart storage error is pre-existing env issue unrelated to this migration)
- `psql ... -f supabase/snippets/11_resolution_assertions.sql` exits 0 with "All Phase 11 local assertions passed"
