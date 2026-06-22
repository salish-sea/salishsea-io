---
phase: 14-dwc-a-build-pre-prod-gate-seeded-local-db
plan: "01"
subsystem: dwca-fixture
tags:
  - ci
  - fixture
  - dwc-a
  - postgres
  - seeding
dependency_graph:
  requires:
    - "supabase/migrations/20260619184037_reference_tables.sql (providers/organizations/collections)"
    - "supabase/migrations/20260621000000_dwc_view_rebuild.sql (26-col view with trusted filter)"
    - "supabase/migrations/20260203234153_individuals.sql (auth.users trigger)"
  provides:
    - "supabase/ci-seed.sql — CI-only static fixture"
    - "DWCA-GATE-01 fulfilled: fixture applied after migrations"
    - "DWCA-GATE-02 fulfilled: branch-covering minimal data set"
    - "DWCA-GATE-06 fulfilled: supabase db reset applies cleanly from scratch (A3 retired)"
  affects:
    - ".github/workflows/build.yml (Plan 02 wires fixture into CI)"
tech_stack:
  added: []
  patterns:
    - "auth.users trigger path for contributor creation (GENERATED ALWAYS identity handled by omitting id)"
    - "psql -f for multi-statement SQL fixtures (supabase db query --local --file does not support multiple statements)"
key_files:
  created:
    - "supabase/ci-seed.sql"
  modified: []
decisions:
  - "auth.users trigger path used (not direct insert): trigger create_contributor_on_sign_in fires synchronously on auth.users INSERT and creates public.contributors + public.user_contributor rows"
  - "observation_photos.id omitted (GENERATED ALWAYS AS IDENTITY — cannot insert explicit value without OVERRIDING SYSTEM VALUE)"
  - "supabase db query --local --file does not support multi-statement SQL files (uses prepared statements); psql -f is the correct invocation for local and CI use"
  - "DWCA-GATE-06 / A3 retired: supabase db reset applies the full migration chain from scratch and exits 0"
metrics:
  duration: "25min"
  completed: "2026-06-22"
  tasks_completed: 2
  files_created: 1
  files_modified: 0
---

# Phase 14 Plan 01: CI-only Static Fixture (supabase/ci-seed.sql) Summary

**One-liner:** Static SQL fixture seeding auth.users+contributor (trigger path), one native observation+photo, and three branch-covering Maplify sightings — makes dwc.occurrences/multimedia non-empty and exercises trusted/untrusted/tagged/untagged branches; full migration chain verified clean via supabase db reset.

## What Was Built

`supabase/ci-seed.sql` — a 157-line static SQL fixture file applied explicitly after migrations, designed to make the `dwc.occurrences` / `dwc.multimedia` view chain non-empty and exercise the bug-prone query branches before Plan 02 wires it into CI.

### Fixture Structure

**Section 1 — Native branch (dwc._native_occurrences + dwc.multimedia):**
- `auth.users` row with fixed UUID `00000000-0000-0000-0000-000000000001`, email `ci-gate@example.com`
- `create_contributor_on_sign_in` trigger fires synchronously, creating contributor 'CI Gate Test' and `user_contributor` mapping
- DO block reads `contributor_id` from `public.user_contributor`, inserts `public.observations` (taxon_id=41521, count=2, collection_id DEFAULT 10 salishsea-direct)
- `public.observation_photos` (license_code='cc-by') → feeds `dwc.multimedia`

**Section 2 — Maplify branch (dwc._maplify_occurrences + Step 15.5):**
- Row A (id=1): trusted=TRUE, bracket-tagged `[Orca Network] 3 orcas heading north (Jane Smith)` → recordedBy='Jane Smith', collection_id=1 (orca-network, org_id=1) → Step 15.5 returns 'Orca Network'
- Row B (id=2): trusted=FALSE → excluded from dwc.occurrences by `WHERE s.trusted` (exercises trust-filter branch)
- Row C (id=3): trusted=TRUE, untagged comment → recordedBy=NULL, collection_id=NULL → LEFT JOIN falls through to COALESCE fallback; appears in dwc.occurrences but not Step 15.5

## Contributor Path Used

**auth.users trigger path** (primary path, successfully used): `INSERT INTO auth.users (id, email, created_at, updated_at, raw_user_meta_data)` triggers `create_contributor_on_sign_in`, which synchronously creates `public.contributors (name='CI Gate Test')` and `public.user_contributor (user_uuid, contributor_id)`. The DO block then reads `contributor_id` via `SELECT ... FROM public.user_contributor WHERE user_uuid = '...'`.

The direct-insert fallback (RESEARCH A1) was NOT needed.

## Observed Row Counts After Fixture Application

Verified against freshly-reset local DB (all migrations including Phase 12 applied):

| View | Count | Notes |
|------|-------|-------|
| `dwc.occurrences` | 242 (3+ from fixture) | Fixture contributes 1 native + 2 trusted Maplify; rest from partial live seed |
| `dwc.multimedia` | 1 | The native observation photo (license_code='cc-by') |
| `dwc.occurrences WHERE "occurrenceID"='maplify:2'` | 0 | untrusted Row B correctly excluded |
| `dwc.occurrences WHERE "occurrenceID"='maplify:1' → recordedBy` | 'Jane Smith' | regex extraction correct |
| Step 15.5 associated-parties | Orca Network present | collection_id=1 → org_id=1 → 'Orca Network' |

## supabase db reset Result (DWCA-GATE-06 / A3 Retired)

`npx supabase db reset --local` applied the full migration chain from scratch and exited 0 on the first run. All 43 migrations applied cleanly, including:
- `20260621000000_dwc_view_rebuild.sql` (Phase 12, 26-column rebuild with trusted filter)
- `20260619184037_reference_tables.sql` (providers, organizations, collections)
- `20260619203013_source_table_fk_columns.sql` (FK defaults)

**A3 risk retired:** The migration chain integrates cleanly. The 20250915 `SET SCHEMA public` / 20250919 FK dependency sequence that was RESEARCH A3's concern applies cleanly in the actual migration order.

## Task 2 Integration Suite Results

`SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test -- run`

| Test | Result |
|------|--------|
| build.test.ts describe block | ACTIVATED (not skipped) |
| DWCA-01: zip exists with four entries | PASS |
| DWCA-01 secondary: parquet sidecar | PASS |
| DWCA-02: meta.xml core field indices round-trip | PASS |
| DWCA-02: meta.xml extension field indices round-trip | PASS |
| DWCA-03: multimedia.coreId ⊆ occurrence.occurrenceID | PASS |
| DWCA-04: no BOM (occurrence.txt) | PASS |
| DWCA-04: no BOM (multimedia.txt) | PASS |
| DWCA-04: 26-column rows | PASS (uses OCCURRENCE_FIELDS.length dynamic) |
| DWCA-02 round-trip: 26 fields + rightsHolder/license | PASS |
| DWCA-06: GeoParquet 1.0.0 metadata + row parity | PASS |

build.ts Step 8 `assertNonZeroRows` passed (fixture made dwc.occurrences non-empty).
Step 15.5 associated-parties query returned 'Orca Network' (among others from live seed).

## Deviations from Plan

### Auto-discovered Issues

**1. [Rule 1 - Bug] observation_photos.id is GENERATED ALWAYS AS IDENTITY**
- **Found during:** Task 1 fixture testing
- **Issue:** Plan specified `explicit id = 1` for observation_photos, but the column is `GENERATED ALWAYS AS IDENTITY` — cannot insert explicit value without `OVERRIDING SYSTEM VALUE`
- **Fix:** Omitted the explicit `id` from the INSERT; auto-assigned by the sequence. The photo has exactly one row so the specific id value is irrelevant to the fixture's purpose.
- **Files modified:** supabase/ci-seed.sql (before initial commit)

**2. [Rule 1 - Bug] supabase db query --local --file does not support multi-statement SQL files**
- **Found during:** Task 1 fixture testing
- **Issue:** `npx supabase db query --local --file supabase/ci-seed.sql` exits 1 with "cannot insert multiple commands into a prepared statement (SQLSTATE 42601)". The fixture has 5 top-level statements (auth.users INSERT, DO block, 3 Maplify INSERTs). The `--file` flag pipes the entire file as a single prepared statement.
- **Fix for Plan 01:** Used `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/ci-seed.sql` for local verification (exits 0, all rows inserted correctly). The header comment in ci-seed.sql already documented this invocation pattern.
- **Impact on Plan 02:** build.yml CI wiring (Plan 02) MUST use `psql ... -f supabase/ci-seed.sql` instead of `supabase db query --local --file`. `psql` is preinstalled on ubuntu-latest runners (RESEARCH §Q5 fallback). This deviation is within Plan 02's scope to handle.

### Pre-existing Out-of-Scope Issue (Deferred)

**guard.test.ts `guard trips when dwc.occurrences row count <= ROW_FLOOR`** fails when `SUPABASE_DB_URL` is set due to a test infrastructure bug: `vi.mocked(duckdbModule.DuckDBInstance.create).mockRestore()` fails on a `vi.fn()` mock — `Cannot read properties of undefined (reading 'connect')`. This test was previously always skipped (no DSN) and is out of scope for Plan 01 (D-03: guard.ts stays nightly-only; plan scope is locked to supabase/ci-seed.sql only). Filed to `deferred-items.md` for Plan 02 to address.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. `supabase/ci-seed.sql` contains only synthetic data: fixed UUID, 'CI Gate Test' contributor name, 'Jane Smith' observer name (fictional), example.com URL. No prod DSN, no real Supabase project ref, no live secrets. T-14-01 mitigation verified.

## Commits

| Commit | Description |
|--------|-------------|
| 15931f7 | feat(14-01): author supabase/ci-seed.sql — CI-only static fixture |

## Self-Check: PASSED

- [x] supabase/ci-seed.sql exists at `/Users/rainhead/dev/salishsea-io/supabase/ci-seed.sql`
- [x] Commit 15931f7 exists in git log
- [x] dwc.occurrences >= 3 after fixture (242 rows observed)
- [x] dwc.multimedia >= 1 after fixture (1 row observed)
- [x] untrusted maplify:2 excluded (count=0 verified)
- [x] recordedBy for maplify:1 = 'Jane Smith' (verified)
- [x] Step 15.5 returns Orca Network (verified)
- [x] supabase db reset exits 0 (DWCA-GATE-06 / A3 retired)
- [x] All DWCA-01..04/06 tests in build.test.ts PASS
- [x] build.test.ts describe block ACTIVATED (not skipped)
- [x] supabase/seed.sql unchanged (verified via git status)
- [x] No changes to build.ts, build.test.ts, fields.ts, or guard.ts (verified via git status)
