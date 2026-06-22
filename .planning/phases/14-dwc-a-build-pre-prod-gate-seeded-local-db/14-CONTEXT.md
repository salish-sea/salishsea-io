# Phase 14: DwC-A Build Pre-Prod Gate (Seeded Local DB) - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the currently `describe.skip`'d, `SUPABASE_DB_URL`-gated `build.test.ts`
integration suite into a true **pre-merge CI gate** that runs `npm run build:dwca`
end-to-end against a **seeded local Postgres** on every PR — so build-time
SQL/query/wiring bugs (the class of bug fixed in `aad63dd`: bare un-`pgdb.`-qualified
schema refs that only surfaced in the nightly post-deploy) are caught before deploy
rather than after.

**In scope:** a deterministic CI fixture; wiring the Supabase local stack +
`SUPABASE_DB_URL` into PR CI so the DWCA-01..04/06 assertions execute; a verification
that the gate fails on a deliberate query regression.

**Out of scope (do NOT expand into these):** changing the DwC-A export scope
(iNat/HappyWhale stay out per SRC-01); copying prod data into the fixture; adding new
guard checks; touching the nightly post-deploy workflow's behavior.

**Locked (from milestone-close, carried forward):** CI uses the **Supabase local
stack** (`supabase start` / `db reset` / `db start`) — it ships PostGIS (`gis.ST_*`),
`pg_net`, `http`, `pg_cron` and auto-applies migrations. A bare Postgres service
container is **rejected** (the `dwc.occurrences` view chain depends on those extensions).

</domain>

<decisions>
## Implementation Decisions

### CI Job Placement
- **D-01:** **Extend the existing `build.yml` job** — do NOT add a separate
  workflow/job. `build.yml` already runs `supabase db start` + `npm test` on every PR
  (the stack is already standing up for the gen-types verification). Apply the CI
  fixture and export `SUPABASE_DB_URL` before the existing `npm test` step so the
  integration suite **un-skips in place**. The DwC-A gate thus becomes part of the
  existing required **Build** check — no new infra, one stack startup.
- **D-02:** The activation mechanism is unchanged: `build.test.ts` already keys off
  `SUPABASE_DB_URL` (`HAS_DSN` → `describe` vs `describe.skip`). The gate is "turned on"
  purely by exporting that env var in CI; the local-dev opt-in via `.env.local` stays
  exactly as documented in `build.test.ts`'s header.

### Gate Scope (what runs against the seed)
- **D-03:** Run **`build.test.ts` only** (DWCA-01..04/06: build + artifact
  introspection). **`guard.ts` stays nightly-only** — the gate does NOT run the
  G-01..G-04 size/row floors.
- **D-04:** Therefore **`ROW_FLOOR` is untouched** and there is **no need to fabricate
  1000+ rows** (this retires draft Success-Criterion #2). The fixture only needs to make
  `dwc.occurrences` / `dwc.multimedia` non-empty enough to satisfy the suite's
  assertions (DWCA-02 needs ≥1 occurrence row; DWCA-03 needs multimedia coreIds ⊆
  occurrence IDs; DWCA-06 needs parquet/source row-count parity).

### Fixture Home
- **D-05:** Use a **CI-only static fixture** (e.g. `supabase/ci-seed.sql`) applied
  **explicitly in CI** (psql/`db query`) after migrations. **Leave `supabase/seed.sql`
  alone** — it keeps its live API fetches (iNat / Maplify / HappyWhale) for local-dev
  realism. Two seed paths by design; local dev is unchanged.
- **D-06:** The fixture does **NOT** recreate reference rows. `providers` /
  `organizations` / `collections` are already seeded by migration
  `20260619184037_reference_tables.sql`, so they exist in CI after migrations apply.
  The fixture inserts only **source rows** (`maplify.sightings`, `public.observations`)
  plus any `contributors` / `taxa` rows they need, **referencing existing IDs**.

### Fixture Scope
- **D-07:** **Branch-covering minimal.** Smallest fixture that makes the suite pass AND
  deliberately exercises the bug-prone query branches:
  - `maplify.sightings`: **trusted + untrusted** comments, **bracket-tagged + untagged**
    comments, rows **with + without** `collection_id` — so trust-filtering and the
    Step 15.5 `recordedBy` / associated-parties query both produce output and can
    regress visibly.
  - `public.observations`: rows with valid `collection_id` / `contributor_id` /
    `taxon_id` FKs.
  - **≥1 multimedia / photo row** so `dwc.multimedia` is non-empty (DWCA-03).
  - A handful of rows per source table — not exhaustive coverage of every conditional.

### Claude's Discretion
- **Regression-proof (draft SC#4):** user did not flag this for discussion. **Default
  approach: a one-time manual red-test during execute** — on a scratch branch, revert
  the `aad63dd` fix (reintroduce a bare schema ref), run the gate, confirm it goes
  **red**, then restore. Document the result in verification. **Prefer this over a
  permanent committed negative/`.fails`-style test** to keep the suite clean. Planner may
  adjust if a lightweight permanent guard proves cheap.
- **Exact CI wiring details** (step ordering, env scoping to the `npm test` step vs
  job-wide, psql invocation) are left to the planner — the contract is: migrations
  applied → CI fixture applied → `SUPABASE_DB_URL` exported → `npm test` runs the
  un-skipped suite.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition & origin
- `.planning/ROADMAP.md` §"Phase 14" (lines ~196-215) — goal, locked Supabase-stack
  decision, draft success criteria, cross-cutting constraint.
- `.planning/todos/pending/2026-06-21-seeded-local-db-gate-for-dwca-build.md` — origin
  todo: full root-cause writeup of the coverage gap and the proposed solution. **Close
  this todo when Phase 14 completes** (`promoted_to: phase-14`).

### Code the gate exercises / modifies
- `scripts/dwca/build.test.ts` — the suite being un-skipped; header documents the
  `SUPABASE_DB_URL` gating contract and the DWCA-01..04/06 coverage. **Do not break the
  no-DSN skip path.**
- `scripts/dwca/build.ts` — the build run end-to-end; reads Postgres via DuckDB
  `ATTACH ... AS pgdb` (every relation must be `pgdb.`-qualified — the regressed
  invariant). Contains the Step 15.5 associated-parties / `recordedBy` query.
- `scripts/dwca/build-queries.test.ts` — the cheap static guard already shipped (greps
  `build.ts` for bare PG-schema refs). The new gate is the runtime complement; don't
  duplicate its job.
- `scripts/dwca/guard.ts` — `ROW_FLOOR`/floor logic (line ~41 supports the env
  override). **Out of scope for this gate** (nightly-only) per D-03.
- `supabase/seed.sql` — current live-API seed; **left unchanged** (D-05).
- `supabase/config.toml` §`[db.seed]` (line ~55) — `sql_paths = ["./seed.sql"]`; seed
  applies during `db reset`. Relevant to the open research question below.
- `supabase/migrations/20260619184037_reference_tables.sql` — seeds
  providers/organizations/collections (present in CI; fixture references these).
- `.github/workflows/build.yml` — the PR CI job to extend (already runs
  `supabase db start` + `npm test`).
- `.github/workflows/dwca-nightly.yml` — the post-deploy run this gate front-runs; do
  not change its behavior.

### Milestone context
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — v1.3 terminology, export scope (SRC-01:
  iNat/HappyWhale excluded from the archive), aggregator pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`build.yml`'s existing `supabase db start` + `npm test` steps** — the stack startup
  is already paid for; the gate is a seed + one env export away.
- **`build.test.ts`'s `HAS_DSN` gating** — no test-harness changes needed to activate;
  exporting `SUPABASE_DB_URL` flips `describe.skip` → `describe`.
- **Migration-seeded reference tables** — providers/orgs/collections exist post-migration,
  so the fixture is small.

### Established Patterns
- DuckDB `ATTACH ... AS pgdb` → all Postgres relations must be `pgdb.`-qualified (the
  exact invariant the gate must protect).
- DSN is never logged (`maskDsn` in `build.ts`/`guard.ts`); CI assembles
  `SUPABASE_DB_URL` and must keep it masked/un-logged.
- Local stack DSN convention: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

### Integration Points
- `build.yml`: insert "apply CI fixture" + "export `SUPABASE_DB_URL`" between
  `supabase db start` (after migrations) and `npm test`.

</code_context>

<specifics>
## Specific Ideas

- **Open research question (flag for researcher):** Confirm whether `supabase db start`
  (as used in `build.yml`) actually applies `seed.sql` in CI, and ensure the **live-fetch
  seed cannot make the gate network-flaky** — i.e. either the default seed is skipped in
  CI, or its live API calls are tolerant/no-op. The gate must be deterministic and not
  depend on external APIs being up.
- The regressed bug to reproduce for SC#4 is the one fixed in commit `aad63dd`
  (`Catalog Error: schema "maplify" does not exist`, nightly run 27916122893).

</specifics>

<deferred>
## Deferred Ideas

- Running `guard.ts` (floor checks) as part of PR CI — explicitly deferred; nightly-only
  for now (could revisit if floor logic regresses).
- A permanent committed negative/regression test for bare-schema refs — deferred in favor
  of the one-time manual red-test (Claude's Discretion above); revisit only if cheap.

None of the above expand the phase scope.

</deferred>

---

*Phase: 14-dwc-a-build-pre-prod-gate-seeded-local-db*
*Context gathered: 2026-06-21*
