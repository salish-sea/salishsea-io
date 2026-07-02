# 003 — DwC-A export: view-as-contract schema, hybrid TS+DuckDB build, nightly publication

**Status:** accepted · **Decided:** v1.2 Phases 5–8 (2026-06), gate added v1.3 Phase 14

## Decision

The DarwinCore export contract lives in a read-only `dwc` Postgres schema; a hybrid TypeScript + DuckDB pipeline builds the archive; a nightly GitHub Actions job publishes it to S3/CloudFront; a seeded-local-DB CI gate protects the build pre-merge.

## Rationale

- **View-as-contract (`dwc` schema), not app-code mapping:** auditable SQL; Postgres enforces column/type parity at `CREATE VIEW` time, so branch drift fails migrations loudly. `dwc.occurrences` is a bare `SELECT * UNION ALL` of exactly two branch views (this also enforces SRC-01 by construction — see [005](005-export-exclusion-src-01.md)).
- **Hybrid TS + DuckDB:** TS owns EML/`meta.xml`/zip (pure, fast unit tests); DuckDB owns CSV + GeoParquet COPYs (`ATTACH` Postgres; a `GEOMETRY`-typed column auto-emits GeoParquet 1.0.0 metadata). One ordered field list (`scripts/dwca/fields.ts`) drives both the descriptor and the projection, with a runtime alignment guard.
- **Checksum-LAST upload order** (parquet, zip, then their sha256s): clients can never fetch a checksum newer than its artifact.
- **Nightly GHA reuses the existing OIDC role and S3 bucket** — no new AWS infra.
- **Seeded local-DB CI gate (Supabase local stack, not bare Postgres):** the `dwc` view chain needs PostGIS/`pg_net`/`pg_cron`; unit tests and static guards cannot catch bare-schema-ref regressions because `build.ts` reads Postgres through DuckDB `ATTACH … AS pgdb`.
- **Row-count floor** (`guard.ts` ROW_FLOOR=1000) as the runtime guard against a silently emptied export.

## Rejected

- App-code field mapping over `public.occurrences` (unauditable, no parity enforcement); bare-Postgres CI (missing extensions); new AWS infra for hosting.
