# Phase 14: DwC-A Build Pre-Prod Gate (Seeded Local DB) — Research

**Researched:** 2026-06-21
**Domain:** CI integration testing — Supabase local stack, PostgreSQL fixture seeding, GitHub Actions workflow extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Extend the existing `build.yml` job — do NOT add a separate workflow/job. `build.yml` already runs `supabase db start` + `npm test` on every PR. Apply the CI fixture and export `SUPABASE_DB_URL` before the existing `npm test` step so the integration suite un-skips in place.

**D-02:** The activation mechanism is unchanged: `build.test.ts` already keys off `SUPABASE_DB_URL` (`HAS_DSN` → `describe` vs `describe.skip`). The gate is "turned on" purely by exporting that env var in CI.

**D-03:** Run **`build.test.ts` only** (DWCA-01..04/06: build + artifact introspection). **`guard.ts` stays nightly-only.** The gate does NOT run the G-01..G-04 size/row floors.

**D-04:** `ROW_FLOOR` is untouched and there is no need to fabricate 1000+ rows. The fixture only needs to make `dwc.occurrences` / `dwc.multimedia` non-empty enough to satisfy the suite's assertions.

**D-05:** Use a **CI-only static fixture** (e.g. `supabase/ci-seed.sql`) applied **explicitly in CI** after migrations. Leave `supabase/seed.sql` alone — it keeps its live API fetches for local-dev realism.

**D-06:** The fixture does **NOT** recreate reference rows. `providers` / `organizations` / `collections` are already seeded by migration `20260619184037_reference_tables.sql`, so they exist in CI after migrations apply. The fixture inserts only **source rows** (`maplify.sightings`, `public.observations`) plus any `contributors` / auth rows they need, **referencing existing IDs**.

**D-07:** **Branch-covering minimal.** Smallest fixture that makes the suite pass AND deliberately exercises the bug-prone query branches: trusted + untrusted Maplify rows, bracket-tagged + untagged comments, rows with/without `collection_id`, ≥1 multimedia/photo row, across `maplify.sightings` + `public.observations`.

### Claude's Discretion

- **Regression-proof (SC#4):** One-time manual red-test during execute — revert `aad63dd` fix on a scratch branch, confirm gate goes red, restore. Prefer this over a permanent committed negative test.
- **Exact CI wiring details** (step ordering, env scoping, psql invocation) are left to the planner.

### Deferred Ideas (OUT OF SCOPE)

- Running `guard.ts` (floor checks) as part of PR CI — nightly-only for now.
- A permanent committed negative/regression test for bare-schema refs — deferred in favor of the one-time manual red-test.
</user_constraints>

---

## Summary

This phase wires the already-written `build.test.ts` integration suite (DWCA-01..04/06) into PR CI by (a) applying a deterministic static fixture after `supabase db start` and (b) exporting `SUPABASE_DB_URL` scoped to the `npm test` step. The suite already exists and already self-skips when the DSN is absent; the gate is one fixture file + two new workflow lines.

**Critical finding — `supabase db start` vs seed.sql:** `supabase db start` in CI applies all migrations (including the reference-data migrations that seed `providers`, `organizations`, `collections`) but does **NOT** run `supabase/seed.sql`. Seed execution is exclusive to `supabase db reset`. The live-fetch seed (iNat/Maplify/HappyWhale calls) **cannot reach CI by any mechanism** — it is safe by default.

**Critical finding — column count:** The Phase 12 migration (`20260621000000_dwc_view_rebuild.sql`) rebuilds `dwc.occurrences` with **26 columns** (adds `institutionCode` at ordinal 19). `fields.ts`'s `OCCURRENCE_FIELDS` already has 26 entries. `build.test.ts` uses `OCCURRENCE_FIELDS.length` (not a hardcoded 25) for all assertions. The local dev DB is still at Phase 11 (25 columns), but CI (which applies all migrations) will produce the correct 26-column view.

**Primary recommendation:** Place the fixture at `supabase/ci-seed.sql` and apply it with `supabase db query --local --file supabase/ci-seed.sql` immediately after `supabase db start`. Export `SUPABASE_DB_URL` as a step-level env on the existing `npm test` step. No job-level secrets, no masking (local DSN is not a secret).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Migration application (CI) | Supabase CLI (`supabase db start`) | — | Supabase CLI manages the local Postgres container and applies all migrations on fresh start |
| Static fixture seeding (CI) | Supabase CLI (`supabase db query --local`) | psql fallback | Both work; `supabase db query` reuses the already-installed CLI binary |
| DSN injection for `build.test.ts` | GitHub Actions step env | — | Step-scoped `env:` is isolated to `npm test`, no job-wide env pollution |
| DwC build pipeline (under test) | DuckDB `ATTACH ... AS pgdb` | — | Reads Postgres read-only via DuckDB's postgres extension |
| Live API seed isolation | No action required | — | `seed.sql` only runs on `db reset`, never on `db start` |

---

## Open Research Questions — Resolved

### Q1: Does `supabase db start` apply seed.sql? [VERIFIED: Supabase CLI docs + local DB evidence]

**Answer: NO.** `supabase db start` applies all migrations but does NOT run `supabase/seed.sql`. Seeding is exclusive to `supabase db reset`.

Evidence:
- Official Supabase CLI reference for `db reset`: "If test data is defined in `supabase/seed.sql`, it will be seeded after the migrations are run." The `db start` reference page has no mention of seeding. [CITED: supabase.com/docs/reference/cli/supabase-db-reset]
- `supabase/config.toml` §`[db.seed]` comment: "seeds the database after migrations during a **db reset**" [VERIFIED: file read]
- Local DB evidence: `maplify.sightings` count is 507 (populated by past `supabase start` sessions that ran seed.sql), but in CI (fresh container) the count starts at 0.

**Consequence for Phase 14:** The live-fetch seed cannot reach CI at all. The static CI fixture must be applied explicitly after `db start`. No `--no-seed` flag or config change is needed to suppress the live seed.

---

### Q2: What is the exact schema the fixture must satisfy? [VERIFIED: local DB introspection]

#### `maplify.sightings` — required columns (no default):

| Column | Type | Notes |
|--------|------|-------|
| `id` | `integer NOT NULL` | Must be unique; provide explicit integer IDs |
| `project_id` | `integer NOT NULL` | Any integer; no FK |
| `trip_id` | `integer NOT NULL` | Any integer; no FK |
| `scientific_name` | `varchar NOT NULL` | Legacy field; still present but not used by DwC view |
| `location` | `gis.geography(Point) NOT NULL` | Use `gis.ST_Point(lng, lat)::gis.geography` |
| `number_sighted` | `integer NOT NULL` | Must be BETWEEN 1 AND 1000 to pass DwC WHERE filter |
| `created_at` | `timestamp NOT NULL` | No time zone; `NOW()` works |
| `in_ocean` | `boolean NOT NULL` | Any value |
| `moderated` | `smallint NOT NULL` | Any value |
| `trusted` | `boolean NOT NULL` | **Must be TRUE** for rows to appear in `dwc.occurrences` (Phase 12 WHERE adds `AND s.trusted`) |
| `is_test` | `boolean NOT NULL` | **Must be FALSE** |
| `source` | `varchar NOT NULL` | `'whale_alert'` is safe; avoid `'rwsas'` (filtered in WHERE) |

**Columns with defaults (may omit in INSERT):**
- `provider_id` — DEFAULT 2 (maplify); omit to use default
- All other columns (`photo_url`, `comments`, `usernm`, `name`, `taxon_id`, `collection_id`, `contributor_id`, `source_url`) are nullable

**Critical FK for DwC view inclusion:**
- `taxon_id` must be non-NULL and reference a valid `inaturalist.taxa(id)`. If NULL, the INNER JOIN in `dwc._maplify_occurrences` excludes the row from `dwc.occurrences`.
- Use `41521` (`Orcinus orca`, species rank) — confirmed present in `inaturalist.taxa`.

**Note on `inaturalist.taxa` schema location:** Despite migration `20250915171505_sighting_policies.sql` containing `ALTER TABLE inaturalist.taxa SET SCHEMA public`, the table lives in the `inaturalist` schema in the actual running DB (confirmed by `pg_tables` introspection and FK constraint dump). All downstream migrations (`20250919`, `20260617`, `20260621`, etc.) reference `inaturalist.taxa` consistently. The fixture references `inaturalist.taxa(id)` via the `taxon_id` FK on `maplify.sightings`. [VERIFIED: local DB psql]

#### `public.observations` — required columns (no default):

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid NOT NULL` | Use `gen_random_uuid()` or a fixed UUID |
| `observed_at` | `timestamptz NOT NULL` | `NOW()` works |
| `subject_location` | `gis.geography(Point,4326) NOT NULL` | Use `gis.ST_Point(lng, lat)::gis.geography` |
| `created_at` | `timestamp NOT NULL` | `NOW()` |
| `updated_at` | `timestamp NOT NULL` | `NOW()` |
| `taxon_id` | `integer NOT NULL` | FK to `inaturalist.taxa(id)` — use `41521` |
| `user_uuid` | `uuid NOT NULL` | FK to `auth.users(id)` — must insert auth user first |

**Columns with defaults (may omit in INSERT):**
- `provider_id` — DEFAULT 1 (direct)
- `collection_id` — DEFAULT 10 (salishsea-direct) → `dwc._native_occurrences` JOINs this so the default is safe

**Critical FK for DwC view inclusion:**
- `contributor_id` is nullable but `dwc._native_occurrences` uses `JOIN public.contributors c ON c.id = o.contributor_id` — if NULL, the row is excluded from `dwc.occurrences`. The fixture must set `contributor_id`.
- `user_uuid` is NOT NULL and references `auth.users(id)`. The `create_contributor_on_sign_in` trigger fires on `auth.users` INSERT and auto-creates a contributor. The fixture should insert a minimal `auth.users` row first (the trigger creates the contributor automatically).

#### `public.observation_photos` — required columns:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `integer NOT NULL` | Provide explicitly (no identity sequence confirmed) |
| `observation_id` | `uuid NOT NULL` | FK to `public.observations(id)` |
| `seq` | `smallint NOT NULL` | Photo sequence (1-based) |
| `href` | `varchar(2000) NOT NULL` | Photo URL |
| `license_code` | `varchar(20) NOT NULL` | Must NOT be `'none'` or NULL for `dwc.multimedia` inclusion; use `'cc-by'` |

#### `public.contributors` — structure (auto-created by trigger, or insert directly):

| Column | Type | Notes |
|--------|------|-------|
| `id` | `integer` (IDENTITY) | Auto-assigned |
| `name` | `varchar(100) NOT NULL` | Required |
| `entity_id` | `uuid` DEFAULT `gen_random_uuid()` | Auto-filled |
| `picture` | `varchar(1000)` | Nullable |
| `orcid` | `text` | Nullable |
| `inat_login` | `text` | Nullable |

#### Reference IDs confirmed in migration `20260619184037_reference_tables.sql`:

| Table | ID | Slug | Org? |
|-------|----|----|------|
| `public.providers` | 1 | direct | — |
| `public.providers` | 2 | maplify | — |
| `public.collections` | 1 | orca-network | org_id=1 (Orca Network) |
| `public.collections` | 10 | salishsea-direct | no org |
| `public.organizations` | 1 | orca-network | — |

---

### Q3: How does `build.test.ts` activate and what must be true? [VERIFIED: source read]

**Activation:** `const HAS_DSN = !!process.env['SUPABASE_DB_URL']`. When truthy, the top-level `describe` runs; when falsy, `describe.skip`. The env var is read at module load time, before any test runs. vitest.config.ts loads `.env.local` via `loadEnv`, which supplements but does not override `process.env`. A step-level `env:` block in the GitHub Actions `npm test` step makes `SUPABASE_DB_URL` visible to vitest.

**`beforeAll` behavior:** Calls `execSync('npm run build:dwca', { env: { ...process.env, SUPABASE_DB_URL: DSN } })`. Timeout is 60 000 ms. Forwards `build.ts`'s stdout/stderr to the test runner. The build pipeline exits non-zero on any failure, which causes `beforeAll` to throw and all tests in the suite to fail.

**What `build.ts` requires for success:**

1. `SUPABASE_DB_URL` set and reachable (step 1)
2. `dwc.occurrences` column list matches `OCCURRENCE_FIELDS` exactly (step 6 — `assertFieldAlignment`). After Phase 12 migration: 26 columns including `institutionCode`.
3. `dwc.multimedia` column list matches `MULTIMEDIA_FIELDS` (step 7)
4. **`dwc.occurrences` must be non-empty** (step 8 — `assertNonZeroRows`). This is the hard gate: the fixture MUST produce ≥1 row visible through the view's WHERE clause (i.e., trusted Maplify rows or native observations).
5. `dwc.datasets` must return exactly 1 row (step 16)
6. The Step 15.5 associated-parties query runs unconditionally — it is allowed to return 0 rows without failure (the EML will simply have no `associatedParty` entries). But for branch coverage, ≥1 trusted Maplify row with `collection_id` pointing to a collection with a non-null `organization_id` should be present.

**Per-test requirements:**

| Test | Minimum fixture data |
|------|---------------------|
| DWCA-01 (zip + parquet exist) | Any non-empty `dwc.occurrences` |
| DWCA-02 (meta.xml field indices) | Any non-empty `dwc.occurrences` + `dwc.multimedia` (header only is OK) |
| DWCA-02 round-trip (first row, 26 fields) | ≥1 row in `dwc.occurrences`; `rightsHolder` and `license` cells must be reachable strings (may be empty strings) |
| DWCA-03 (multimedia coreIds ⊆ occurrence IDs) | Passes trivially if `multimedia.txt` is header-only (no photo rows). If photos are present, their `coreId` must match an occurrence `occurrenceID`. |
| DWCA-04 (no BOM, 26 columns per row) | ≥1 occurrence row with no embedded tabs in freetext columns |
| DWCA-06 (GeoParquet metadata + row parity) | `dwc.occurrences` rows must have non-null `decimalLatitude`/`decimalLongitude` for `ST_Point`; parquet row count must equal view row count |

---

### Q4: Exact `build.yml` edit [VERIFIED: workflow file read + CLI docs]

**Current workflow (abbreviated):**
```yaml
- run: supabase db start
- name: Verify generated types match Postgres schema
  run: |
    npm run gen-types
    ...
- run: npm run build
- run: npm test
```

**Phase 14 additions:**

```yaml
- run: supabase db start

# NEW: Apply static CI fixture (reference data already seeded by migrations)
- name: Apply CI seed fixture
  run: supabase db query --local --file supabase/ci-seed.sql

- name: Verify generated types match Postgres schema
  run: |
    npm run gen-types
    ...

- run: npm run build

# MODIFIED: export SUPABASE_DB_URL scoped to this step only
- name: Run tests
  run: npm test
  env:
    SUPABASE_DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

**Rationale for placement:**
- Fixture must come AFTER `supabase db start` (migrations need to be applied first, including reference-table seeds)
- Fixture must come BEFORE `npm test` (obviously)
- gen-types and `npm run build` do not need `SUPABASE_DB_URL` — scoping to `npm test` step prevents any accidental leakage in build step logs
- The local DSN `postgresql://postgres:postgres@127.0.0.1:54322/postgres` is the documented Supabase local stack default — not a secret, no masking needed

**No `name:` label on existing `supabase db start` step** — the current file uses `- run: supabase db start` without a name. Add a `name:` to the fixture step but leave the existing step as-is to minimize diff.

---

### Q5: How to apply a `.sql` fixture file in CI [VERIFIED: supabase CLI npx run]

**Best option: `supabase db query --local --file <path>`**

The `supabase db query` command (available in CLI v2.53.6, already installed by `supabase/setup-cli` in `build.yml`) supports:
- `--local` — targets the local Postgres container (port 54322)
- `--file, -f` — path to SQL file to execute

```yaml
- name: Apply CI seed fixture
  run: supabase db query --local --file supabase/ci-seed.sql
```

No psql binary required, no explicit DSN string in the command, no password in shell history.

**Fallback option (if CLI version changes break `--local`):**
```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/ci-seed.sql
```
psql is preinstalled on `ubuntu-latest` GitHub Actions runners.

---

## Standard Stack

### Core (no new packages — Phase 14 is configuration-only)

| Component | Current Version | Purpose |
|-----------|----------------|---------|
| `supabase/setup-cli` | `v1` (pinned to `3c2f5e2`) | Installs Supabase CLI v2.53.6 in CI |
| Supabase CLI | 2.53.6 | Runs `db start`, `db query --local` |
| Vitest | (existing) | Runs `build.test.ts` |
| DuckDB `@duckdb/node-api` | (existing) | Used by `build.ts` + DWCA-06 in `build.test.ts` |

No new npm packages. No new workflow dependencies. This phase is purely additive configuration (one SQL file + two new workflow lines).

---

## Architecture Patterns

### System Architecture Diagram

```
GitHub Actions PR trigger
    │
    ▼
supabase db start
    │  (applies all migrations, including 20260619184037_reference_tables.sql
    │   which seeds providers/organizations/collections)
    ▼
supabase db query --local --file supabase/ci-seed.sql
    │  (inserts test rows into maplify.sightings + public.observations
    │   + public.observation_photos; references existing provider/collection IDs)
    ▼
npm run build  ──────────────────────────────────────────────────────────────────
    │                                                                            │
    ▼                                                                            │
npm test [with SUPABASE_DB_URL set]                                             │
    │                                                                            │
    ├── build-queries.test.ts  (static guard: grep build.ts for bare schema refs)
    │                                                                            │
    └── build.test.ts  (DWCA-01..04/06 integration suite)                       │
          │                                                                      │
          ├── beforeAll: npm run build:dwca ──────────────────────────────────► │
          │       │                                                              │
          │       ▼ (build.ts pipeline)                                          │
          │   DuckDB ATTACH 'postgresql://...54322/postgres' AS pgdb (READ_ONLY) │
          │       │                                                              │
          │       ├── DESCRIBE pgdb.dwc.occurrences  (26-column assertion)      │
          │       ├── DESCRIBE pgdb.dwc.multimedia                              │
          │       ├── assertNonZeroRows(pgdb.dwc.occurrences)  ← fixture feeds this
          │       ├── COPY occurrence.txt                                        │
          │       ├── COPY multimedia.txt                                        │
          │       ├── COPY parquet                                               │
          │       ├── Step 15.5: SELECT org.name FROM pgdb.maplify.sightings JOIN ... ← pgdb-qualified
          │       └── SELECT * FROM pgdb.dwc.datasets LIMIT 1                  │
          │                                                                      │
          ├── DWCA-01: zip + parquet artifacts exist                             │
          ├── DWCA-02: meta.xml field indices ↔ OCCURRENCE_FIELDS              │
          ├── DWCA-03: multimedia.coreId ⊆ occurrence.occurrenceID             │
          ├── DWCA-04: no BOM, exactly 26 tab-columns per row                  │
          └── DWCA-06: GeoParquet metadata + 26 columns + row parity           │
```

### Recommended Project Structure

```
supabase/
├── seed.sql          # UNCHANGED — live API fetch seed, local dev only
├── ci-seed.sql       # NEW — static CI fixture, applied explicitly in CI
migrations/
├── ...               # UNCHANGED
.github/workflows/
├── build.yml         # MODIFIED — two new lines (fixture + env)
```

### Pattern: Fixture Design for Minimal DwC Branch Coverage

The fixture must produce ≥1 row in `dwc.occurrences` (via the trusted-only Maplify branch or native branch) and exercise the bug-prone query paths.

**Recommended `supabase/ci-seed.sql` structure:**

```sql
-- Phase 14 CI-only static fixture.
-- Applied via: supabase db query --local --file supabase/ci-seed.sql
-- Providers / organizations / collections are already seeded by migrations.
-- This file inserts only source rows referencing existing IDs.

-- ============================================================
-- 1. Native observations (for dwc._native_occurrences + dwc.multimedia)
-- ============================================================
-- Insert a minimal auth.users row; the trigger auto-creates a contributor.
INSERT INTO auth.users (id, email, created_at, updated_at, raw_user_meta_data)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'ci-gate@example.com',
  NOW(), NOW(),
  '{"name": "CI Gate Test"}'::jsonb
);

-- The trigger has now created a contributor named 'CI Gate Test'.
-- Insert a native observation using that contributor.
DO $$
DECLARE
  v_contrib_id INTEGER;
BEGIN
  SELECT contributor_id INTO v_contrib_id
    FROM user_contributor
    WHERE user_uuid = '00000000-0000-0000-0000-000000000001';

  INSERT INTO public.observations (
    id, observed_at, subject_location, taxon_id, count,
    contributor_id, -- required for dwc._native_occurrences JOIN
    user_uuid, created_at, updated_at
    -- collection_id defaults to 10 (salishsea-direct)
    -- provider_id defaults to 1 (direct)
  ) VALUES (
    gen_random_uuid(),
    NOW() - INTERVAL '1 day',
    gis.ST_Point(-123.3, 48.4)::gis.geography,
    41521, -- Orcinus orca
    2,
    v_contrib_id,
    '00000000-0000-0000-0000-000000000001',
    NOW(), NOW()
  );

  -- Insert a photo so dwc.multimedia is non-empty (DWCA-03 coverage).
  INSERT INTO public.observation_photos (id, observation_id, seq, href, license_code)
  SELECT
    1,
    o.id,
    1,
    'https://example.com/ci-gate-test-photo.jpg',
    'cc-by'
  FROM public.observations o
  WHERE o.contributor_id = v_contrib_id
  LIMIT 1;
END $$;

-- ============================================================
-- 2. Maplify sightings (for dwc._maplify_occurrences + Step 15.5)
-- ============================================================

-- Row A: trusted=TRUE, bracket-tagged comment (recordedBy extractable),
--        collection_id=1 (orca-network, has org) → appears in Step 15.5 results.
INSERT INTO maplify.sightings (
  id, project_id, trip_id, scientific_name, location,
  number_sighted, created_at, in_ocean, moderated, trusted, is_test,
  source, comments, taxon_id, collection_id
) VALUES (
  1, 100, 200, 'Orcinus orca',
  gis.ST_Point(-122.9, 48.5)::gis.geography,
  3, NOW() - INTERVAL '2 days', TRUE, 1, TRUE, FALSE,
  'whale_alert',
  '[Orca Network] 3 orcas heading north (Jane Smith)<br>All adults.',
  41521, -- Orcinus orca
  1      -- orca-network collection (organization_id = 1)
);

-- Row B: trusted=FALSE → excluded from dwc.occurrences by WHERE s.trusted.
--        Exercises the trust-filtering branch: the fixture has this row but
--        it SHOULD NOT appear in dwc.occurrences.
INSERT INTO maplify.sightings (
  id, project_id, trip_id, scientific_name, location,
  number_sighted, created_at, in_ocean, moderated, trusted, is_test,
  source, taxon_id
) VALUES (
  2, 100, 200, 'Orcinus orca',
  gis.ST_Point(-123.1, 48.6)::gis.geography,
  1, NOW() - INTERVAL '3 days', TRUE, 0, FALSE, FALSE,
  'whale_alert',
  41521
);

-- Row C: trusted=TRUE, NO bracket tag (recordedBy regex returns NULL),
--        collection_id=NULL (no org) → appears in dwc.occurrences but NOT
--        in Step 15.5 associatedParties.
INSERT INTO maplify.sightings (
  id, project_id, trip_id, scientific_name, location,
  number_sighted, created_at, in_ocean, moderated, trusted, is_test,
  source, comments, taxon_id
) VALUES (
  3, 100, 200, 'Orcinus orca',
  gis.ST_Point(-123.0, 48.7)::gis.geography,
  2, NOW() - INTERVAL '4 days', TRUE, 1, TRUE, FALSE,
  'whale_alert',
  'Three orcas spotted near the rocks.',
  41521
);
```

**Expected post-fixture state:**
- `dwc.occurrences`: ≥3 rows (1 native + 2 trusted Maplify; untrusted Row B excluded)
- `dwc.multimedia`: ≥1 row (the native observation photo)
- Step 15.5 query returns `['Orca Network']` (from Row A's collection → org)

### Anti-Patterns to Avoid

- **Setting `SUPABASE_DB_URL` job-wide in the env block:** Exposes the DSN to unrelated steps (build, gen-types). Use step-level `env:` on the `npm test` step only.
- **Running `supabase db reset` instead of `supabase db start` + fixture:** `db reset` runs `seed.sql` which makes live API calls (iNat, Maplify, HappyWhale) — this will fail in CI and is deterministically broken. Do not use `db reset`.
- **Applying the fixture before `supabase db start`:** Migrations haven't run yet, reference tables don't exist, FKs will fail.
- **Using `number_sighted` outside `BETWEEN 1 AND 1000`:** The DwC view's WHERE clause filters these out; the row won't appear in `dwc.occurrences`.
- **Setting `taxon_id = NULL` on maplify.sightings fixture rows:** The INNER JOIN `dwc._maplify_occurrences JOIN dwc.taxa_classification tc ON tc.taxon_id = s.taxon_id` excludes NULL rows.
- **Setting `trusted = FALSE` on all Maplify rows:** The Phase 12 WHERE clause (`AND s.trusted`) excludes all of them; `dwc.occurrences` stays empty; `assertNonZeroRows` fails.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Applying SQL to local Supabase in CI | A custom Node script to send SQL | `supabase db query --local --file` | Already in the installed CLI (v2.53.6), handles auth/port automatically |
| Fixture seeding with complex FK chains | Complex Bash script with psql commands | A single `supabase/ci-seed.sql` with a DO $$ block | Single file, transactional, easy to review |
| DSN construction in CI | Assembling a DSN string from parts | Use the literal `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Supabase local stack uses these fixed credentials by design |

---

## Common Pitfalls

### Pitfall 1: `supabase db start` seed.sql confusion
**What goes wrong:** Assuming `db start` runs `seed.sql` and that the live-fetch seed will pollute CI or need suppression.
**Why it happens:** `supabase start` (full stack) and `db reset` both run seed.sql; `db start` (DB only) does not.
**How to avoid:** No config change needed. The live seed is completely inert in CI. The static fixture is the ONLY seed applied. [VERIFIED: official CLI docs + local DB evidence]

### Pitfall 2: Maplify rows with `trusted = FALSE` appearing in `dwc.occurrences`
**What goes wrong:** The fixture has untrusted rows but the suite's `assertNonZeroRows` fails because `dwc.occurrences` is empty.
**Why it happens:** Phase 12's `dwc._maplify_occurrences` adds `AND s.trusted` to the WHERE clause. The local dev DB (which doesn't have Phase 12 applied yet) does NOT have this filter — so a developer testing the fixture locally may see rows, but CI (with Phase 12 applied) sees nothing.
**How to avoid:** Always include at least one row with `trusted = TRUE` AND a valid non-null `taxon_id`. The fixture's Row A and Row C both satisfy this.
**Warning signs:** `build.test.ts` fails with "assertNonZeroRows: dwc.occurrences is empty" after Phase 12 applies.

### Pitfall 3: Missing `contributor_id` on native observations
**What goes wrong:** Native observations are inserted but don't appear in `dwc.occurrences`.
**Why it happens:** `dwc._native_occurrences` uses `JOIN public.contributors c ON c.id = o.contributor_id` — an INNER JOIN. If `contributor_id` is NULL, the row is excluded.
**How to avoid:** The fixture must set `contributor_id` explicitly. The recommended approach: insert into `auth.users` first (trigger creates contributor), then use `SELECT contributor_id FROM user_contributor WHERE user_uuid = <uuid>` in a DO block.

### Pitfall 4: Column count mismatch (25 vs 26)
**What goes wrong:** `assertFieldAlignment` fails with "column count mismatch: view has 25 columns, OCCURRENCE_FIELDS has 26."
**Why it happens:** Phase 12 migration (`20260621000000_dwc_view_rebuild.sql`) is not applied. This happens if CI for some reason doesn't apply Phase 12 (e.g., migration file was added to the repo but the `supabase db start` step cached an older image).
**How to avoid:** Ensure the Phase 12 migration file is committed before Phase 14's PR is merged. In CI, `db start` applies all migrations in the `supabase/migrations/` directory.

### Pitfall 5: Fixture applied to a non-empty DB (local dev)
**What goes wrong:** Running `supabase db query --local --file supabase/ci-seed.sql` locally after running `supabase start` (which ran seed.sql) causes PRIMARY KEY conflicts on the integer IDs (1, 2, 3 in `maplify.sightings`).
**How to avoid:** The CI fixture is named `ci-seed.sql` specifically to signal it is CI-only. Add a comment header to the file stating it should only be run in CI or on a freshly-reset local DB. Use `ON CONFLICT DO NOTHING` on the maplify INSERTs as belt-and-suspenders.

### Pitfall 6: Step 15.5 query uses bare schema refs (the aad63dd regression)
**What goes wrong:** Gate fails with `Catalog Error: schema "maplify" does not exist`.
**Why it happens:** Any Postgres relation in `build.ts` accessed through DuckDB must be `pgdb.`-qualified. A bare `FROM maplify.sightings` resolves against DuckDB's own catalog, which has no `maplify` schema.
**How to avoid:** `build-queries.test.ts` (the static guard) catches this at unit-test time. The Phase 14 gate is the runtime complement that catches new query additions.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing, no config changes needed) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| Gate activation | `SUPABASE_DB_URL` exported → `describe.skip` becomes `describe` | integration | `SUPABASE_DB_URL=... npm test` | ✅ `scripts/dwca/build.test.ts` |
| DWCA-01 | Zip + parquet artifacts exist and non-empty | integration | same | ✅ |
| DWCA-02 | meta.xml field indices round-trip with `OCCURRENCE_FIELDS` | integration | same | ✅ |
| DWCA-03 | `multimedia.coreId ⊆ occurrence.occurrenceID` | integration | same | ✅ |
| DWCA-04 | No BOM, 26 tab-columns per row | integration | same | ✅ |
| DWCA-06 | GeoParquet metadata + column count + row parity | integration | same | ✅ |
| SC#4 regression gate | Bare-schema-ref regression causes gate failure | manual one-time red-test | scratch branch + revert `aad63dd` | ❌ manual |
| No-DSN skip | Fresh checkout without DB still passes `npm test` | unit (existing) | `npm test` (no DSN) | ✅ |

### Wave 0 Gaps

- [ ] `supabase/ci-seed.sql` — new file to create (Wave 1 task)
- [ ] `.github/workflows/build.yml` edit — two-line addition (Wave 1 task)

---

## Environment Availability

| Dependency | Required By | Available in CI | Version | Notes |
|------------|------------|----------------|---------|-------|
| Supabase CLI | `supabase db start`, `db query --local` | ✓ | 2.53.6 (pinned in build.yml) | Installed by `supabase/setup-cli` step |
| PostgreSQL (local stack) | Fixture target | ✓ | 17 (from `config.toml major_version`) | Started by `supabase db start` on port 54322 |
| `unzip` (system) | DWCA-01 assertion in `build.test.ts` | ✓ | preinstalled on ubuntu-latest | Used to enumerate zip contents |
| DuckDB `postgres` extension | DWCA-06 row parity | ✓ | fetched at runtime by DuckDB | Network required in CI runner (standard) |

---

## Security Domain

Security enforcement is not relevant to this phase — the work is CI configuration and test fixture data only. No user-facing authentication, no secrets introduced, no new attack surface. The local Postgres DSN (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) uses the well-known Supabase local dev credentials and is not sensitive.

The existing `maskDsn` function in `build.ts` and `guard.ts` already protects the DSN from being logged. The phase does not change this behavior.

---

## Sources

### Primary (HIGH confidence)
- `/Users/rainhead/dev/salishsea-io/scripts/dwca/build.test.ts` — activation logic, test assertions, beforeAll behavior. Read in full.
- `/Users/rainhead/dev/salishsea-io/scripts/dwca/build.ts` — DuckDB ATTACH pattern, Step 15.5 query, column qualification requirement, `assertNonZeroRows` gate.
- `/Users/rainhead/dev/salishsea-io/supabase/config.toml` — `[db.seed] sql_paths = ["./seed.sql"]` with "seeds the database after migrations during a **db reset**" annotation.
- `/Users/rainhead/dev/salishsea-io/supabase/migrations/20260619184037_reference_tables.sql` — providers, organizations, collections seeded in migration (available in CI after db start).
- `/Users/rainhead/dev/salishsea-io/supabase/migrations/20260621000000_dwc_view_rebuild.sql` — Phase 12 view: adds `institutionCode` at ordinal 19, adds `AND s.trusted` to Maplify WHERE, changes from INNER JOIN to LEFT JOIN collections.
- `/Users/rainhead/dev/salishsea-io/supabase/migrations/20260619203013_source_table_fk_columns.sql` — confirms `provider_id NOT NULL DEFAULT 2` on `maplify.sightings`, `provider_id NOT NULL DEFAULT 1` + `collection_id DEFAULT 10` on `public.observations`.
- Local DB introspection via psql at `127.0.0.1:54322` — confirmed column lists, FK constraints, taxa in `inaturalist` schema, provider/collection IDs.
- `supabase db query --help` (via npx) — confirmed `--local` and `--file` flags.
- [CITED: supabase.com/docs/reference/cli/supabase-db-reset] — seed.sql only runs on `db reset`, not `db start`.
- [CITED: github.com/supabase/setup-cli README] — `supabase db start` "executes all migrations on a fresh database."

### Secondary (MEDIUM confidence)
- `/Users/rainhead/dev/salishsea-io/.github/workflows/build.yml` — current workflow confirming step order and `supabase db start` invocation.
- `/Users/rainhead/dev/salishsea-io/scripts/dwca/fields.ts` — `OCCURRENCE_FIELDS` has 26 entries; `MULTIMEDIA_FIELDS` has 6.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `auth.users` INSERT trigger fires synchronously in the Supabase local stack, creating the contributor before the subsequent DO block runs. | Fixture Design | If async, the DO block's `SELECT contributor_id FROM user_contributor` returns no rows; observation insert uses NULL contributor_id; dwc.occurrences is empty. Mitigation: add an explicit INSERT INTO `public.contributors` + `public.user_contributor` in the DO block instead of relying on the trigger. |
| A2 | `supabase db query --local --file` is available at CLI version 2.53.6 (the pinned version in build.yml). | Q5 fixture application | If `--local --file` was added in a later version, CI would fail with "unknown flag". Mitigation: verify flag availability or fall back to `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f`. |
| A3 | In CI with a fresh ubuntu-latest runner, `supabase db start` produces a DB with `inaturalist.taxa` as the table location (not `public.taxa`), matching the current local DB state. | Q2 schema | If migration `20250915171505_sighting_policies.sql`'s `ALTER TABLE inaturalist.taxa SET SCHEMA public` executes successfully in CI but the subsequent migration `20250919034327` then fails with FK error, the migration chain breaks. This would make CI un-trustworthy. Mitigation: verify by running `supabase db reset` locally; if it fails on 20250919, the migration file needs to be repaired. |

---

## Metadata

**Confidence breakdown:**
- Fixture schema (column lists, FK constraints): HIGH — verified by live DB introspection
- `supabase db start` seeding behavior: HIGH — verified by config.toml annotation + CLI docs
- Step 15.5 associatedParties query behavior: HIGH — source code read in full
- Migration chain integrity in CI (A3 above): MEDIUM — local DB evidence is consistent but the 20250915 SET SCHEMA contradiction has not been tested via `supabase db reset`

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (migrations and CI infrastructure are stable; no external dependencies)
