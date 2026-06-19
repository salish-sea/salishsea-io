# Phase 11: Resolution & Backfill - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Populate the provenance FKs (`collection_id`, `contributor_id`) on **existing
rows** across the four source tables, and wire **ongoing ingest** so newly-fetched
rows resolve the same way — without ever mutating `maplify.sightings.comments`.
`provider_id` and `source_url` were already resolved in Phase 10 (provider per-table
with a DEFAULT; native/iNat `source_url` GENERATED, HW backfilled, Maplify NULL).

**In scope:**
- Maplify `collection_id` resolution (bracket tag → trailing attribution →
  structured `source` code → NULL) via a DB-side dictionary, applied at ingest.
- `collection_id` for iNat / native / HappyWhale = a single constant per table
  (DEFAULT for ongoing + one-time UPDATE for existing rows).
- The TS URL-pattern resolver `scripts/ingest/resolve-provider.ts` (RESOLVE-01 /
  SC#4) — built for the one-time iNat/native URL backfill and as the future-FB /
  mixed-source extension point.
- iNat `contributor_id`: mint `public.contributors` from iNat `username`, link
  existing rows, wire ongoing ingest.
- A full prod `SELECT DISTINCT` census (committed artifact) + a diff-gate assertion.

**Out of scope (deferred — see `<deferred>`):**
- HappyWhale `contributor_id` population (deferred this phase).
- Cross-provider contributor unification (jmaughn ↔ James Maughn); `contributor_links`.
- Maplify `contributor_id` (stays NULL by locked design — SC#3).
- DwC view rebuild (Phase 12); GBIF re-validation (Phase 13).

</domain>

<decisions>
## Implementation Decisions

### Maplify collection resolution (the keystone — RESOLVE-02/03/04)
- **D-01 [LANDMINE]:** `maplify.update_sightings` runs every 5 min via
  `cron.schedule(..., '*/5 * * * *', ...)` and does
  `DELETE FROM maplify.sightings WHERE created_at BETWEEN current_date-10 AND current_date; INSERT ...`
  (`20250914232212_cron.sql:159`, `20250904165159_fetch_data.sql:~189-198`). Any
  `collection_id` backfilled onto the **last 10 days** of Maplify rows is wiped and
  re-inserted as NULL every 5 minutes. `provider_id` survives (Phase 10 DEFAULT);
  `collection_id` — this phase's main deliverable — does not. Therefore ongoing
  ingest-time resolution is **mandatory for correctness**, not optional.
- **D-02:** Resolve `collection_id` **inside the `maplify.update_sightings`
  INSERT** (`INSERT ... SELECT ..., maplify.resolve_collection(comments, source)`).
  One code path serves both the one-time backfill (UPDATE) and ongoing ingest
  (INSERT). This **edits a working ingest function** — a deliberate departure from
  Phase 10's D-14 ("don't touch ingest RPCs").
- **D-03:** The dictionary is a **DB-side lookup table** (not inline VALUES, not a
  TS file): `maplify.collection_rule (match_kind text /* 'bracket'|'attribution'|'source' */, match_value text, collection_id int REFERENCES public.collections)`,
  seeded by migration. A thin `maplify.resolve_collection(comments, source)` SQL
  function applies the **locked precedence**: leading bracket tag → trailing
  attribution → structured `source` code → NULL. Data-driven, FK-checked, reviewable
  as rows; adding a tag is one INSERT.
- **D-04:** Precedence order is **locked** (unchanged from roadmap):
  `source_url` → bracket tag → trailing attribution → `source` code → NULL. Maplify
  has no `source_url` today, so its resolver starts at the bracket tag.

### Collection for the other three tables (single constant each)
- **D-05:** iNat / native / HappyWhale each map to exactly **one** collection
  (locked: one collection per platform). Set `collection_id` ongoing via a
  **migration-resolved column DEFAULT** (look up the collection id by slug at
  migration time and emit `ALTER COLUMN collection_id SET DEFAULT <resolved-id>` —
  mirror Phase 10's `provider_id` DEFAULT pattern, no magic integer in source) plus
  a **one-time UPDATE** for existing rows.
  - **Planner note:** confirm the native upsert RPC and the iNat MERGE do **not**
    explicitly name `collection_id` in their INSERT column lists (else the DEFAULT is
    overridden). For iNat, existing rows survive the MERGE so only the one-time UPDATE
    + DEFAULT-for-new is needed.

### TS URL-pattern resolver (RESOLVE-01 / SC#4)
- **D-06:** Build `scripts/ingest/resolve-provider.ts` as a **pure function**
  (urlPattern → {provider, collection}) with tests, per SC#4. Its real roles:
  (a) the one-time iNat/native URL backfill, and (b) the **future-FB / mixed-source
  extension point**. It is **NOT** on the Maplify path (Maplify resolution is
  DB-side, D-02/D-03) and **NOT** the ongoing mechanism for the single-collection
  tables (that's the DEFAULT, D-05). Reconciles the locked "TS pure function"
  decision with the discovery that ingest is DB-side pg_cron SQL.

### Backfill delivery & census (RESOLVE-03)
- **D-07:** The one-time backfill is an **idempotent SQL migration** guarded by
  `WHERE collection_id IS NULL`, applied to prod by the standard deploy flow. It is a
  **no-op on local `supabase db reset`** (prod's ~6,827 Maplify rows aren't local) —
  acceptable for a data migration. `collection_rule` seed + `resolve_collection` ship
  in the same (or a prior) migration.
- **D-08:** Run the full prod `SELECT DISTINCT` bracket-tag / attribution / source
  census **read-only first** (STATE.md: "do not skip"), **commit the raw output as an
  artifact** (e.g. `supabase/snippets/11_maplify_census.*` or under `.planning/`),
  hand-curate the rule rows from it, and add a **diff-gate assertion** that FAILS if
  any prod bracket tag / attribution / source code is **not covered** by
  `collection_rule`. New upstream tags surface loudly instead of silently → NULL.
  (Assertion-snippet precedent: `supabase/snippets/09_*`, `10_*`, `05_*`.)

### Dictionary content (RESOLVE-02 / RESOLVE-04)
- **D-09 [SC#1 deviation]:** Hand-seed collections for **every bracket tag that
  names a real channel** (including one-offs like `Bremerton FB group`) so they
  resolve. Treat **empty / `[NULL]` brackets as untagged**: tighten SC#1's regex to
  `^\[[^\]]+\]` (non-empty tag) and allow those rows to stay NULL. This is a
  documented relaxation of SC#1's literal `^\[` — flag for `gsd-verifier` as
  intentional. (Manual seeding ≠ the forbidden "auto-create".)
- **D-10:** Map the **11 Phase-9 acronym stubs** (PSWS, MCW, CWW, WSSJI, HIWS, SBW,
  WA, SSCH, SA, PSWW, …) to their collections via `collection_rule (match_kind='bracket')`.
  **Researcher must expand each acronym** and confirm the Phase-9 stub slugs before
  the planner writes rules.
- **D-11:** Use the structured `maplify.sightings.source` code as a **curated
  final fallback** — add `match_kind='source'` rules for opaque codes
  (`whalealertoa`, `cascadiaWebMap`, `farallon`, …) mapped to collections by human
  curation during census; diff-gate covers them too. (Maximize resolution; codes are
  machine-assigned so often cleaner than comment parsing.)
- **D-12 [carry/locked]:** `comments` is **immutable** — no UPDATE on
  `maplify.sightings.comments` in any migration or script (SC#2). Tags/attributions
  are the audit trail; stripped at view/read time only (Phase 12).
- **D-13 [carry/locked]:** Trailing "Submitted by … Trusted Observer" lines yield a
  **collection/org only, never a `contributor_id`** (SC#3). Maplify `contributor_id`
  stays NULL this phase.

### Contributors
- **D-14:** **native** `contributor_id` — unchanged, already 100% populated (Phase 10
  relaxed it to nullable but nulled no data). **Maplify** — NULL (D-13).
  **HappyWhale** — **deferred** (its 515 users; no DwC-A payoff, export-excluded).
- **D-15:** **iNat `contributor_id` IS populated this phase.** Mint
  `public.contributors` from `inaturalist.observations.username`. Add a nullable
  **`inat_login text UNIQUE`** column to `public.contributors` as the idempotent dedup
  key (`INSERT ... ON CONFLICT (inat_login) DO NOTHING`). jmaughn (iNat) ↔ James
  Maughn (native) **stays unlinked** — cross-provider unification remains deferred;
  these are distinct contributor rows until a future `contributor_links` table joins
  them. Native rows leave `inat_login` NULL.
- **D-16:** **Ongoing iNat contributor resolution is wired into the
  `upsert_observation_page` MERGE** — mint + resolve `contributor_id` inline at ingest
  (`ON CONFLICT (inat_login) DO NOTHING` then link). This edits the schema's most
  complex ingest function — a second deliberate departure from Phase 10's D-14.
  - **Planner note:** the contributor-mint INSERT runs inside a `SECURITY`-sensitive
    cron context — verify RLS / function ownership lets it INSERT into
    `public.contributors` (the existing `create_contributor_on_sign_in` trigger in
    `20260203234153_individuals.sql` is the precedent for programmatic inserts).

### Claude's Discretion
- Exact migration split (one migration vs several: census-assertion / rules+resolver
  / backfill / ingest-wiring) — follow Phase 9/10 precedent.
- Whether the diff-gate lives as a `supabase/snippets/11_*` assertion run in CI/locally
  vs an in-migration `DO $$ ... RAISE EXCEPTION ... $$` check — planner's call.
- Census artifact location (`supabase/snippets/` vs `.planning/`) and exact regex for
  extracting bracket tags / attribution lines.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone model & requirements (authoritative)
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — §2 prod provider counts; **§3 the Maplify
  bracket-tag + trailing-attribution census** (the dictionary's starting point) and
  the resolution-order + `source_url`-as-Layer-1 framing; §4 contributor instances
  (the jmaughn unification case).
- `.planning/REQUIREMENTS.md` — locked **RESOLVE-01/02/03/04** (this phase).
- `.planning/ROADMAP.md` § "Phase 11: Resolution & Backfill" — goal + 5 success
  criteria. **Note the SC#1 regex deviation recorded in D-09.**

### Prior-phase context this phase builds on
- `.planning/phases/10-source-table-fk-columns/10-CONTEXT.md` — what Phase 10
  already resolved: `provider_id` (NOT NULL + DEFAULT, slug-resolved), `source_url`
  (GENERATED native/iNat, backfilled HW, NULL Maplify), `collection_id`/`contributor_id`
  added nullable. **D-14 there (don't touch ingest RPCs) is overridden here** (D-02, D-16).
- `.planning/phases/09-reference-table-foundation/09-CONTEXT.md` — slug natural keys
  (the join contract); the 21 seeded collections (10 named + **11 acronym stubs** D-10
  must map); `contributors.orcid` column.

### Schema this phase reads/alters (verify before writing SQL)
- `supabase/migrations/20250914232212_cron.sql` — **the landmine**: the `*/5`
  `load-recent-maplify-sightings` + `load-recent-inaturalist-observations` schedules
  (lines ~159-161). Also contains `inaturalist.upsert_observation_page` (the iNat
  **MERGE** edited in D-16).
- `supabase/migrations/20250904165159_fetch_data.sql` — `maplify.update_sightings`
  (the **DELETE+INSERT** edited in D-02, ~line 189-198); `maplify.fetch_date_range`;
  HappyWhale fetch/upsert functions.
- `supabase/migrations/20260619184037_reference_tables.sql` — Phase 9 output:
  `public.providers` / `public.collections` (slugs to join on, acronym stubs),
  `public.contributors.orcid`.
- `supabase/migrations/20260203234153_individuals.sql` — `public.contributors`
  schema (`id, entity_id, name, picture` + orcid); `create_contributor_on_sign_in`
  trigger (precedent for D-16's programmatic contributor insert).
- `supabase/migrations/20260204013006_sightings_uses_contributors.sql` — native
  `contributor_id` history.
- `supabase/snippets/09_reference_assertions.sql`, `10_fk_columns_assertions.sql`,
  `05_dwc_assertions.sql` — assertion-snippet precedent for the D-08 diff-gate.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 10 `provider_id` DEFAULT pattern** — migration-time dynamic SQL resolving
  slug → id, then `ALTER COLUMN ... SET DEFAULT`. Direct template for the
  `collection_id` DEFAULT on iNat/native/HW (D-05).
- **`public.collections` / `public.contributors`** with UNIQUE slugs — FK targets;
  the resolver/rules join on slugs, never hardcoded ids.
- **Assertion-snippet pattern** (`supabase/snippets/09_*`, `10_*`) — reuse for the
  D-08 diff-gate and SC#1–SC#5 smoke tests.
- **`create_contributor_on_sign_in`** — precedent for inserting into
  `public.contributors` from a function (informs D-16 RLS/ownership).

### Established Patterns
- Ingest is **entirely DB-side**: pg_cron + `http.http_get` + SQL upsert functions.
  There is **no TypeScript ingest path** today — this reframes RESOLVE-01/04 (D-06).
- Maplify ingest = **rolling DELETE+INSERT** (last 10 days, `*/5`); iNat ingest =
  **MERGE** (existing rows preserved); HappyWhale = **no cron** (ad-hoc, stable).
  These three shapes drive the three different ongoing-resolution choices
  (D-02 inline-INSERT / D-16 inline-MERGE / D-05 DEFAULT).
- Cross-schema FK precedent already exists (`maplify.sightings.taxon_id REFERENCES
  inaturalist.taxa(id)`).

### Integration Points
- These FKs are **read by the Phase 12 `dwc` view rebuild** (JOINs on
  `collection_id`/`contributor_id` → `datasetName`/`recordedBy`). Generated
  `source_url` (native/iNat) and NOT NULL `provider_id` are off-limits to this phase.

</code_context>

<specifics>
## Specific Ideas

- `maplify.collection_rule (match_kind, match_value, collection_id)` + thin
  `maplify.resolve_collection(comments, source)` returning the first match by
  precedence; called inside `maplify.update_sightings` INSERT and the one-time UPDATE.
- SC#1 regex tightened to `^\[[^\]]+\]` so empty/`[NULL]` brackets are excluded
  (D-09).
- `public.contributors.inat_login text UNIQUE`; iNat mint via `ON CONFLICT
  (inat_login) DO NOTHING` (D-15).
- Researcher must: (1) expand the 11 acronym stubs to collections and confirm Phase-9
  slugs (D-10); (2) confirm native RPC / iNat MERGE don't override the `collection_id`
  DEFAULT (D-05); (3) confirm RLS lets the iNat contributor mint INSERT (D-16).

</specifics>

<deferred>
## Deferred Ideas

- **HappyWhale `contributor_id` population** — its 515 users; export-excluded, no
  DwC-A payoff. Later phase.
- **Cross-provider contributor unification** (jmaughn ↔ James Maughn) — the
  `contributor_links` table is the extension point; no shared FK this milestone.
- **Generalized external-identity columns** on `public.contributors` (provider_id +
  external_key) — chose the minimal `inat_login` instead; generalize when HW/others
  are added.
- **ORCID population** for native contributors — column exists (Phase 9), data entry
  later (CONTRIB-02).
- **Layer 2: URL → whole-occurrence importer** — seeded at
  `seeds/url-to-occurrence-importer.md`; out of milestone.

</deferred>

---

*Phase: 11-resolution-backfill*
*Context gathered: 2026-06-19*
