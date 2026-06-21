---
created: 2026-06-21T20:40:00.000Z
updated: 2026-06-21T20:40:00.000Z
title: Make the DwC-A build query a real pre-prod gate (seeded local DB)
area: phase-13-followup
resolves_phase: 13
files:
  - scripts/dwca/build.test.ts
  - scripts/dwca/build.ts
  - supabase/seed.sql
  - vitest.config.ts
related:
  - scripts/dwca/build-queries.test.ts
  - .planning/phases/12-dwc-view-rebuild/12-02-SUMMARY.md
---

## Problem ("Looks Done But Isn't" — surfaced during Phase 12)

Phase 12 shipped a Step 15.5 associated-parties query in `build.ts` with **bare
Postgres schema refs** (`maplify.sightings`, `public.collections`, ...). `build.ts`
reads Postgres through a DuckDB `ATTACH ... AS pgdb` alias, so every relation must
be `pgdb.`-qualified. The bare refs failed at runtime with
`Catalog Error: schema "maplify" does not exist` — but this **only surfaced in the
nightly build against prod** (run 27916122893, fixed in `aad63dd`), AFTER Phase 12
deployed.

Root cause of the coverage gap: `build.test.ts` (the only integration test that runs
`npm run build:dwca` end-to-end) is **gated on `SUPABASE_DB_URL`** and `describe.skip`s
on a fresh checkout / in CI — nobody wires a DB into it. So `build.ts` first touches a
real database in the **nightly, post-deploy** — the latest possible moment. Unit tests
(`eml.test.ts`, `meta-xml.test.ts`, etc.) mock the DB and never exercise the SQL.

A cheap static guard was added now (`scripts/dwca/build-queries.test.ts`) that greps
`build.ts` for bare PG-schema refs — catches THIS class with no DB. But it does not
catch data/column/wiring bugs (wrong column name, bad join, type mismatch) that only a
real query execution would.

## Solution (Phase 13 scope)

Turn the DB-gated `build.test.ts` into an actual pre-prod gate that runs in CI against a
**seeded local Postgres**, so build-time query bugs are caught before deploy:

- Seed a minimal fixture into `supabase/seed.sql` (or a CI-only seed): a handful of
  `maplify.sightings` (mix of trusted/untrusted, bracket-tagged + untagged comments) +
  `public.observations` rows with valid `collection_id`/`contributor_id`/`taxon_id` FKs,
  plus the `public.collections` / `public.organizations` they reference. Enough that
  `dwc.occurrences` is non-empty and `assertNonZeroRows` / the build's data assertions
  pass. (Today `seed.sql` only seeds `happywhale.species`.)
- Either lower `ROW_FLOOR` for the test run (env override — `guard.ts` already supports
  `ROW_FLOOR`) or seed >1000 rows so `guard.ts` G-02 passes locally.
- Wire `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` into a
  CI job (Supabase local stack via Docker, or a Postgres service container + `db reset`),
  so `build.test.ts` activates and `npm run build:dwca` runs against the seeded DB on
  every PR — making the DwC-A build a true gate, not a post-deploy discovery.
- Decide whether this is a CI matrix addition (Docker-in-CI cost) vs a lighter Postgres
  service container with the migrations applied.

Pairs naturally with Phase 13's "Verification & Looks-Done-But-Isn't" checklist + GBIF
re-validation. The static guard (already shipped) is the cheap floor; this is the real
integration gate.

## Notes

- Phase 12 itself is deployed + prod-verified (SC#1-6 + SRC-01 pass on the live 26-col
  views; the corrected-attribution archive published green via the re-run nightly).
- Local DB lacks prod data by design — see prod-only Maplify/observation data; this todo
  is specifically about adding a REPRESENTATIVE local fixture, not copying prod.
