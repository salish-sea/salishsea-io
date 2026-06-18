---
phase: 05-db-projection-dwc-schema
plan: 04
subsystem: database
tags: [postgres, supabase, darwincore, dwc, view, union-all, datasets, multimedia, assertion-harness, deferred-db-run]

# Dependency graph
requires:
  - phase: 05-db-projection-dwc-schema
    provides: 05-01-SUMMARY.md — dwc schema + dwc.taxa_classification helper view
  - phase: 05-db-projection-dwc-schema
    provides: 05-02-SUMMARY.md — dwc._native_occurrences (25-column interface contract frozen)
  - phase: 05-db-projection-dwc-schema
    provides: 05-03-SUMMARY.md — dwc._maplify_occurrences (25-column UNION-ALL mirror)
  - phase: 04-rights-data-model-policy-gate
    provides: 04-POLICY §3.3 (multimedia gap table), §1.2 (per-photo license CASE), §1.4 (none/NULL exclusion), §6.2 (dataset schema), §6.3 (datasetID URI scheme), §6.4 (D-18 publisher identity), §6.7 (Phase 5/6 ownership split)
provides:
  - dwc.occurrences (UNION ALL view; M-02 / ALIGN-01)
  - dwc.datasets (single-row view-over-VALUES with M-04 contact_email, D-15..D-18 publisher/contact identity)
  - dwc.multimedia (GBIF Simple Multimedia extension view; native-only, D-19 two-branch license CASE)
  - Final GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated (Pitfall 5)
  - supabase/snippets/05_dwc_assertions.sql (psql assertion harness; 17 assertion blocks)
affects: [06-archive-generation, 07-nightly-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "View-as-export-contract closure — UNION ALL compiles only if both branches share 25-column / type parity (Postgres enforces at CREATE VIEW time)"
    - "View-over-VALUES for single-row reference data (dwc.datasets) — every metadata edit is a migration, survives db reset, no separate seed step"
    - "1-to-N child view with coreId join key (dwc.multimedia) — matches DwC-A two-file structure; Phase 6 COPYs each view to its own CSV"
    - "psql assertion harness pattern: \\set ON_ERROR_STOP on + per-assertion DO block with NOTICE-on-empty-table SKIP and EXCEPTION-on-fail"

key-files:
  created:
    - supabase/snippets/05_dwc_assertions.sql
    - .planning/phases/05-db-projection-dwc-schema/05-04-SUMMARY.md
  modified:
    - supabase/migrations/20260617203900_dwc_schema.sql
    - .planning/phases/05-db-projection-dwc-schema/05-VALIDATION.md

key-decisions:
  - "dwc.occurrences is a bare SELECT * UNION ALL of the two branches — no per-column projection list at the union layer. Postgres enforces column count, name, and type parity at CREATE VIEW time, so any future branch drift fails the migration loudly (RESEARCH Pattern 1)."
  - "dwc.datasets carries 19 columns sized for future per-constituent rows (POLICY §6.2) but ships with exactly one row in v1.2 (D-16). title, abstract, methods, geographic_coverage are placeholders / NULL per POLICY §6.7 ownership split (Phase 6 authors final text)."
  - "dwc.multimedia D-19 distinct CASE branches: WHEN 'none' THEN NULL (terminal) + ELSE NULL (catches IS NULL — forward-compat per Discrepancy 2). Both arms are excluded by the WHERE clause in v1.2; the semantic distinction is encoded for a future DROP NOT NULL on public.observation_photos.license_code."
  - "Maplify photos are NOT in dwc.multimedia — maplify.sightings.photo_url has no license column (POLICY §1.4 + Discrepancy in RESEARCH); the view does not reference maplify at all. DWCA-03 readiness (every coreId joins dwc.occurrences) holds because every native multimedia row's coreId matches a native dwc._native_occurrences row."
  - "Assertion suite execution DEFERRED — local Supabase DB unavailable (Docker daemon not running, port 54322 closed, supabase CLI not on PATH; npx supabase available but cannot start a stack without Docker). Tasks 1, 2, and 5 completed (file authorship + VALIDATION fill-in); Tasks 3 and 4 require user to run supabase db reset + psql -f against a live local DB."
  - "VALIDATION.md frontmatter stays nyquist_compliant: false and wave_0_complete: false until psql exits 0 — the phase cannot be marked verified on file-existence alone."

patterns-established:
  - "Final grant in schema migrations: GRANT SELECT ON ALL TABLES IN SCHEMA <schema> TO <roles> at the END of the migration covers every view authored above in one statement, no per-view grant clutter."
  - "psql assertion harness: each assertion is a DO block with RAISE EXCEPTION '<REQ-ID> FAIL: <reason>, <count>' on failure; assertions that would trivially pass on empty tables emit RAISE NOTICE '<REQ-ID> SKIP: ...' instead (no false positive)."

requirements_completed: [ALIGN-01, ALIGN-02, ALIGN-03, ALIGN-04, ALIGN-05, ALIGN-06]
# NOTE: Requirements are encoded in the SQL views as committed in plans 05-01..05-04.
# Runtime validation against a live DB is deferred (see Deviations / User Setup Required).

# Metrics
duration: ~12min
completed: 2026-06-17
---

# Phase 5 Plan 04: Closer — UNION + datasets + multimedia + assertion harness Summary

**Closes the Phase 5 migration with the three remaining DwC views (`dwc.occurrences` UNION, `dwc.datasets` single-row VALUES view, `dwc.multimedia` GBIF Simple Multimedia extension), the final blanket `GRANT SELECT`, and a 17-assertion psql harness — completing the SQL encoding contract for 04-POLICY but deferring the live-DB verification step because the local Supabase stack was not running at execution time (Docker daemon down, port 54322 closed).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-17T~21:33:00Z
- **Completed:** 2026-06-17T~21:45:00Z
- **Tasks attempted:** 5 (Tasks 1, 2, 5 committed; Tasks 3, 4 deferred — see User Setup Required)
- **Files created:** 2 (`supabase/snippets/05_dwc_assertions.sql`, this SUMMARY)
- **Files modified:** 2 (`supabase/migrations/20260617203900_dwc_schema.sql`, `05-VALIDATION.md`)

## Accomplishments

### `supabase/migrations/20260617203900_dwc_schema.sql` — completed (Task 1)

Six `CREATE VIEW dwc.*` statements now exist in the migration (count verified by `grep -c '^CREATE VIEW' = 6`):

| # | View | Plan | Purpose |
|---|------|------|---------|
| 1 | `dwc.taxa_classification` | 05-01 | Recursive Linnaean walk; M-05 helper |
| 2 | `dwc._native_occurrences` | 05-02 | Native branch (25 cols, ALIGN-02/04/05/06) |
| 3 | `dwc._maplify_occurrences` | 05-03 | Maplify branch (25 cols, mirror of native) |
| 4 | **`dwc.occurrences`** | **05-04** | **UNION ALL of branches (M-02 / ALIGN-01)** |
| 5 | **`dwc.datasets`** | **05-04** | **Single-row VALUES view (M-03 / D-15..D-18)** |
| 6 | **`dwc.multimedia`** | **05-04** | **GBIF Simple Multimedia extension; native-only (POLICY §3.3 + §1.2 + §1.4)** |

Plus: final blanket `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated;` (Pitfall 5 — covers all six views in one statement; the schema-level `USAGE` grant from plan 05-01 makes them queryable, the new `SELECT` grant makes their rows readable).

**`supabase/config.toml` is unchanged** (verified `git diff --quiet`) — `dwc` deliberately stays out of `api.schemas` and `extra_search_path` so PostgREST never exposes it (T-05-01 mitigation).

### `dwc.datasets` — the single committed row (M-03 / M-04 evidence)

| Column | Value |
|--------|-------|
| `dataset_id` | `https://salishsea.io/datasets/occurrences-v1` (D-17) |
| `parent_dataset_id` | `NULL` (D-16) |
| `title` | `SalishSea.io Cetacean Occurrences (v1.2)` (matches native `datasetName` constant verbatim) |
| `abstract` | One-sentence placeholder per POLICY §6.7 — Phase 6 may overwrite |
| `pub_date` | `CURRENT_DATE::text` |
| `language` | `en` |
| `intellectual_rights` | `https://creativecommons.org/licenses/by-nc/4.0/legalcode` (POLICY §1.1 native default; §6.6 reconciles Maplify per-row) |
| `creator_name` / `creator_email` / `creator_role` | `SalishSea.io` / `rainhead@gmail.com` / `originator` (D-18, M-04) |
| `metadata_provider_name` / `metadata_provider_email` | `SalishSea.io` / `rainhead@gmail.com` (M-04) |
| `contact_name` / `contact_email` / `contact_role` | `Peter Abrahamsen` / `rainhead@gmail.com` / `pointOfContact` (D-18 individual contact, M-04) |
| `geographic_coverage` | `NULL` (Phase 6 authors — POLICY §6.7) |
| `temporal_coverage` | `NULL` (Phase 6 computes at gen time — POLICY §6.5) |
| `taxonomic_coverage` | `Cetacea (Order)` (POLICY §6.5 stated) |
| `methods` | `NULL` (Phase 6 authors — POLICY §6.7) |

**M-04 evidence:** `grep -c "'rainhead@gmail.com'::text" supabase/migrations/20260617203900_dwc_schema.sql = 3` (creator_email, metadata_provider_email, contact_email — three places, all committed verbatim per M-04). **D-15 evidence:** `dwc.datasets` is a `CREATE VIEW … SELECT * FROM (VALUES …)` (not a table or materialized view); confirms the "every metadata edit becomes a migration" pattern.

### `dwc.multimedia` — D-19 license CASE evidence

The seven CC enum members map to their canonical `/legalcode` URIs. The D-19 two-branch distinction:

- `WHEN 'none' THEN NULL` — terminal: "no redistributable license."
- `ELSE NULL` — catches `IS NULL` ("unknown / unclassified", non-terminal; forward-compat for a future `DROP NOT NULL` per Discrepancy 2).

Filter: `WHERE op.license_code IS NOT NULL AND op.license_code <> 'none'` — both branches excluded in v1.2 per POLICY §1.4. Joins: `public.observation_photos op JOIN public.observations o ON o.id = op.observation_id JOIN public.contributors c ON c.id = o.contributor_id`. `coreId = 'salishsea:' || op.observation_id::text` matches the native branch's `occurrenceID` (DWCA-03 readiness). Columns emitted: `coreId`, `type` (`StillImage`), `identifier` (`op.href`), `license` (CASE), `rightsHolder` (`c.name`), `creator` (`c.name`). Optional columns (`format`, `references`, `title`, `description`, `created`, `contributor`, `publisher`, `audience`) are omitted entirely rather than emitted as NULL.

### `supabase/snippets/05_dwc_assertions.sql` — 17 assertion blocks (Task 2)

Header: `\set ON_ERROR_STOP on` + `\echo === Phase 5 DwC projection verification ===`. Trailer: `\echo === All assertions passed ===`.

Each block follows the pattern: `\echo <REQ-ID>: <description>` + `DO $$ DECLARE n INTEGER; BEGIN SELECT … INTO n FROM …; IF (assertion fails) THEN RAISE EXCEPTION '<REQ-ID> FAIL: …', n; END IF; END $$;`

Empty-table SKIP branches on ALIGN-01, ALIGN-04 axis-sanity, D-15/D-16, and D-20 so the harness produces meaningful output even with an empty seed (the count-match M-05 assertion still catches the case where `dwc.taxa_classification` is empty when `inaturalist.taxa` has rows).

The 17 assertions, by requirement coverage:

| # | Requirement | Behavior |
|---|-------------|----------|
| 1 | ALIGN-01 | `dwc.occurrences` source prefixes ⊆ `{salishsea, maplify}` |
| 2 | ALIGN-02 | 4 GBIF-required terms (`occurrenceID`, `basisOfRecord`, `scientificName`, `eventDate`) NOT NULL |
| 3 | ALIGN-03 | No fabricated binomial (genus NULL for family-and-above ranks) |
| 4 | ALIGN-03 | `taxonRank` populated on every row |
| 5 | ALIGN-04 | lat/lon in valid global range (`-90..90`, `-180..180`) |
| 6 | ALIGN-04 | Axis sanity (nearest point to mid-Haro-Strait lands in Salish Sea bbox — catches X/Y swap) |
| 7 | ALIGN-04 | `coordinateUncertaintyInMeters` never 0 |
| 8 | ALIGN-04 | `geodeticDatum` at most one distinct value (constant `WGS84`) |
| 9 | ALIGN-05 | Maplify `eventDate` date-only (no `T`) |
| 10 | ALIGN-05 | Native `eventDate` includes time component (`T` present) |
| 11 | ALIGN-06 | `occurrenceID` unique across all rows |
| 12 | M-05 | `taxa_classification` genus NULL for family-and-above leaf rank |
| 13 | M-05 | `taxa_classification` one row per `inaturalist.taxa` row |
| 14 | POLICY §1.4 | `dwc.multimedia` license never NULL (none/NULL exclusion holds) |
| 15 | DWCA-03 | Every `dwc.multimedia.coreId` joins `dwc.occurrences."occurrenceID"` |
| 16 | D-15/D-16 | `dwc.occurrences.datasetID` joins `dwc.datasets.dataset_id` |
| 17 | D-20 / §1.1 | `dwc.occurrences.license` ⊆ `{CC-BY-NC .../legalcode, CC-BY .../legalcode}` |

### `05-VALIDATION.md` — task IDs filled (Task 5)

Every `TBD` in the Per-Task Verification Map replaced with concrete IDs of the form `05-04-T2` (the harness scaffold) and `05-04-T4-{ALIGN|M05|POL|DWCA|D15-16|D20}` (the assertions exercised by Task 4). 18 rows total; `grep -c "^| 05-04-T" = 18`. Sign-off checklist updated; **`nyquist_compliant: false` and `wave_0_complete: false` remain** because the assertion suite has not been run against a live DB (see Deviations).

## Task Commits

| Task | Status | Commit | Description |
|------|--------|--------|-------------|
| Task 1: append `dwc.occurrences` UNION + `dwc.datasets` + `dwc.multimedia` + final grant | ✅ committed | `7e73915` | `feat(05-04): append dwc.occurrences UNION, dwc.datasets, dwc.multimedia, and final grants` |
| Task 2: author `supabase/snippets/05_dwc_assertions.sql` | ✅ committed | `3302d94` | `test(05-04): add psql assertion harness for Phase 5 contracts` |
| Task 3: `[BLOCKING] supabase db reset` | ⏸️ deferred | — | Local Supabase DB unavailable (Docker daemon down, port 54322 closed) — see User Setup Required |
| Task 4: `[BLOCKING] psql -f 05_dwc_assertions.sql` | ⏸️ deferred | — | Cannot run without Task 3's DB push completing first |
| Task 5: finalize `05-VALIDATION.md` (task-ID fill-in) | ✅ committed | `83f5fd2` | `docs(05-04): fill task IDs in VALIDATION verification map` |

## Files Created/Modified

- **`supabase/migrations/20260617203900_dwc_schema.sql`** — extended by ~218 lines. Three `CREATE VIEW` statements (`dwc.occurrences` UNION, `dwc.datasets` single-row VALUES view, `dwc.multimedia` with D-19 two-branch CASE), three `COMMENT ON VIEW` statements explaining the policy encoding, and one final blanket `GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated`. Total file length: 717 lines, 6 `CREATE VIEW` statements.
- **`supabase/snippets/05_dwc_assertions.sql`** — new file, 311 lines, 17 `DO $$ BEGIN ... END $$;` assertion blocks + header + footer + per-block `\echo` labels.
- **`.planning/phases/05-db-projection-dwc-schema/05-VALIDATION.md`** — modified. All 18 `TBD` task-ID cells filled in (`05-04-T2`, `05-04-T4-*`); sign-off checklist marked complete except `nyquist_compliant: true`; Approval section now documents the deferred state and the user-runnable command sequence to flip the gates to green.

## Decisions Made

- **Bare `SELECT * UNION ALL` at `dwc.occurrences` (no explicit column list).** Letting Postgres enforce 25-column / type parity at `CREATE VIEW` time is RESEARCH §"Pattern 1: View-as-export-contract" — any drift between branches fails the migration loudly. An explicit projection list would have to be maintained in lockstep with both branches; the bare form trusts the branch contracts and shifts the integrity check to the database.
- **`dwc.datasets` as a view-over-VALUES (not a table).** M-03 locked this. The 19-column shape is sized for future per-constituent rows per POLICY §6.2; v1.2 ships with one row, and adding a Maplify-as-constituent row in a follow-up phase is a one-line VALUES extension.
- **`dwc.multimedia` is native-only.** POLICY §1.4 + assumption A3: `maplify.sightings.photo_url` has no license column, so all Maplify photos are excluded; the view does not reference `maplify.*` at all. DWCA-03 readiness (every `coreId` joins `dwc.occurrences`) holds because the join key matches the native branch's `occurrenceID` exactly (`'salishsea:' || op.observation_id::text`).
- **D-19 distinct CASE branches even though both currently map to NULL.** RESEARCH Option 1 (recommended): encode the semantic distinction (`WHEN 'none' THEN NULL` for terminal vs `ELSE NULL` for unknown / unclassified) faithfully to POLICY §1.2, even though v1.2 excludes both via the same `WHERE` predicate. A future "classify your unclassified photos" workflow could swap `ELSE NULL` for a real URI without touching the `'none'` arm. Comment in the migration cross-references Discrepancy 2.
- **Final blanket `GRANT SELECT ON ALL TABLES IN SCHEMA dwc` at file tail.** Pitfall 5: deferred from plan 05-01 so a single statement covers every view authored by 05-01..05-04. "ALL TABLES" includes views in Postgres. The schema-level `USAGE` grant (also plan 05-01) makes the views queryable; `SELECT` here makes their rows readable.
- **Assertion suite run deferred to user.** I detected the missing local DB pre-flight: `command -v supabase` returns no path, `npx supabase --version` reports `2.101.0` is available, but `docker ps` reports the daemon is not running and `nc -zv 127.0.0.1 54322` reports connection refused. Without Docker, `supabase db reset` cannot bring up a Postgres instance to apply migrations against. Per `<blocking_task_handling>` protocol: do NOT invent a passing verification — defer cleanly so the user can run the script themselves.
- **VALIDATION.md `nyquist_compliant` stays `false`.** A green gate on file existence would misrepresent the phase. The flip to `true` is contingent on `psql -v ON_ERROR_STOP=1 -f supabase/snippets/05_dwc_assertions.sql` exiting 0 against a populated local DB.

## Deviations from Plan

### [Rule 3-blocked - Environment] Tasks 3 and 4 deferred — local Supabase DB unavailable

- **Found during:** Pre-flight check before Task 3.
- **Issue:** The `[BLOCKING]` tasks 3 (`supabase db reset`) and 4 (`psql -f`) require a running local Postgres on `127.0.0.1:54322`. At execution time:
  - `command -v supabase` → not on PATH.
  - `npx --no-install supabase --version` → `2.101.0` (CLI is installed as a project devDependency).
  - `nc -zv 127.0.0.1 54322` → connection refused (no Postgres listening).
  - `docker ps` → `dial unix /Users/rainhead/.docker/run/docker.sock: no such file or directory` (Docker daemon not running).
  - The `supabase` CLI requires Docker to start its local stack; no Docker means `supabase db reset` cannot succeed.
- **Fix:** Per `<blocking_task_handling>` protocol — do NOT auto-fix (this is not a Rule 1/2/3 auto-fixable issue: starting Docker / installing the supabase CLI on PATH is user environment work, not project code). Instead:
  - Tasks 1 and 2 completed and committed (SQL + assertion script are valid as authored).
  - Task 5 completed (task-ID fill-in does not depend on a running DB).
  - Tasks 3 and 4 documented in this Deviations section + User Setup Required + the final response is `## CHECKPOINT REACHED` (type: human-action) with the exact user-runnable command sequence.
  - `05-VALIDATION.md` stays `nyquist_compliant: false` / `wave_0_complete: false`.
- **Files modified:** None (this is a deferred-execution note, not a code change).
- **Commit:** N/A.

All other deviations: none. Tasks 1, 2, and 5 executed exactly as the plan specifies. All Task-level `<verify><automated>` grep assertions pass.

## Threat Flags

None. The plan's `<threat_model>` (T-05-01 PostgREST exposure, T-05-02 D-09 contributor-name exposure, T-05-04 search-path tampering) is fully covered:

- **T-05-01** mitigated by `git diff --quiet supabase/config.toml` returning clean — `dwc` is not in `api.schemas` or `extra_search_path`. PostgREST cannot reach the views.
- **T-05-02** accepted — `dwc.multimedia.rightsHolder` / `dwc.multimedia.creator` = `c.name` per POLICY §3.3, mirroring the same intentional D-09 exposure as plan 05-02.
- **T-05-04** mitigated transitively — every reference to a source table in this plan's additions is fully qualified (`public.observation_photos`, `public.observations`, `public.contributors`, `dwc._native_occurrences`, `dwc._maplify_occurrences`).

No new threat surface introduced by this plan beyond what is in the `<threat_model>` block.

## User Setup Required

**Local DB push + assertion run** (closes the deferred Tasks 3 + 4):

```bash
# Prereq: Docker Desktop running.
# 1) Apply migrations + seed to the local Supabase Postgres:
npx supabase db reset

# 2) Verify the six dwc.* views exist:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -c '\dv dwc.*'
# expected: 6 views (taxa_classification, _native_occurrences, _maplify_occurrences, occurrences, datasets, multimedia)

# 3) Run the assertion suite:
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -v ON_ERROR_STOP=1 \
     -f supabase/snippets/05_dwc_assertions.sql
echo "exit code: $?"
# expected: 0; trailing line "=== All assertions passed ===" prints.
```

**On psql exit 0:** edit `.planning/phases/05-db-projection-dwc-schema/05-VALIDATION.md`:

- Flip frontmatter `nyquist_compliant: false` → `nyquist_compliant: true` and `wave_0_complete: false` → `wave_0_complete: true`.
- Flip the **last** sign-off checkbox to `[x]`.
- Update the **Approval** line to read `auto-approved by plan 05-04 task 4 — psql exit 0 on YYYY-MM-DD` (today's date).

**On psql failure:** the `RAISE EXCEPTION` message identifies the failing requirement ID and count. Fix the projection in `supabase/migrations/20260617203900_dwc_schema.sql`, re-run `supabase db reset`, re-run the assertion script. Repeat until exit 0. Common failure modes are catalogued in `05-04-PLAN.md` Task 4's action block.

## Self-Check

Verified after writing this summary:

```
$ git log --oneline | head -5
83f5fd2 docs(05-04): fill task IDs in VALIDATION verification map
3302d94 test(05-04): add psql assertion harness for Phase 5 contracts
7e73915 feat(05-04): append dwc.occurrences UNION, dwc.datasets, dwc.multimedia, and final grants
2052419 docs(05-03): complete dwc._maplify_occurrences branch view plan
9a81430 feat(05-03): wire Maplify dynamicProperties (4-key jsonb expression)

$ test -f supabase/migrations/20260617203900_dwc_schema.sql && echo FOUND
FOUND
$ test -f supabase/snippets/05_dwc_assertions.sql && echo FOUND
FOUND
$ test -f .planning/phases/05-db-projection-dwc-schema/05-VALIDATION.md && echo FOUND
FOUND

$ grep -c '^CREATE VIEW' supabase/migrations/20260617203900_dwc_schema.sql
6

$ grep -q 'GRANT SELECT ON ALL TABLES IN SCHEMA dwc TO anon, authenticated' supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK

$ grep -q 'CREATE VIEW dwc.occurrences AS' supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q 'CREATE VIEW dwc.datasets' supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q 'CREATE VIEW dwc.multimedia' supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q "WHEN 'none' THEN NULL" supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK
$ grep -q "'rainhead@gmail.com'::text" supabase/migrations/20260617203900_dwc_schema.sql && echo OK
OK

$ git diff --quiet supabase/config.toml && echo UNCHANGED
UNCHANGED

$ grep -q '^\\set ON_ERROR_STOP on' supabase/snippets/05_dwc_assertions.sql && echo OK
OK
$ grep -c 'RAISE EXCEPTION' supabase/snippets/05_dwc_assertions.sql
19

$ ! grep -q "^| TBD" .planning/phases/05-db-projection-dwc-schema/05-VALIDATION.md && echo NO-TBD
NO-TBD
```

## Self-Check: DEFERRED

The file-existence + commit-history portion of the self-check **passes** — every authored artifact exists, every committed task is in git history. The runtime portion (psql assertions actually executing against a live local DB) is **DEFERRED to the user** because Docker is not running. See **User Setup Required** above for the exact commands to complete validation.

## Phase 6 Readiness

Once the user has completed the assertion-suite run (per User Setup Required):

- Phase 6 (archive generation) reads `dwc.occurrences`, `dwc.multimedia`, and `dwc.datasets` via DuckDB ATTACH. The column order, types, and NULL handling are frozen here as the contract — Phase 6 never re-decides a column (POLICY §6.7).
- The Maplify QA pass (POLICY §4.5) and the GBIF DwC-A validator pass (DWCA-05) are explicitly out of Phase 5 scope and live in Phase 6.

---
*Phase: 05-db-projection-dwc-schema*
*Completed (Tasks 1, 2, 5): 2026-06-17*
*Tasks 3, 4: deferred to user (local Supabase DB unavailable at execution time)*
