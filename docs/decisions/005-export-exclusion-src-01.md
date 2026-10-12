# 005 — SRC-01: iNaturalist and HappyWhale are modeled but not exported

**Status:** accepted · **Decided:** v1.2 Phase 4–5; preserved by construction in v1.3

*Amended 2026-10-12 ([061](061-ingest-and-derivation-move-into-the-build.md)):* the rule is unchanged, but the union of two branches is now DuckDB SQL in the read-path build ([`derive/dwc.sql`](../../scripts/read-path/derive/dwc.sql)), not a Postgres view, and the row floor is checked by the build's archive task, not a nightly job ([003](003-dwc-export-pipeline.md), amended). Orcasound's bouts are also kept out of the archive for now, for a different reason ([013](013-orcasound-acoustic-occurrences.md), 2026-09-20).

## Decision

iNaturalist and HappyWhale records are ingested and modeled internally (UI credit, filtering, future-proofing) but **excluded from the DwC-A export**.

## Rationale

Both platforms self-publish to GBIF as canonical datasets. Re-exporting their records would create duplicates — GBIF dedup is imperfect (matches coords+date, not occurrenceID). Only native + Maplify records are exported.

## Enforcement

By construction, never by filter: `dwc.occurrences` is a UNION of exactly two branch views (native, Maplify). There is no WHERE clause to forget. The nightly job's row-count gate is the runtime guard.

## Consequences

- The planned inbound GBIF ingest (backlog) is the mirror image of this rule and must dedupe against provider + `source_url` to avoid re-importing our own contributed records.
