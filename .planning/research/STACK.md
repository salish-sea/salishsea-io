# Stack Research — v1.3 Providers, Collections & Contributors

**Project:** SalishSea.io v1.3
**Researched:** 2026-06-19
**Confidence:** HIGH (all claims grounded in existing codebase; no external verification required for the primary verdict)

---

## Verdict: No new stack

v1.3 is a data-modeling and backfill milestone. Every capability it requires is
already present. Do not add any library.

The three specific capability questions asked — URL-pattern resolution, DwC/EML
encoding, and Postgres migration patterns — are all satisfied by existing tools.
What follows is the justification for each, then the explicit "do not add" list.

---

## (a) URL-Pattern Matching: No New Library

**Verdict: use the built-in `URL` constructor + plain string comparison.**

The URL-pattern resolver maps `source_url` → `(provider, collection)`. From the
executive summary, the production pattern set at v1.3 scope is:

| URL pattern | Signal strength |
|-------------|----------------|
| `inaturalist.org/observations/*` | matches `inaturalist.observations.uri` — already fully structured |
| `happywhale.com/*` | derivable from encounter id |
| SalishSea.io permalink | matches `public.observations.url` |
| `facebook.com/groups/{slug}/*` | future FB ingests — out of scope today |

This is a tiny, static, fully-enumerated lookup table — approximately four
entries at v1.3 ship. The resolution logic is:

1. Parse the URL with `new URL(source_url)`.
2. Switch on `hostname` + an optional prefix check of `pathname`.
3. Return a `(providerId, collectionId)` pair from a hardcoded lookup object, or
   `null` for no match.

That is ~20 lines of TypeScript with zero library surface. There is nothing
to install.

**Why not a URL-pattern library (e.g. `path-to-regexp`, `URLPattern`):**

- `path-to-regexp` is a route-matching library for parameterized URL templates.
  It is warranted when you have many routes with named parameters and need to
  extract them at runtime (i.e., an HTTP router). Four static hostname/prefix
  comparisons do not qualify.
- The Web Platform `URLPattern` API exists (available in Node 22+ and Chrome
  95+) but adds no value over a switch statement for four patterns. It would be
  appropriate if the pattern set were dynamic (loaded from the DB at runtime) or
  if caller sites needed typed parameter extraction. Neither is true here.
- The resolution order (source_url → bracket tag → trailing attribution → source
  code → NULL) already has the resolver as layer 1; it runs against a handful of
  fully-qualified URLs from three known providers. Premature complexity.

**Implementation note:** The resolver should be a pure function in a module
(e.g. `scripts/ingest/resolve-provider.ts`) — it will be called both from the
backfill migration script and from future ingest paths. Keep it independent of
any specific provider schema.

---

## (b) DwC/EML Encoding: No New Library

**Verdict: extend the existing `scripts/dwca/` pipeline in place.**

The existing pipeline (`eml.ts`, `meta-xml.ts`, `fields.ts`, `build.ts`) already
handles all DwC-A encoding. It is:

- Pure TypeScript with a hand-written `xmlEsc` helper for XML escaping.
- Driven by `OCCURRENCE_FIELDS` and `MULTIMEDIA_FIELDS` constant arrays in
  `fields.ts` — the source of truth for column order and DwC term URIs.
- Backed by `dwc.occurrences` and `dwc.datasets` Postgres views that encode
  the DwC projection in SQL (auditable, view-as-contract discipline).

v1.3 DwC changes are:

| Change | Where it lives |
|--------|---------------|
| `datasetName` → per-collection value (`"SalishSea.io — {collection}"`) | `dwc._maplify_occurrences` view — replace the `dn.display_name` CASE with a JOIN to the new `collections` table |
| `recordedBy` → contributor name where known (native already has it; Maplify gains it) | `dwc._native_occurrences` already correct; `dwc._maplify_occurrences` gains contributor FK lookup |
| `rightsHolder` → `"SalishSea.io"` (fixed aggregator value) for all rows | Both branch views updated |
| `institutionCode` → `"SalishSea"` (new column) | Add to both branch views + `OCCURRENCE_FIELDS` |
| EML contact enrichment (GBIF validator flag) | `eml.ts` template string update + `dwc.datasets` migration |

All of this is SQL view edits + column additions to the existing `fields.ts`
array. The `buildEml` template string function gains at most a contact block
update. No new encoding library is warranted.

**Why not a DwC-specific library:**

No mature, well-maintained TypeScript DwC-A builder library exists that would
add value over the current approach. The GBIF IPT is Java. `dwca-reader` (Node)
is a reader, not a writer. The hand-built pipeline already passes the GBIF
validator (DWCA-05, 2026-06-19).

**Why not a general XML library (e.g. `xmlbuilder2`, `fast-xml-parser` builder):**

`fast-xml-parser` is already a project dependency (v5.8.0, in `dependencies`)
and its builder could be used if the EML or meta.xml templates ever become
unwieldy. At v1.3 scope the template is a ~200-line string with `xmlEsc` calls
that tests already cover. Introducing a builder would add AST overhead for no
DX gain. If a future milestone adds per-constituent EML rows (multi-dataset
EML), revisit.

---

## (c) Postgres Migration Patterns: No New Library

**Verdict: plain SQL migrations via the existing `supabase migrations` workflow.**

The new schema objects are:

```
providers    (id, name, slug, source_schema)
organizations (id, name, url)
collections  (id, name, slug, kind, organization_id FK → organizations)
```

Plus FK columns (`provider_id`, `collection_id`, `contributor_id`, `source_url`)
on the four per-schema source tables (`maplify.sightings`, `inaturalist.observations`,
`happywhale.encounters`, `public.observations`).

The `collections.kind` enum (`facebook_group`, `research_dataset`, `acoustic_feed`,
`detector`, `direct_app`) is a standard Postgres `CREATE TYPE … AS ENUM`. The
project already uses enums (e.g. `public.travel_direction`, `public.sex`,
`happywhale.accuracy`, `inaturalist.rank`) in exactly this style — no migration
library is needed.

Backfill is a one-time DML pass in a migration file:

```sql
-- Example structure (not final)
UPDATE maplify.sightings s
SET collection_id = c.id
FROM collections c
WHERE ... -- exact-match on bracket tag or trailing attribution
```

The human-eyeballed exact-match dictionary (see §3 of the executive summary)
lives as a `VALUES` list inside the migration, not in application code. This is
the same pattern used for `dwc.datasets` (VALUES list in a view inside a
migration).

**Why not an ORM or migration library (e.g. Drizzle, Prisma, Knex):**

The project has no ORM. All schema management is `supabase migrations` (raw
SQL). Introducing a migration library for a self-contained one-time backfill
would add a foreign dependency with no ongoing benefit and would deviate from
the established pattern.

**Why not `pg_trgm` or fuzzy-matching extensions for backfill:**

Explicitly ruled out by the design: "exact-match only; no alias table; no
`pg_trgm` runtime fuzzy matching." The ~4 Orca Network misspellings are handled
via explicit entries in the VALUES dictionary, not by fuzzy code.

---

## What NOT to Add

| Do not add | Reason |
|------------|--------|
| `path-to-regexp` or any URL-pattern matching library | Four static patterns; 20 lines of TS with `new URL()` is sufficient |
| `URLPattern` (Web API) | Available natively if needed, but a switch statement is more readable for a static registry |
| `xmlbuilder2`, `@xmldom/xmldom`, or any XML builder | `fast-xml-parser` is already present; EML template is small and tested |
| Drizzle, Prisma, Knex, or any ORM/migration tool | Project uses raw SQL migrations; no ORM precedent; adding one for a 3-table addition is disproportionate |
| `pg_trgm` extension | Fuzzy matching explicitly ruled out by design decision; typo variants go in the exact-match VALUES dictionary |
| A contributor identity-resolution library | Cross-provider identity unification (`jmaughn` = James Maughn) is explicitly deferred to a future milestone; v1.3 models contributors per-provider only |
| Any new `dependencies` entry in `package.json` | All v1.3 work is Postgres migrations + TypeScript that exercises existing tools |

---

## Integration Notes for the Roadmap

- **`dwc.occurrences` view update:** adding `institutionCode` as a new 26th
  column requires a coordinated update to `OCCURRENCE_FIELDS` in `fields.ts`
  and to the `assertFieldAlignment` guard in `assertions.ts`. The field list is
  the source of truth; the migration and the TS array must stay in sync. This is
  not a stack change but a load-bearing integration point the planner should
  call out explicitly.

- **Backfill migration ordering:** the VALUES dictionary migration (exact-match
  bracket-tag/trailing-attribution → collection_id) must run _after_ the
  `collections` seed migration. Migration filenames (timestamp-prefixed) enforce
  this automatically in Supabase.

- **`source_url` as first-class column:** the resolver runs at ingest time
  (going forward) and also as part of the backfill for `inaturalist.observations`
  and `public.observations` (which already carry URIs). Maplify records with no
  URL fall through to the bracket-tag/attribution resolver. No library needed
  for either path.

- **EML contact enrichment:** the GBIF validator flagged
  `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`. The fix is a template string
  update to `eml.ts` and possibly a new column in `dwc.datasets`. Confirmed
  doable in-place with the existing pipeline.

---

## Sources

All findings are grounded in the existing codebase (HIGH confidence — no external
lookup required for the verdict):

- `scripts/dwca/eml.ts` — existing EML template + `xmlEsc` helper
- `scripts/dwca/fields.ts` — `OCCURRENCE_FIELDS` / `MULTIMEDIA_FIELDS` arrays
- `scripts/dwca/build.ts` — full pipeline; `assertFieldAlignment` guard
- `supabase/migrations/20260617203900_dwc_schema.sql` — existing `dwc` schema,
  both branch views, `dwc.datasets`, `dwc.multimedia`
- `supabase/migrations/20260203234153_individuals.sql` — existing enum pattern
  (`public.sex`), existing `public.contributors` table shape
- `supabase/migrations/20250903172708_initial_schema.sql` — `happywhale.accuracy`
  enum, `public.travel_direction` enum — confirming established pattern
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — URL-pattern registry (§3), resolution
  order, Maplify backfill strategy, DwC export changes (§5)
- `package.json` — confirms `fast-xml-parser@5.8.0` already present; confirms
  no ORM/migration-library precedent

---
*Stack research for: v1.3 Providers, Collections & Contributors on SalishSea.io*
*Researched: 2026-06-19*
