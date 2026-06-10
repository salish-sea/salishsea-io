# Architecture Research

**Domain:** DarwinCore Archive (DwC-A) export integrated into an existing static-SPA + Supabase system
**Researched:** 2026-06-09
**Confidence:** HIGH (existing architecture read directly from migrations/workflows; DwC-A structure verified against GBIF/OBIS docs)

## Scope of This Research

This is a **subsequent-milestone integration question**, not a greenfield design. The app (Lit SPA, Supabase Postgres, S3/CloudFront, CDK, GitHub Actions) already exists and must stay **untouched at runtime**. The DwC export is purely **additive and read-only**: it reads occurrence data, projects it into DwC terms, zips an archive, and hosts it for download.

The six questions posed reduce to one architectural decision with five consequences: **where does the DwC projection live?** The answer drives source-filtering, the taxonomy walk, the component set, the build order, and the alignment strategy. Recommendation below: **a dedicated read-only DB layer (`dwc` schema: one filtered base view + one classification function) feeds a thin Node export script run nightly by GitHub Actions, writing the zip to the existing S3 site bucket; the frontend gains only a static download link.**

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     EXISTING RUNTIME (untouched)                       │
│  ┌──────────────┐   reads    ┌───────────────────────────────────┐    │
│  │  Lit SPA     │──────────▶ │  public.occurrences (4-source view)│   │
│  │ (browser)    │            │  + inaturalist.taxa (hierarchy)    │    │
│  └──────────────┘            └───────────────────────────────────┘    │
│         │ NEW: static <a download> link                                │
└─────────┼──────────────────────────────────────────────────────────────┘
          │
┌─────────▼──────────────────────────────────────────────────────────────┐
│                    NEW: DwC EXPORT PIPELINE (additive)                   │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  DB projection layer  (migrations → `supabase db push`)         │    │
│  │  ┌──────────────────────────┐  ┌────────────────────────────┐   │    │
│  │  │ dwc.occurrences (VIEW)   │  │ dwc.classification(taxon_id)│  │    │
│  │  │ native + maplify ONLY,   │  │ recursive CTE over          │  │    │
│  │  │ DwC-aligned columns      │  │ inaturalist.taxa.parent_id  │  │    │
│  │  └──────────────────────────┘  └────────────────────────────┘   │    │
│  │  ┌──────────────────────────┐                                   │    │
│  │  │ dwc.multimedia (VIEW)    │  one row per photo (coreid = id)  │    │
│  │  └──────────────────────────┘                                   │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                       │ SELECT (service-role, read-only)                │
│  ┌────────────────────▼───────────────────────────────────────────┐    │
│  │  Export script (Node/TS, bin/export-dwca.ts)                    │    │
│  │  • query views → stream CSV (occurrence.txt, multimedia.txt)    │    │
│  │  • emit static meta.xml + templated eml.xml                     │    │
│  │  • zip → dwca-salishsea.zip                                     │    │
│  └────────────────────┬───────────────────────────────────────────┘    │
│                       │ aws s3 cp                                       │
│  ┌────────────────────▼───────────────────────────────────────────┐    │
│  │  GitHub Actions workflow (export-dwca.yml, nightly cron)        │    │
│  │  → s3://salishsea-io/site/dwca/salishsea-dwca.zip               │    │
│  │  → CloudFront invalidation of /dwca/*                           │    │
│  └────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New / Modified | Implementation |
|-----------|----------------|----------------|----------------|
| `dwc.occurrences` view | DwC-aligned column projection over native + Maplify rows only | **NEW** (migration) | SQL view, `security_invoker` off / owned by postgres |
| `dwc.classification(taxon_id)` fn | Walk `inaturalist.taxa.parent_id` → kingdom..genus columns | **NEW** (migration) | SQL recursive CTE function, `STABLE` |
| `dwc.multimedia` view | One row per photo, `coreid` = occurrence id, DwC AC terms | **NEW** (migration) | SQL view |
| `bin/export-dwca.ts` | Query views, stream CSVs, emit meta.xml + eml.xml, zip | **NEW** (script) | Node/TS, `@supabase/supabase-js` or `pg`, `archiver` |
| `meta.xml` / `eml.xml` template | Static DwC-A descriptor + dataset metadata | **NEW** (committed asset / template) | Static file (+ minimal templating for date/recordCount) |
| `.github/workflows/export-dwca.yml` | Nightly cron: run script, upload zip, invalidate CDN | **NEW** (workflow) | Mirrors `deploy.yml` AWS-OIDC pattern |
| Frontend download link | Static `<a href="/dwca/salishsea-dwca.zip" download>` + page copy | **NEW** (small) | One Lit template addition or a static page |
| `public.occurrences` view | — | **UNCHANGED** | Do not touch |
| Lit runtime, app queries | — | **UNCHANGED** | Do not touch |

---

## The Core Decision: Dedicated DB Projection vs. App-Code Mapping

**Recommendation: a dedicated read-only DB layer (`dwc.occurrences` view + `dwc.classification` function), NOT application-code mapping over `public.occurrences`.** HIGH confidence.

### Why a DB view/function, not app mapping

1. **`public.occurrences` is the wrong shape and the wrong source set.** It mixes all four sources and packs data into composite types (`lon_lat`, `taxon`, `occurrence_photo[]`) tuned for the *map UI*, not for DwC. Reusing it would force the export script to (a) filter out two of four sources in app code, (b) unpack composites, and (c) re-derive DwC fields. That pushes domain logic into a throwaway script.
2. **The taxonomy walk is inherently a SQL recursion problem.** `inaturalist.taxa` is a self-referential `parent_id` hierarchy. A recursive CTE is the natural, set-based, indexed way to climb it; doing it in app code means N round-trips or loading the whole taxa table into memory and walking it manually. SQL wins decisively.
3. **Source filtering is trivial and clean in SQL** (`FROM public.observations` UNION `FROM maplify.sightings`) and messy in app code (string-prefix matching `id LIKE 'maplify:%'` / `not like 'inaturalist:%'` against an already-unioned view).
4. **Stable, testable contract.** A DB view is a named, versioned, migration-tracked artifact that ships via the existing `supabase db push` step. Field alignment lives in one auditable place. The export script becomes a dumb serializer: SELECT → CSV → zip. This matches the codebase's existing strong preference for SQL-side logic (the whole `public.occurrences` view, `extract_travel_direction`, `species_id`, `extract_identifiers`, `inaturalist.species_id` are all in SQL).
5. **No runtime coupling.** A new `dwc` schema is strictly additive. The app never reads it; the export script never reads `public.occurrences`. The two paths are independent, satisfying "keep the existing app untouched."

### Why a *new base view* rather than building atop `public.occurrences`

Do **not** layer `dwc.occurrences` on top of `public.occurrences` and filter. Build it directly from the source tables (`public.observations`, `maplify.sightings`) for these reasons:
- The DwC view needs **raw** fields the unified view discards or transforms (e.g. `public_positional_accuracy` semantics, `license_code` per photo, observer vs subject location, `observed_at` precision, contributor name for `recordedBy`/`rightsHolder`). Re-deriving from composites is lossy and brittle.
- It avoids inheriting the all-four-sources union you then have to subtract from.
- It decouples the DwC contract from UI-driven changes to `public.occurrences` (the view has already been rewritten several times — migrations `point_handling`, `sightings_uses_contributors`, `taxon_species_id`). Building on it would make every UI tweak a potential silent break of GBIF output.

**Trade-off accepted:** some column logic (location extraction, identifier regex) is duplicated between `public.occurrences` and `dwc.occurrences`. This is the right trade — duplication of a few `ST_X/ST_Y` projections is cheaper than coupling the export contract to the UI view's churn. Where helpers already exist as functions (`extract_identifiers`, `species_id`), reuse them.

---

## Where Each Concern Lives (answering Q1–Q6)

| Concern | Placement | Rationale |
|---------|-----------|-----------|
| **(Q1) Data-access shape** | New `dwc.occurrences` SQL view over source tables | DB-side projection; script is a serializer (see above) |
| **(Q2) Source filtering** | In the view's `FROM` clause: only `public.observations` + `maplify.sightings`, UNION ALL | Clean at source; never relies on id-prefix string matching |
| **(Q3) Taxonomy walk** | SQL recursive CTE in `dwc.classification(taxon_id integer)` returning kingdom/phylum/class/order/family/genus + scientificName/taxonRank | Set-based recursion over `parent_id`; one call per occurrence via `LATERAL` join or scalar columns |
| **(Q4) New components** | DB migrations → export script → workflow → frontend link (see build order) | Each is additive; dependency-ordered below |
| **(Q5) Alignment work** | In the `dwc.occurrences` view (computed columns), NOT new physical columns on source tables, NOT export-time JS mapping | Keeps source tables untouched; alignment is one auditable SQL artifact; no app/runtime impact |
| **(Q6) Stable occurrenceID** | `occurrenceID` = the source-prefixed id (`'maplify:'||s.id`, native `o.id::text` — prefix natives too, e.g. `'salishsea:'||o.id`) | **Confirmed stable.** ids derive from immutable primary keys; nightly runs reproduce identical values. Recommend prefixing native rows for global uniqueness/namespacing. |

### Q3 detail — the classification function

`inaturalist.taxa(id, parent_id, scientific_name, vernacular_name, rank)` with `rank` an ordered enum (`...genus < ... < kingdom`). A recursive CTE climbs from the occurrence's `taxon_id` to the root, then pivots ranks into DwC columns:

```sql
CREATE FUNCTION dwc.classification(leaf_id integer)
RETURNS TABLE (kingdom text, phylum text, class text, "order" text,
               family text, genus text, scientific_name text, taxon_rank text)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE walk AS (
    SELECT id, parent_id, scientific_name, rank FROM inaturalist.taxa WHERE id = leaf_id
    UNION ALL
    SELECT t.id, t.parent_id, t.scientific_name, t.rank
    FROM inaturalist.taxa t JOIN walk w ON t.id = w.parent_id
  )
  SELECT
    max(scientific_name) FILTER (WHERE rank = 'kingdom'),
    max(scientific_name) FILTER (WHERE rank = 'phylum'),
    max(scientific_name) FILTER (WHERE rank = 'class'),
    max(scientific_name) FILTER (WHERE rank = 'order'),
    max(scientific_name) FILTER (WHERE rank = 'family'),
    max(scientific_name) FILTER (WHERE rank = 'genus'),
    (SELECT scientific_name FROM walk WHERE id = leaf_id),
    (SELECT rank::text FROM walk WHERE id = leaf_id)
  FROM walk;
$$;
```

Used from the view via `LEFT JOIN LATERAL dwc.classification(o.taxon_id) c ON true`. The enum ordering and existing `species_id` function confirm rank comparison is already idiomatic here.

### Q6 detail — occurrenceID stability (confirmed)

The existing view already constructs `'maplify:' || s.id` and `o.id::text`. Both derive from immutable surrogate primary keys (`maplify.sightings.id integer PK`, `public.observations.id`). Nightly regeneration is **deterministic**: same row → same id, forever. This is exactly the GBIF stability requirement (occurrenceID must be globally unique and persistent across republications). **Recommendation:** namespace native rows too (`'salishsea:'||o.id`) so the archive's ids are self-describing and collision-free, and consider a `datasetID`/UUID prefix if GBIF registration is later pursued. No new persistence needed.

---

## Recommended Project Structure (additions only)

```
salishsea-io/
├── supabase/migrations/
│   └── 2026MMDDHHMMSS_dwc_export.sql   # NEW: dwc schema, occurrences view,
│                                       #      classification fn, multimedia view
├── bin/
│   └── export-dwca.ts                  # NEW: query → CSV → meta/eml → zip
├── dwc/                                # NEW: static archive scaffolding
│   ├── meta.xml                        #   DwC-A descriptor (mostly static)
│   └── eml.xml.template                #   dataset metadata (date/count templated)
├── .github/workflows/
│   └── export-dwca.yml                 # NEW: nightly cron, run script, s3 cp, invalidate
└── src/                                # MINIMAL: add download link/page
    └── (one template/route addition)
```

### Structure Rationale

- **`dwc` Postgres schema (not `public`):** namespaces the export contract away from app-facing objects; makes "what is the app vs. the export" obvious; lets you grant read-only and reason about it independently.
- **`bin/export-dwca.ts`:** matches the existing convention of build/utility scripts in `bin/` (`verify-csp-inline-hash.mjs`). The script is intentionally thin.
- **`dwc/` for static descriptors:** `meta.xml` is essentially constant (it maps CSV columns → DwC term URIs); committing it as a reviewed artifact is better than generating XML in code. `eml.xml` needs only the pubDate and recordCount templated.
- **Separate workflow, not a step in `deploy.yml`:** the export is **time-driven (nightly), not push-driven**. Coupling it to deploys would either under-run (only on push) or require deploy-on-cron. A dedicated `export-dwca.yml` with `schedule:` cron mirrors the existing `smoke.yml` precedent (which already uses `schedule:` + `workflow_dispatch:`).

---

## Architectural Patterns

### Pattern 1: DB-side projection, app-side serialization

**What:** All DwC field alignment, source filtering, and taxonomy resolution live in SQL (`dwc` schema). The Node script only paginates SELECTs and writes bytes.
**When to use:** When the transformation is relational (joins, recursion, filtering) and must be a stable, auditable contract — exactly this case.
**Trade-offs:** (+) one source of truth, testable in SQL, ships via existing migration pipeline, zero app coupling. (−) some projection logic duplicated with `public.occurrences`; mitigated by reusing shared functions.

### Pattern 2: Nightly batch via scheduled GitHub Actions (not pg_cron, not edge function)

**What:** A `schedule:`-cron workflow runs the export on a clean runner with AWS OIDC + Supabase service-role creds, then `aws s3 cp` + CloudFront invalidation.
**When to use:** Periodic artifact generation that produces files for CDN hosting.
**Why not pg_cron:** pg_cron (already used for ingestion/vacuum) runs *inside* Postgres and cannot zip files or write to S3. It's the wrong tool for artifact assembly. **Why not a Supabase Edge Function:** none exist in this repo today, and adding the Deno/edge toolchain + scheduling for a once-nightly batch is more surface area than reusing the established Actions+AWS-OIDC pattern the team already operates (`deploy.yml`). The export needs AWS creds and a zip step — both native to the Actions runner. (MEDIUM confidence that Actions beats Edge here; both work, Actions is the lower-friction fit given existing infra and `smoke.yml` precedent.)
**Trade-offs:** (+) reuses existing AWS-OIDC role pattern, no new runtime in prod, easy `workflow_dispatch` manual trigger. (−) export logic runs outside Supabase; needs service-role key in the workflow's `production` environment secrets (flag for the user — see deployment note).

### Pattern 3: Host the archive on the existing CDN, same bucket/prefix

**What:** Write the zip to `s3://salishsea-io/site/dwca/salishsea-dwca.zip`; it's served by the existing CloudFront distribution (origin path `/site`) at `https://salishsea.io/dwca/salishsea-dwca.zip`. Frontend links to it directly.
**When to use:** When a static CDN already fronts the same bucket — no new infra needed.
**Trade-offs:** (+) zero new AWS resources, instant global download, no CDK change required. (−) must add a CloudFront invalidation for `/dwca/*` after each upload (cheap); ensure the path isn't caught by SPA index.html rewrite rules (verify the Lambda@Edge / behavior config passes `/dwca/*` through to S3 — likely fine since it's a real object, but confirm during build).

---

## Data Flow

### Nightly export flow

```
GitHub Actions cron (schedule)
    ↓
checkout → setup node → npm ci
    ↓
node bin/export-dwca.ts   (SUPABASE_URL + service_role key)
    ↓                       ↓ SELECT * FROM dwc.occurrences (paginated)
  stream occurrence.txt ◀──┤ SELECT * FROM dwc.multimedia
  stream multimedia.txt ◀──┘
    ↓
render eml.xml (pubDate, recordCount) + copy static meta.xml
    ↓
archiver → salishsea-dwca.zip
    ↓
configure-aws-credentials (OIDC, same role as deploy)
    ↓
aws s3 cp salishsea-dwca.zip s3://$BUCKET/site/dwca/
aws cloudfront create-invalidation --paths '/dwca/*'
    ↓
available at https://salishsea.io/dwca/salishsea-dwca.zip
```

### Read flow (DB projection)

```
dwc.occurrences (VIEW)
   ├── FROM public.observations  → DwC terms (occurrenceID='salishsea:'||id, recordedBy=contributor, license, coords, eventDate)
   └── FROM maplify.sightings    → DwC terms (occurrenceID='maplify:'||id, recordedBy=usernm/source, coords, eventDate)
        each row LEFT JOIN LATERAL dwc.classification(taxon_id)  → kingdom..genus, scientificName, taxonRank
dwc.multimedia (VIEW)
   └── one row per photo, coreid = parent occurrenceID, accessURI + license  (DwC Audubon Core)
```

---

## Build Order (dependency-respecting)

The quality gate requires: **DB projection → export script → workflow → frontend link.** Concretely:

1. **DB migration (`dwc` schema).** Create `dwc.classification()` first (leaf dependency), then `dwc.occurrences` and `dwc.multimedia` views that use it. Validate by querying in a local Supabase (`http://127.0.0.1:54321`) and spot-checking DwC correctness against `REQUIREMENTS.md`'s field audit. *Ships via existing `supabase db push` on next deploy — independent of the workflow.* **Blocks everything below.**
2. **`meta.xml` + `eml.xml` template.** Author the descriptor mapping the view's columns → DwC term URIs (occurrence core + multimedia extension; coreid linkage). Static, reviewable. Depends only on the view's column contract from step 1.
3. **Export script (`bin/export-dwca.ts`).** Query the views, stream CSVs, emit meta/eml, zip. Run locally end-to-end against local or prod-read Supabase; validate the zip with GBIF's DwC-A validator. Depends on steps 1–2.
4. **Workflow (`export-dwca.yml`).** Wrap the script: nightly `schedule:` + `workflow_dispatch:`, AWS OIDC (reuse `salishsea-deploy-action` role), Supabase service-role secret, `s3 cp` + invalidation. Depends on step 3. Confirm/add the service-role secret to the **production** GitHub environment before first run (deployment-memory rule: tell the user, await confirmation).
5. **Frontend download link/page.** Add a static `<a href="/dwca/salishsea-dwca.zip" download>` plus a short "Data download / DwC-A" explanation. Depends on step 4 producing the object at a stable URL. Lowest-risk, last.

Steps 1–3 can be developed and validated **entirely offline** (local Supabase + local zip), de-risking before any prod-touching workflow exists.

---

## Anti-Patterns to Avoid

| Anti-pattern | Why bad | Instead |
|--------------|---------|---------|
| Map DwC fields in the export script from `public.occurrences` | Couples export to UI view churn; forces composite-unpacking + id-prefix source filtering in JS | Dedicated `dwc.occurrences` view over source tables |
| Filter sources via `id LIKE 'maplify:%'` on the unified view | Fragile string matching; still scans iNat/HappyWhale rows | Filter at `FROM` (only native + maplify tables) |
| Walk taxonomy in app code (N queries or in-memory tree) | Round-trips or full-table load; reinvents recursion | SQL recursive CTE (`dwc.classification`) |
| Add DwC columns to `public.observations` / `maplify.sightings` | Mutates source tables; risks app; alignment scattered | Computed columns in the `dwc` view only |
| Put the export in pg_cron | pg_cron can't zip or write S3 | Scheduled GitHub Actions workflow |
| Bolt the export onto `deploy.yml` | Push-driven, not time-driven; under/over-runs | Separate cron workflow (mirror `smoke.yml`) |
| Generate a new occurrenceID per run (e.g. random UUID) | Breaks GBIF republication identity | Use immutable source-prefixed PK id |
| Stand up a new S3 bucket / CDN for the archive | Needless infra; CDK change | Reuse `salishsea-io` bucket `/site/dwca/` behind existing CloudFront |

---

## Scalability Considerations

Occurrence volume here is modest (native sightings + Maplify in the Salish Sea — thousands to low tens of thousands of rows), so a single nightly full-rebuild of the archive is the right simplicity/correctness trade.

| Concern | Now (full nightly rebuild) | If it grows large |
|---------|----------------------------|-------------------|
| Export runtime | Single SELECT + stream; seconds | Paginate/`COPY`-stream CSV; already streaming |
| Taxonomy walk cost | One recursive CTE per row; taxa table small | Materialize `dwc.classification` as a cached table refreshed on taxa change |
| Archive size | One zip, served from CDN | Same; CDN scales reads infinitely |
| Determinism across runs | PK-derived ids guarantee stability | Unchanged |

No incremental-export complexity is warranted at current scale.

---

## Integration Points Summary (for the roadmapper)

- **Read boundary:** new `dwc` schema reads `public.observations`, `maplify.sightings`, `inaturalist.taxa`, `public.observation_photos`, `contributors`. It reads **nothing the app writes to in a coupling way** and the app reads nothing from `dwc`.
- **Ships through existing pipeline for DB:** migrations deploy via the already-present `supabase db push` step in `deploy.yml` — no new DB deploy mechanism.
- **New independent pipeline for the artifact:** `export-dwca.yml` (cron) reuses the existing AWS OIDC role and the existing S3 bucket + CloudFront distribution. **New secret required:** Supabase service-role key in the `production` GitHub environment — surface to the user and await confirmation before first run.
- **Frontend touch is minimal and static:** one download link/page; no change to data fetching, map, or auth.
- **Quality gate satisfied:** integration points identified; new vs. modified components explicit (table above); build order respects DB→script→workflow→link; taxonomy walk placed in SQL recursive function with rationale; source filtering placed at view `FROM` with rationale; stable occurrenceID confirmed (PK-derived, deterministic).

---

## Confidence & Gaps

- **HIGH:** existing infra facts (S3 bucket `salishsea-io`, `/site` origin path, OIDC role, `supabase db push` in deploy, pg_cron present, `smoke.yml` cron precedent, taxa `parent_id` + ordered rank enum, source-prefixed ids) — all read directly from the repo.
- **MEDIUM:** Actions-vs-Edge-Function choice (both viable; Actions recommended for lower friction with existing AWS-OIDC pattern). CloudFront behavior must be confirmed to pass `/dwca/*` straight to S3 rather than rewriting to `index.html` — verify during build (step 4).
- **Deferred to REQUIREMENTS/field-audit (not architecture):** the exact DwC term-by-term mapping, datatype gaps, and whether ResourceRelationship (travel segments) is in-scope. Architecture above accommodates a Multimedia extension and is extensible to ResourceRelationship without restructuring (add another `dwc` view + extension file in meta.xml).

## Sources

- [Darwin Core Archives How-to Guide — GBIF IPT User Manual](https://ipt.gbif.org/manual/en/ipt/latest/dwca-guide)
- [OBIS Manual — Darwin Core Archive format](https://manual.obis.org/data_format.html)
- [Darwin Core Archive Requirements (iDigBio)](https://github.com/iDigBio/Biospex/wiki/Darwin-Core-Archive-Requirements)
- [Darwin Core Archive — Wikipedia](https://en.wikipedia.org/wiki/Darwin_Core_Archive)
- Repo (HIGH): `supabase/migrations/20260204013006_sightings_uses_contributors.sql`, `20250903172708_initial_schema.sql` (taxa, rank enum, maplify.sightings), `20250914232212_cron.sql`, `20250922000622_taxon_species_id.sql`, `.github/workflows/deploy.yml`, `.github/workflows/smoke.yml`, `infra/lib/infra-stack.ts`
