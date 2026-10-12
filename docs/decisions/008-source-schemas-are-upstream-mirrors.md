# 008 — Source schemas are verbatim upstream mirrors (anti-corruption layer)

**Status:** accepted · **Decided:** 2026-07-02 · **Amended by:** [061](061-ingest-and-derivation-move-into-the-build.md) (the mirrors leave Postgres for SQLite files on the build machine, and lose their two resolved columns)

*Amended 2026-10-12 ([061](061-ingest-and-derivation-move-into-the-build.md), [064](064-what-users-do-not-write-leaves-postgres-first.md), [065](065-the-store-and-write-api.md)):* the principle stands, applied more strictly. The Maplify and iNaturalist mirrors are SQLite files the read-path build writes on the Fly machine, not Postgres schemas, and Maplify's no longer stores the register entity or collection a sighting was matched to: the build works both out when it derives the occurrences. Happywhale's frozen rows are a DuckDB file beside the mirrors. Our own domain, which this record places in `public.*` and the `dwc` schema, now lives in the write API's SQLite store (what users write), in checked-in files under `data/` (the catalogue and reference data), and in the build's DuckDB tables (the Darwin Core contract). This record does not govern Orcasound ([013](013-orcasound-acoustic-occurrences.md), 2026-09-20).

## Decision

The per-source schemas — `maplify`, `inaturalist`, `happywhale` — are **verbatim mirrors of external APIs**, holding upstream data more-or-less as received. They are the ingest pipeline's landing zone and an **anti-corruption layer**, *not* authoritative domain. Their columns carry **upstream** semantics, which must **not** leak into our own domain vocabulary, downstream interfaces, or public docs.

Our authoritative domain lives in `public.*` (e.g. `public.observations`, the provenance reference tables) and in the export contract (the `dwc` schema). Where we need a concept that an upstream source also happens to have, we define **our own** term with its own semantics, and translate at the boundary — we do not adopt the upstream field as-is.

## Key sub-decisions and rationale

- **Verbatim, not curated.** Mirror tables reflect marginally-documented external APIs. Treating their fields as authoritative would couple our domain to vocabulary we don't control and can't stabilize.
- **No downstream leakage.** A mirror field must not surface in UI, public docs, or the glossary as if it were our concept. Concretely: `maplify.sightings.trusted` is a Maplify-API artifact — building a "trusted" UI or export rule directly on it would enshrine upstream semantics we don't own.
- **Coin our own concepts at the boundary.** When we want a notion like "trusted", we define a **native** concept (with some, possibly loose, relationship to the upstream one) rather than re-exporting the upstream flag. Reserve the name; translate explicitly.
- **Upstream signals may be *parsed*, not *adopted*.** We already do this for attribution: the Maplify "… Submitted by a … Trusted Observer" line is parsed for collection/organization at view-read time. Parsing an upstream signal into our vocabulary is fine; treating the upstream field as our vocabulary is not.
- **Consistency with existing model.** The provenance graph ([006](006-provenance-graph.md)) already resolves upstream signals into our own `public` reference tables via ingest-time translation. This ADR names the general principle those choices were already following.

## Consequences

- The glossary ([CONTEXT.md](../../CONTEXT.md)) marks source schemas as **upstream mirrors** and does not promote their fields to domain terms.
- Reviewers should reject downstream code or docs that depend on mirror-table semantics without an explicit translation into a `public`/`dwc` concept.

## Reference

Provenance model: [006](006-provenance-graph.md), [docs/data-provenance.md](../data-provenance.md). Domain vocabulary: [CONTEXT.md](../../CONTEXT.md).
