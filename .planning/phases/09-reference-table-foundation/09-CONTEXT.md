# Phase 9: Reference Table Foundation - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Create the provenance graph's reference tables — `providers`, `organizations`,
`collections` — plus a nullable `orcid` column on the existing
`public.contributors`; seed them with canonical data; and make them readable by
all consumers. This is the foundation every later v1.3 FK addition (Phase 10),
backfill (Phase 11), and DwC view rebuild (Phase 12) depends on.

Requirements PROV-01, ORG-01, COLL-01, CONTRIB-01, CONTRIB-02 are **locked** by
`.planning/REQUIREMENTS.md`. This discussion settled HOW to shape the tables and
seed — not what to build.

**In scope:** the three new reference tables, the `orcid` column, seed data
(providers + organizations + collections including stub rows for un-decoded
acronym channels), and read grants.

**Out of scope (later phases):** per-sighting FK columns (Phase 10), the
resolver + backfill (Phase 11), DwC view/export changes (Phase 12), any app UI,
and cross-provider contributor unification.

</domain>

<decisions>
## Implementation Decisions

### Schema placement
- **D-01:** All three reference tables (`providers`, `organizations`,
  `collections`) live in the **`public` schema**, alongside the existing
  `public.contributors`. Rationale: FKs from `public.observations` and the `dwc`
  views are same-schema; PostgREST auto-exposes them; simplest, and contributors
  (which CONTRIB-01/02 extend) is already there. A dedicated `provenance` schema
  was considered and rejected (cross-schema FKs from `public`/`maplify`/
  `inaturalist`/`happywhale` + extra USAGE/exposure config for no benefit this
  milestone).

### Collection granularity & the shared registry
- **D-02:** Collections are a **shared registry, not 1:1 with providers.** A
  collection (e.g. `Orca Network`) is reachable by *any* provider; only
  `provider_id` differs per record. This realizes the locked "provider ≠
  collection; collection is stable across providers" principle.
- **D-03:** Seed **one baseline collection per non-aggregator provider** —
  `iNaturalist`, `HappyWhale`, `SalishSea.io Direct` — for genuinely-origin
  records. Finer sub-collections (per iNat project, per HappyWhale org) are
  deferred: iNat + HappyWhale are not exported (SRC-01), so finer granularity
  adds seed/backfill work with zero archive payoff this milestone.
- **D-04 [informational]:** (Phase 10/11 forward-note — not a Phase 9 build item)
  **Native (`public.observations`) records are often reposts** of
  content also entered into Maplify/conserve.io — frequently tagged the same way
  and by the same person. Such a native repost resolves to the **same** shared
  collection (e.g. `Orca Network`), with `provider_id = Direct`. The
  `SalishSea.io Direct` collection is the fallback only for genuinely-original
  native submissions. (Native tags would live in `public.observations.body` —
  there is no Maplify-style `comments` column on native records. Parsing native
  `body` is a Phase 11 resolution concern; flagged here so Phase 10/11 expect it.)

### Natural keys & seed idempotency
- **D-05:** `providers` and `collections` (and `organizations`) carry a serial
  `id` PK **plus a UNIQUE human-readable `slug`/`code`** (e.g. `orca-network`,
  `cascadia`, `whale-alert-global`). Rationale: Phase 11's exact-match
  dictionary maps tag → slug, which is readable and reviewable in PRs; seed is
  idempotent via `ON CONFLICT (slug) DO …`. Serial-only IDs were rejected as
  opaque and hard to verify by eye.

### Acronym channel seeding (the COLL-01 "~15 collections")
- **D-06:** **Seed the un-decoded Maplify acronym tags as stub collection rows
  now** (`PSWS`, `MCW`, `CWW`, `WSSJI`, `HIWS`, `SBW`, `WA`, `SSCH`, `SA`,
  `PSWW`, plus one-offs like `Bremerton FB group`). Stub = `slug` from the
  lowercased acronym, `name` = the acronym, `organization_id` = NULL,
  `kind` = NULL. Phase 11 fills in name/org/kind once decoded. This means the
  collections seed is ~15 *named* + the acronym stubs (≈25 rows total).
- **D-07 [informational]:** (Phase 11 framing note — not a Phase 9 build item)
  Seeding stubs **does not conflict with RESOLVE-04's "no auto-create"
  rule.** That rule governs the *ongoing ingest resolver* (unmatched tags at
  ingest time → NULL, never auto-insert). Pre-seeding stubs from a
  human-reviewed census is a deliberate one-time act, the opposite of automated
  fuzzy creation. Capture this distinction explicitly so Phase 11 does not read
  it as a contradiction.
- **D-08 [informational]:** (provenance/sourcing note for the seed — the buildable seed action is covered by D-06) Phase 9 seeds the acronym/collection set **from the point-in-time
  census already documented in `v1.3-EXECUTIVE-SUMMARY.md §3`.** The
  authoritative `SELECT DISTINCT` re-census happens in Phase 11 (RESOLVE-03) and
  may surface a few additional tags; those resolve to NULL until a human adds
  them. Phase 9 is not blocked on the Phase 11 census.

### `collections.kind` enum nullability
- **D-09:** `collections.kind` must be **nullable.** The enum is locked to
  `facebook_group`, `research_dataset`, `acoustic_feed`, `detector`,
  `direct_app` (no `aggregator_ingest`). Un-decoded acronym stubs (D-06) have an
  unknown channel type, so they carry `NULL` kind until Phase 11 decodes them.
  Forcing a guessed kind would violate the exact-match/no-fudge principle.

### Access / security model
- **D-10:** Each reference table gets **`ENABLE ROW LEVEL SECURITY` + a
  permissive `USING (true)` SELECT policy** for `anon` and `authenticated`.
  Matches `public.contributors` and the existing public-table convention,
  satisfies Supabase's RLS linter (a `public` table without RLS is flagged), and
  keeps write access closed. Plain `GRANT SELECT` (the `dwc` style) was rejected
  because `dwc` is unexposed; these tables are PostgREST-exposed.

### Contributors extension (CONTRIB-01 / CONTRIB-02)
- **D-11:** Add a **nullable `orcid` column** to the existing
  `public.contributors` (do not create a new contributors table). Contributors
  stay **per-provider** — referenceable from every provider's records with no
  cross-provider merge this milestone (the `jmaughn` ≈ James Maughn unification
  is explicitly deferred). ORCID *values* are populated later; Phase 9 ships only
  the column. (`recordedByID` emission from ORCID is a Phase 12 export concern.)

### Claude's Discretion
- Exact column lists for `organizations` (name, url, rights-holder text per
  ORG-01) and `providers` beyond the slug/id/name shape.
- Whether seed data lives as idempotent `INSERT … ON CONFLICT` statements inside
  the migration (preferred for canonical production data — `supabase/seed.sql` is
  dev-fetch only) vs. another mechanism. Lean toward in-migration seed.
- Whether `providers` needs its own `kind`/type column or is just a fixed
  four-row enumeration with a slug.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone model & seed data (authoritative)
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — terminology (provider/collection/
  organization/contributor), prod counts, and the **census of Maplify bracket
  tags + trailing attributions** that the collections seed is drawn from (§3 is
  the seed source for D-06/D-08). Supersedes the Maplify-only framing in the
  notes file below.
- `.planning/REQUIREMENTS.md` — locked requirements PROV-01, ORG-01, COLL-01,
  CONTRIB-01, CONTRIB-02 (and the downstream LINK/RESOLVE/ATTR families for
  context on what these tables must support).
- `.planning/ROADMAP.md` § "Phase 9: Reference Table Foundation" — goal +
  5 success criteria (anon-role SELECT smoke tests, four providers, ~15
  collections, `orcid` column, per-provider contributor model intact).
- `.planning/notes/collections-and-contributors-model.md` — earlier model;
  **superseded** by the executive summary on the provider/collection
  distinction and trailing-attribution handling. Read for background only.

### Existing schema this phase builds on / aligns with
- `supabase/migrations/20260203234153_individuals.sql` — defines
  `public.contributors` (the table CONTRIB-01/02 extend) and the RLS +
  trigger conventions to mirror.
- `supabase/migrations/20260617203900_dwc_schema.sql` — the read-only `dwc`
  projection (its `_native_occurrences` / `_maplify_occurrences` branch views
  and `datasets` view) that Phase 12 will rebuild to consume these reference
  tables. Establishes the grant/exposure conventions and the
  `public.observations` / `maplify.sightings` source-table names.
- `supabase/seed.sql` — current dev-fetch seed (NOT where canonical reference
  data should go; informs D-12 discretion note).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public.contributors` (id serial PK, entity_id uuid, name, picture; RLS
  enabled) — extend in place with nullable `orcid`; do not recreate.
- Existing enum convention: `CREATE TYPE <schema>.<name> AS ENUM (...)` (see
  `public.sex`, `happywhale.accuracy`, `inaturalist.license`). Use for the
  locked `collections.kind` enum.

### Established Patterns
- Migrations are plain SQL in `supabase/migrations/` (timestamped). Local
  verification via `supabase db reset` + a psql assertions snippet (see
  `supabase/snippets/05_dwc_assertions.sql` for the Phase 5 precedent — a
  parallel `09_*_assertions.sql` is a natural fit for the success-criteria smoke
  tests, including the `SET ROLE anon; SELECT COUNT(*)` checks).
- `public` tables enable RLS + add policies (D-10 follows this). The `dwc`
  schema uses plain GRANTs but is intentionally unexposed — not the model here.
- Reference/source tables: `public.observations` (native, has `body` + `url`),
  `maplify.sightings` (has `comments` with bracket tags + `source` code),
  `inaturalist.observations` (has `uri`), `happywhale.encounters`.

### Integration Points
- These tables become FK targets in Phase 10 (columns on all four source
  tables) and JOIN sources in Phase 12 (`dwc.occurrences` attribution). The
  slug natural keys (D-05) are the contract the Phase 11 resolver dictionary
  references.

</code_context>

<specifics>
## Specific Ideas

- The four Orca Network misspellings (`Orca Network`, ` Orca Network`,
  `Orca Networ`, `Orca Networks`, `Orca Neteork`) are the canonical example of
  why resolution is a human-eyeballed exact-match dictionary — they all map to
  the single `orca-network` collection slug in Phase 11, but Phase 9 only needs
  to seed the one canonical `orca-network` row.
- Known named collections to seed (from exec summary §3): Orca Network,
  Cascadia Research Collective, Whale Alert (Global), Whale Alert (Alaska), The
  Marine Mammal Center (TMMC), Orcasound, MBARI, plus the three per-provider
  baselines (iNaturalist, HappyWhale, SalishSea.io Direct).
- Known parent organizations to seed (ORG-01, non-null url): Orca Network,
  Cascadia Research Collective, The Marine Mammal Center, Monterey Bay Aquarium
  Research Institute, Orcasound.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-provider contributor unification** (`jmaughn` ≈ James Maughn) — a
  `contributor_links` table; explicitly out of scope this milestone
  (per-provider model only).
- **Finer collection granularity** for iNaturalist (per project) and HappyWhale
  (per org) — deferred; not exported (SRC-01), no payoff now.
- **Decoding the acronym stubs** (org + name + kind for PSWS/MCW/CWW/…) — Phase
  11 backfill work; Phase 9 only seeds the stub rows.
- **Populating ORCID values** for native contributors — column ships in Phase 9;
  data entry is later.
- **Finer-grained `source_url` → whole-occurrence import (Layer 2)** — seeded at
  `.planning/seeds/url-to-occurrence-importer.md`; out of milestone.

</deferred>

---

*Phase: 9-reference-table-foundation*
*Context gathered: 2026-06-19*
