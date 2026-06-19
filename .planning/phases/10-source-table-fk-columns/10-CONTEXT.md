# Phase 10: Source Table FK Columns - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Add the per-sighting provenance linkage columns — `provider_id`,
`collection_id`, `contributor_id`, `source_url` — to all four source tables
(`public.observations`, `maplify.sightings`, `inaturalist.observations`,
`happywhale.encounters`), index `collection_id` on the two **exported** tables
(`public.observations`, `maplify.sightings`), and populate `source_url` from the
existing per-table URL field. The columns must be **ready to receive Phase 11
backfill** — this phase wires the schema and the deterministic data, not the
comment-parsing resolver.

Requirements LINK-01, LINK-02, LINK-03 (`.planning/REQUIREMENTS.md`). The FK
targets (`public.providers`, `public.collections`, `public.contributors`) were
created in Phase 9.

**In scope:** the four new columns on each source table (with the per-table
nuances below), the `collection_id` index on the two exported tables, the
deterministic `source_url` and `provider_id` population that can be done now.

**Out of scope (Phase 11+):** the URL-pattern / bracket-tag / trailing-attribution
**resolver** and the `collection_id` + Maplify `source_url` backfill it drives;
editing the ingest upsert RPCs to wire `provider_id`/`collection_id`/`contributor_id`
on new rows; any NOT NULL constraint on `collection_id`; cross-provider contributor
unification; DwC view rebuild (Phase 12).

</domain>

<decisions>
## Implementation Decisions

These three columns behave **differently per table** by design — the phase is not
a uniform "add four identical nullable columns" change. The summary matrix is at
the end of this section.

### `provider_id` — deterministic, populated, NOT NULL
- **D-01:** `provider_id` is **constant per source table** (native→`Direct`,
  maplify→`Maplify`, inat→`iNaturalist`, happywhale→`HappyWhale`) — it never
  varies within a table. Phase 10 **fully resolves it now**, not in Phase 11.
- **D-02:** Add the column, then **backfill every row by slug-join** —
  `UPDATE <table> SET provider_id = p.id FROM public.providers p WHERE p.slug = '<table-provider-slug>'`.
  Resolve by **slug, never a hardcoded id** (honors Phase 9 D-05; provider ids are
  IDENTITY values assigned at seed time and must not be baked into source).
- **D-03:** After backfill, set the column **NOT NULL** and give it a
  **migration-resolved DEFAULT**: in the migration, look up the provider id by
  slug and emit `ALTER TABLE … ALTER COLUMN provider_id SET DEFAULT <resolved-id>`
  via dynamic SQL (e.g. `EXECUTE format('… SET DEFAULT %s', (SELECT id FROM public.providers WHERE slug=…))`).
  Net effect: structurally non-null, **new rows auto-get the right provider with
  no ingest-RPC edits**, and no magic integer literal appears in the migration source.
- **D-04 [rejected]:** A true Postgres `GENERATED ALWAYS AS (…) STORED` column was
  considered (mirrors the `source_url` approach) and **rejected for `provider_id`**:
  generation expressions cannot contain a subquery or reference another table, so
  it would require a hardcoded magic integer that breaks the FK if `public.providers`
  is ever re-seeded. D-02/D-03 capture the same "intrinsic, always-correct,
  no-per-row-maintenance" intent without that fragility.
- **D-05 [deviation from SC#1]:** This makes `provider_id` **NOT NULL**, stricter
  than ROADMAP SC#1's "all are nullable." Deliberate and justified — provider is
  fully known now. Flagged so `gsd-verifier` reads it as intentional. (Contrast
  with `collection_id`/`contributor_id`, which stay nullable because they are
  genuinely unknown until Phase 11.)

### `source_url` — generated where it mirrors a sibling, plain elsewhere
- **D-06:** **native + iNaturalist** get `source_url` as a **GENERATED column**:
  `source_url GENERATED ALWAYS AS (url) STORED` on `public.observations`,
  `… AS (uri) STORED` on `inaturalist.observations`. Rationale: source_url there is
  definitionally a copy of `url`/`uri`, so a generated column (a) satisfies SC#1/SC#3
  (the column exists and is populated from url/uri), (b) carries **zero redundancy /
  cannot drift / needs no backfill UPDATE**, and (c) **auto-populates new rows for
  free** — which is why no ingest-RPC edit is needed for source_url (see D-12).
  Trade-off accepted: Phase 11 can never UPDATE-override these two; that's correct —
  they are canonical by construction.
  - This is the agreed reconciliation of the earlier "reuse `url` as source_url"
    preference (avoid a maintained duplicate) **with** the locked success criteria
    (the column must exist). The column exists but is identical-by-definition to `url`.
- **D-07:** **Maplify + HappyWhale** get `source_url` as a **plain nullable text
  column** (they have no `url`/`uri` sibling to generate from).
- **D-08:** **Maplify `source_url` stays NULL this phase.** Maplify URLs are buried
  in `comments`; deriving them is the Phase 11 resolver's job.
- **D-09:** **HappyWhale `source_url` IS backfilled now** from a constructed
  encounter URL derived from `happywhale.encounters.id`
  (expected pattern `https://happywhale.com/encounter/{id}` — **planner MUST verify
  the exact URL pattern against a live HW encounter before writing the UPDATE**).
  User explicitly chose to populate HW now rather than defer. (HW is export-excluded
  per SRC-01, so this has no archive payoff, but gives complete internal provenance.)
  - **Planner option:** if the HW URL pattern is confirmed stable, expressing this
    as a `GENERATED ALWAYS AS ('https://happywhale.com/encounter/' || id) STORED`
    column (parallel to D-06) is a cleaner alternative to a plain column + UPDATE —
    it makes every HW row's source_url non-null by construction. Default to the
    plain-column + backfill the user chose unless the generated form is clearly
    safe; note the choice in the plan.

### `contributor_id` — nullable everywhere
- **D-10:** Add nullable `contributor_id INTEGER REFERENCES public.contributors(id)`
  to maplify / inat / happywhale (none have it today). Stays NULL until Phase 11 —
  contributor resolution is genuinely unknown now (and some Maplify rows never
  resolve; trailing-attribution lines yield collection/org, **never** contributor,
  per the locked roadmap decision).
- **D-11:** **native (`public.observations`) already has a NOT NULL
  `contributor_id`** (added by `20260204013006_sightings_uses_contributors.sql`).
  Per user choice, **relax it to nullable** (`ALTER COLUMN contributor_id DROP NOT
  NULL`) so the column is uniformly nullable across all four tables per SC#1. Note:
  native rows remain 100% populated; this only loosens the constraint, it does not
  null any data.

### `collection_id` — nullable + indexed on exported tables
- **D-12:** Add nullable `collection_id INTEGER REFERENCES public.collections(id)`
  to all four tables. Stays NULL until Phase 11. **No NOT NULL constraint** this
  phase (some Maplify rows permanently NULL — roadmap decision).
- **D-13:** Index `collection_id` on the two **exported** tables only
  (`public.observations`, `maplify.sightings`) per SC#2. **Claude's discretion
  (recommended): partial btree** `… (collection_id) WHERE collection_id IS NOT NULL`
  — most rows are NULL until/unless Phase 11 fills them, and the only consumer is
  the Phase 12 DwC join on non-null values, so a partial index is smaller and
  matches the access pattern. A plain btree is acceptable; either form is visible
  in `\d` / `pg_indexes` as SC#2 requires. Planner may choose.

### Ingest RPCs — not touched this phase
- **D-14:** **Do NOT edit the upsert RPC functions** this phase. Forward-population
  is covered without them: generated `source_url` (D-06) auto-fills native/inat new
  rows, and the `provider_id` DEFAULT (D-03) auto-fills new rows on all four tables.
  Wiring `collection_id`/`contributor_id` into ingest is Phase 11 resolver work.

### Per-table column matrix (end state of Phase 10)
| Table | provider_id | collection_id | contributor_id | source_url |
|---|---|---|---|---|
| `public.observations` (native) | NOT NULL, backfilled=Direct, default | nullable, **indexed** | relax existing → nullable | GENERATED AS (url) |
| `maplify.sightings` | NOT NULL, backfilled=Maplify, default | nullable, **indexed** | new, nullable, NULL | plain nullable, NULL |
| `inaturalist.observations` | NOT NULL, backfilled=iNaturalist, default | nullable | new, nullable, NULL | GENERATED AS (uri) |
| `happywhale.encounters` | NOT NULL, backfilled=HappyWhale, default | nullable | new, nullable, NULL | plain nullable, backfilled from id |

### Claude's Discretion
- `collection_id` index form (partial vs plain btree) — D-13, lean partial.
- HappyWhale `source_url` as plain-column-UPDATE vs generated column — D-09, pending
  URL-pattern verification.
- Exact migration structure (single migration vs split), assertion-snippet shape —
  follow the Phase 9 precedent (`supabase/snippets/09_*_assertions.sql` style,
  `supabase db reset` + psql checks, including `\d` column/index assertions and a
  "new Maplify insert with NULL collection_id succeeds" check per SC#4).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone model & requirements (authoritative)
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — provider/collection/organization/
  contributor terminology, prod row counts (§2), and the Maplify tag/attribution
  census (§3) that Phase 11 backfill consumes. Context for why `source_url`/
  `collection_id` resolution is deferred.
- `.planning/REQUIREMENTS.md` — locked LINK-01/02/03 (this phase) plus the
  RESOLVE-* family (Phase 11) that these columns feed.
- `.planning/ROADMAP.md` § "Phase 10: Source Table FK Columns" — goal + 4 success
  criteria. **Note the two intentional deviations recorded above:** SC#1 says all
  columns nullable, but `provider_id` is NOT NULL (D-05) by deliberate choice.

### Prior-phase context (FK targets this phase references)
- `.planning/phases/09-reference-table-foundation/09-CONTEXT.md` — D-05 (slug
  natural keys — the contract `provider_id` backfill joins on), D-04 (native
  reposts resolve to shared collections — informs Phase 11, not this phase).
- `supabase/migrations/20260619184037_reference_tables.sql` — Phase 9 output:
  `public.providers` (slugs), `public.collections`, `public.collection_kind`,
  `public.contributors.orcid`. The FK targets + the slug values to join on.

### Existing schema this phase alters
- `supabase/migrations/20250903172708_initial_schema.sql` — original
  `maplify.sightings` (has `comments`, `source`, `usernm`; no url/contributor_id),
  `inaturalist.observations` (`uri`), `happywhale.encounters` (no url),
  `public.sightings` (→ renamed `public.observations`; has `url`).
- `supabase/migrations/20260204013006_sightings_uses_contributors.sql` — added the
  **existing NOT NULL** `public.observations.contributor_id` that D-11 relaxes.
- `supabase/migrations/20250915171505_sighting_policies.sql` — `public.sightings`
  → `public.observations` rename + the native upsert RPC (do **not** edit — D-14).
- `supabase/migrations/20260617203900_dwc_schema.sql` — the `dwc` views (Phase 12
  rebuild target) that will JOIN these new FKs; establishes source-table names.
- `supabase/snippets/05_dwc_assertions.sql` — assertion-snippet precedent; mirror
  for a `09`/`10`-style success-criteria smoke test.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `public.providers` / `public.collections` / `public.contributors` — FK targets,
  all with UNIQUE slugs (providers/collections) to join on. Provider slugs are the
  contract for D-02's backfill.
- Phase 9 assertion-snippet pattern (`supabase db reset` + psql `\d`/`SET ROLE anon`
  checks) — reuse for SC#1–SC#4 verification.

### Established Patterns
- Migrations are timestamped plain SQL in `supabase/migrations/`. Generated columns
  already exist nowhere in this schema — D-06 introduces the first; verify local
  `supabase db reset` applies cleanly.
- Cross-schema FK precedent already exists (`maplify.sightings.taxon_id REFERENCES
  inaturalist.taxa(id)`), so FK columns from `maplify`/`inaturalist`/`happywhale`
  → `public.providers`/`public.collections`/`public.contributors` are consistent
  with the codebase (Option A, per roadmap).

### Integration Points
- These columns are read (not written) by the Phase 12 `dwc` view rebuild via JOINs
  on `provider_id`/`collection_id`/`contributor_id`.
- Phase 11's resolver UPDATEs `collection_id` (+ Maplify `source_url`, +
  `contributor_id`) on these columns. Generated `source_url` (native/inat) and
  NOT NULL `provider_id` are off-limits to that resolver by construction.

</code_context>

<specifics>
## Specific Ideas

- HappyWhale `source_url` expected pattern: `https://happywhale.com/encounter/{id}`
  — VERIFY against a live encounter before backfilling (D-09).
- `provider_id` DEFAULT must be emitted via migration-time dynamic SQL resolving the
  slug → id (D-03), never a literal in source.
- SC#4 verification: insert a synthetic Maplify row with NULL `collection_id` and
  confirm it succeeds (proves no NOT NULL constraint slipped in), then confirm
  existing row counts unchanged.

</specifics>

<deferred>
## Deferred Ideas

- **Maplify `source_url` derivation** (from `comments`) — Phase 11 resolver.
- **`collection_id` / `contributor_id` backfill** — Phase 11 (comment parsing,
  exact-match dictionary, trailing-attribution → collection/org).
- **Ingest-RPC wiring** of `collection_id`/`contributor_id` on new rows — Phase 11.
- **NOT NULL on `collection_id`** — deferred indefinitely (some Maplify rows stay
  NULL; constraint only if completeness is ever verified).
- **Cross-provider contributor unification** — out of milestone (Phase 9 deferred).

None of these are blockers for Phase 10.

</deferred>

---

*Phase: 10-source-table-fk-columns*
*Context gathered: 2026-06-19*
