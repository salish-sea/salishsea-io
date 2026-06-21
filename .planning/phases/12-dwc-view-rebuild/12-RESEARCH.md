# Phase 12: DwC View Rebuild — Research

**Researched:** 2026-06-21
**Domain:** Postgres view rebuild (SQL), DarwinCore Archive TypeScript pipeline
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 [carry/locked]:** `institutionCode='SalishSea'` and `rightsHolder='SalishSea.io'` are constants on every exported row (both branches). `institutionCode` is the **new 26th column** (current views/`fields.ts` have 25, no `institutionCode`). Upstream org credit goes to EML `associatedParty` (D-09), never `institutionCode`.
- **D-02:** Maplify `contributor_id` is **NULL by Phase 11 lock** (D-13/D-14 there), so roadmap SC#3's "recordedBy via FK join" is drift. Decision: **extract `recordedBy` at view-time as a STRING** (regex over `s.comments`) pulling the parenthetical observer name in the headline segment. When no parenthetical name is present, `recordedBy = NULL`.
- **D-03 [RESEARCH TASK — mandatory before regex is finalized]:** Census the parenthetical contents of prod `maplify.sightings.comments` before writing the extraction regex.
- **D-04:** `datasetName = 'SalishSea.io — ' || collection.name`, joined via the Phase-11-resolved `collection_id` FK. Native branch resolves to the `salishsea-direct` collection → `'SalishSea.io — SalishSea.io Direct'`.
- **D-05:** **Trusted filter lives in the EXPORT VIEW only** — add `AND s.trusted` to the `dwc._maplify_occurrences` WHERE clause. Untrusted rows stay in `maplify.sightings` but never reach the archive.
- **D-06:** **Whale Alert Global fallback** for the rare trusted-but-`collection_id IS NULL` row: view-time `COALESCE(collection.name, 'Whale Alert (Global)')` so all `datasetName` values are prefixed `SalishSea.io — `.
- **D-07:** Add structured `<associatedParty>` elements to the EML for upstream organizations.
- **D-08:** Credit **only organizations actually represented in the exported archive** — distinct `organization_id` across collections that have exported rows, NOT all 5 seeded orgs.
- **D-09:** `associatedParty` role = **`contentProvider`**.
- **D-10 [carry/locked]:** 26-column coordinated change is a **single PR** with `npm test` (incl. `fields.test.ts`) green before merge.
- **D-11 [carry/locked]:** SRC-01 (iNat/HappyWhale exclusion) preserved **by construction** — `dwc.occurrences` is the UNION of exactly the two branches.

### Claude's Discretion (defaulted)

- `datasetID` stays a **single constant URI** (not per-collection).
- Archive version string bumps **v1.2 → v1.3** across `datasetName`/`datasetID`/EML `<title>`.
- `datasetName` uses `collection.name` verbatim; the seeded `"Whale Alert (Global)"` carries parens.
- `dwc.datasets` stays effectively single-row for dataset-level EML metadata; the per-org `associatedParty` list is driven separately (D-08).
- Exact migration split, regex form, and whether the row-count gate is an in-migration check vs a `supabase/snippets/12_*` assertion — follow Phase 9/10/11 precedent.

### Deferred Ideas (OUT OF SCOPE)

- GBIF DwC-A re-validation + "Looks Done But Isn't" checklist (Phase 13, ATTR-05).
- Cross-provider `contributor_id` FK unification for Maplify (`contributor_links`).
- Purging untrusted rows from `maplify.sightings` at ingest.
- Normalizing public collection display names (e.g. `"Whale Alert (Global)"` → `"Whale Alert Global"`).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ATTR-01 | Exported records carry `institutionCode="SalishSea"`, `rightsHolder="SalishSea.io"`, and `recordedBy` from contributor | §institutionCode ordinal, §recordedBy regex census, §UNION parity |
| ATTR-02 | `datasetName` is per-collection (`"SalishSea.io — {collection}"`) | §datasetName join pattern, §collections seed data |
| ATTR-03 | iNat and HappyWhale excluded by construction; row-count gate enforces | §guard update, §UNION-by-construction |
| ATTR-04 | Upstream organizations surface in EML as `associatedParty` | §EML associatedParty structure, §dwc.associated_parties view |
</phase_requirements>

---

## Summary

Phase 12 is a coordinated 26-column change across three Postgres views, one TypeScript field array, `meta.xml` generation, the EML builder, and the nightly row-count guard. The entire change lands in a single PR that must have `npm test` green before merge.

The current views (`dwc._native_occurrences`, `dwc._maplify_occurrences`, `dwc.occurrences`) emit 25 columns and were authored in `20260617203900_dwc_schema.sql`. Phase 12 must DROP and recreate all three (Postgres `CREATE OR REPLACE VIEW` does not work when the column count changes), rebuild the Maplify branch to replace the `s.source` 3-way CROSS JOIN LATERAL CASE with `collection_id` FK joins and `AND s.trusted` filter, add `institutionCode` as the 26th column, flip `rightsHolder` from contributor name to constant `'SalishSea.io'`, and derive `recordedBy` on Maplify rows from a view-time regex over `s.comments`.

The test surface in `fields.test.ts`, `meta-xml.test.ts`, and `assertions.ts` all need updating to expect 26 columns. The EML builder needs a new `<associatedParty>` array parameter fed by a `dwc.associated_parties` view (or equivalent query). The nightly guard's row-count floor stays the same (1,000 hard floor) but the Maplify population it counts will shrink to trusted-only rows.

**Primary recommendation:** Implement as a single migration that DROPs the three views in reverse dependency order, recreates both branches and the UNION, then update TS/test/EML in the same PR.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Attribution constants (institutionCode, rightsHolder) | Database / SQL view | — | Emitted as literals in view SELECT; enforced at migration time |
| Per-collection datasetName | Database / SQL view | — | FK join in view body; collection names are reference data |
| recordedBy extraction from comments | Database / SQL view | — | View-time regex on `s.comments`; pure read, no mutation |
| Trusted filter (D-05) | Database / SQL view | — | `AND s.trusted` in `_maplify_occurrences` WHERE clause |
| associatedParty list (D-08) | Database / SQL view + TS build pipeline | — | `dwc.associated_parties` view feeds data; `eml.ts` renders XML |
| UNION-by-construction SRC-01 exclusion | Database / SQL view | — | `dwc.occurrences = SELECT * FROM _native UNION ALL SELECT * FROM _maplify` |
| 26-column field contract | TypeScript (`fields.ts`) | SQL view | `OCCURRENCE_FIELDS` is the source of truth for ordinals; view must match |
| meta.xml 26-field ordinals | TypeScript (`meta-xml.ts`) | — | Pure function over `OCCURRENCE_FIELDS`; no change needed if array is correct |
| EML associatedParty rendering | TypeScript (`eml.ts`) | — | `buildEml` receives the party list; renders XML |
| Row-count guard | TypeScript (`guard.ts`) | — | Queries `COUNT(*) FROM dwc.occurrences` at nightly job time |
| Smoke assertions (SC#1–SC#5) | SQL snippet (`supabase/snippets/12_*.sql`) | — | Follows Phase 9/10/11 precedent |

---

## Standard Stack

### Core (no new dependencies)

This phase installs zero new npm packages. It uses the existing project stack:

| Library | Purpose | Already Present |
|---------|---------|----------------|
| Vitest | Test runner (`npm test`) | Yes — `vitest` in devDependencies |
| TypeScript / tsx | Build pipeline, field types | Yes |
| Postgres (Supabase) | View DDL, regex functions | Yes |
| DuckDB `@duckdb/node-api` | Build pipeline reads views | Yes |

No `npm install` steps. No Package Legitimacy Audit required.

---

## Architecture Patterns

### System Architecture Diagram

```
maplify.sightings (s.trusted = TRUE)         public.observations
        |                                             |
        | s.collection_id FK                         | o.collection_id FK
        |                                             |
        v                                             v
public.collections (c.name)              public.collections (c.name)
        |                                             |
   'SalishSea.io — ' || c.name          'SalishSea.io — ' || c.name
        |                                             |
        v                                             v
dwc._maplify_occurrences (26 cols)   dwc._native_occurrences (26 cols)
        |                                             |
        +------ UNION ALL --------+-------------------+
                                  |
                          dwc.occurrences (26 cols)
                                  |
              +-------------------+---------------------------+
              |                                               |
      DuckDB ATTACH (build.ts)                    dwc.associated_parties
              |                                               |
         occurrence.txt                               eml.ts buildEml()
         meta.xml (26 fields)                               |
         eml.xml (+ associatedParty)                    eml.xml
              |
         salishsea-occurrences-v1.zip
```

### Recommended Project Structure (no new files, edits only)

```
supabase/
  migrations/
    20260621NNNNNN_dwc_view_rebuild.sql  -- new migration (single)
  snippets/
    12_dwc_attribution_assertions.sql    -- new assertion snippet

scripts/dwca/
  fields.ts       -- add institutionCode entry (25 → 26)
  fields.test.ts  -- bump expected length + EXPECTED_OCCURRENCE_NAMES
  eml.ts          -- add associatedParties param + <associatedParty> block
  eml.test.ts     -- add associatedParty shape test
  guard.ts        -- no change required (queries COUNT(*) from view)
  guard.test.ts   -- no change required
  build.ts        -- add associated_parties query + pass to buildEml
```

### Pattern 1: DROP and Recreate View Chain (Postgres — column-count change)

**What:** `CREATE OR REPLACE VIEW` FAILS silently when adding columns to a view that already exists with fewer columns. Postgres will raise an error if the new SELECT list has more columns than the existing view definition — the view must be dropped first.

**Why it matters for this phase:** `dwc.occurrences` depends on both `dwc._native_occurrences` and `dwc._maplify_occurrences`. `dwc.multimedia` depends on nothing in the `dwc` occurrence chain. The correct DROP order is:

```sql
-- Drop in reverse dependency order (occurrences last to drop first because it depends on both branches)
DROP VIEW IF EXISTS dwc.occurrences;
DROP VIEW IF EXISTS dwc._maplify_occurrences;
DROP VIEW IF EXISTS dwc._native_occurrences;

-- Recreate in dependency order
CREATE VIEW dwc._native_occurrences AS ...;   -- 26 columns
CREATE VIEW dwc._maplify_occurrences AS ...;  -- 26 columns (MUST match exactly)
CREATE VIEW dwc.occurrences AS
  SELECT * FROM dwc._native_occurrences
  UNION ALL
  SELECT * FROM dwc._maplify_occurrences;
```

`dwc.multimedia` references `public.observation_photos` and `public.observations`, NOT the occurrence views — it does NOT need to be dropped or recreated.

[CITED: Postgres docs `DROP VIEW`, `CREATE VIEW`]

**Cascade note:** `DROP VIEW IF EXISTS dwc.occurrences` drops only `dwc.occurrences`. The two branch views are not dependents of `dwc.occurrences` (dependency goes the other way). No `CASCADE` needed if dropped in the order above.

### Pattern 2: UNION ALL Column Parity (explicit casts required)

Every column in both branch views MUST carry an explicit type cast. When `dwc.occurrences AS SELECT * UNION ALL SELECT *` is created, Postgres enforces column count, names, and types at `CREATE VIEW` time. Any implicit type drift (e.g. a new expression returning `unknown` vs `text`) causes the migration to fail loudly.

The current 25 columns all use `::text`, `::double precision`, or `::integer`. The new columns follow the same discipline:

```sql
-- New institutionCode column (both branches)
'SalishSea'::text                         AS "institutionCode"

-- New rightsHolder (both branches — was contributor name, now constant)
'SalishSea.io'::text                      AS "rightsHolder"

-- New datasetName (native branch)
('SalishSea.io — ' || c.name)::text       AS "datasetName"

-- New datasetName (maplify branch) 
('SalishSea.io — ' || COALESCE(c.name, 'Whale Alert (Global)'))::text AS "datasetName"

-- New recordedBy (maplify branch — view-time regex, see §recordedBy below)
<regex expression>::text                  AS "recordedBy"

-- recordedBy (native branch — unchanged, still contributor.name)
c.name::text                              AS "recordedBy"
```

[CITED: `supabase/migrations/20260617203900_dwc_schema.sql` — existing cast discipline, lines 219–305]

### Pattern 3: institutionCode Ordinal Position

The DarwinCore convention groups `institutionCode` with organizational/dataset attribution fields. The current 25-column order is (indices 0-based):

```
0  occurrenceID
1  basisOfRecord
2  eventDate
3  scientificName
4  taxonRank
5  kingdom
6  phylum
7  class
8  order
9  family
10 genus
11 decimalLatitude
12 decimalLongitude
13 geodeticDatum
14 coordinateUncertaintyInMeters
15 individualCount
16 occurrenceStatus
17 occurrenceRemarks
18 recordedBy
19 rightsHolder       ← dcterms URI
20 datasetName
21 datasetID
22 license            ← dcterms URI
23 dynamicProperties
24 informationWithheld
```

**Recommended ordinal for `institutionCode`: index 19**, inserting before `rightsHolder`. This groups the three constant attribution fields together: `institutionCode` (19), `rightsHolder` (20), `datasetName` (21), `datasetID` (22). The existing dcterms fields shift: `rightsHolder` 19→20, `datasetName` 20→21, `datasetID` 21→22, `license` 22→23, `dynamicProperties` 23→24, `informationWithheld` 24→25.

**Resulting 26-column order:**
```
0  occurrenceID
1  basisOfRecord
2  eventDate
3  scientificName
4  taxonRank
5  kingdom
6  phylum
7  class
8  order
9  family
10 genus
11 decimalLatitude
12 decimalLongitude
13 geodeticDatum
14 coordinateUncertaintyInMeters
15 individualCount
16 occurrenceStatus
17 occurrenceRemarks
18 recordedBy
19 institutionCode    ← NEW (dwc/terms URI — NOT dcterms)
20 rightsHolder       ← shifted (dcterms URI)
21 datasetName        ← shifted
22 datasetID          ← shifted
23 license            ← shifted (dcterms URI)
24 dynamicProperties  ← shifted
25 informationWithheld ← shifted
```

**`termUri` for `institutionCode`:** `http://rs.tdwg.org/dwc/terms/institutionCode`
(dwc/terms namespace, NOT dcterms — confirmed by CONTEXT.md §Specifics and DwC specification)

**Impact on `fields.test.ts` dcterms invariant:** The test at line 84 asserts "every non-dcterms index (i.e. i ∉ {19, 22}) carries a dwc/terms URI". After the shift, the dcterms positions become {20, 23} (rightsHolder and license). This test must be updated to `i ∉ {20, 23}`. The hardcoded position tests at lines 77-82 must also be updated to check index 20 for rightsHolder and index 23 for license.

**Impact on `meta-xml.test.ts`:** The hardcoded assertions at lines 97 and 101 check `pairs[19]` and `pairs[22]`. After the shift these become `pairs[20]` (rightsHolder) and `pairs[23]` (license). The total field count assertion on line 67 currently expects 31 (25 occ + 6 mm); it must become 32 (26 + 6).

**No impact on `dwc.multimedia`:** `dwc.multimedia` has its own `coreId` join key (`'salishsea:' || op.observation_id::text`) that references `dwc.occurrences."occurrenceID"`. This is a string equality join, not an ordinal join. Adding a column to `dwc.occurrences` does NOT affect `dwc.multimedia` or its coreId semantics. [CITED: `20260617203900_dwc_schema.sql` lines 663-697]

### Pattern 4: recordedBy Extraction Regex (Maplify branch)

**Census findings from `occurrence-bodies.tsv`** (a prod sample of exported occurrences including Maplify rows — the D-03 census artifact):

The dominant bracket-tagged pattern:
```
[Collection Tag] Description text (Observer Name)<br><br>Submitted by...
```

Parenthetical shapes found in the sample (169 maplify rows):
- Single name: `(Michelle Goll)`, `(Fu Lu Amy)`, `(Linda N.K)`, `(Isadora M.)` — **most common**
- Multi-name comma list: `(Howard Garrett, Alisa Schulman-Janiger)`, `(Michalyn Marzocco, Philip Coates)` — should yield NULL (not a single observer name)
- Identifier prefix: `(ID Rachel Haight)`, `(IDs Rachel Haight)`, `(ID Bart Rulon)` — must yield NULL (these are identification credits, not report observers)
- Non-name directional: `(heading northwest, aka northwestbound)`, `(alcatraz, pier 39)` — must yield NULL

**Critical complication — multiple parens in one headline:**
```
[Orca Network] T100C at least, westbound (Jason Cook) (ID Rachel Haight)<br><br>...
[PSWS] Biggs. ... (Shayla Roberts) (ID Alisa Lemire Brooks)<br><br>...
```
The FIRST parenthetical is the observer name; the SECOND is an identification credit. The regex must match only the FIRST parenthetical in the headline segment (before `<br>`).

**D-03 mandatory census against prod before finalizing regex:**
The sample in `occurrence-bodies.tsv` covers 169 recent rows. The full prod set has ~6,800 rows. The regex must be validated against the full prod set before being committed. This is a read-only `SELECT` census of `maplify.sightings.comments` where `trusted = TRUE`, extracting all unique parenthetical patterns.

**Proposed regex approach (to be finalized after D-03 census):**

Step 1: Extract the headline segment (before the first `<br>`):
```sql
split_part(s.comments, '<br>', 1)   -- everything before first <br>
```

Step 2: Extract the LAST parenthetical in the headline:
```sql
-- Match: optional bracket tag, text, then (Name) — take first parens group
-- after stripping the bracket tag prefix
(regexp_match(
  split_part(s.comments, '<br>', 1),
  '\(([^()]+)\)$'            -- last parens at end of headline segment
))[1]
```

The `$` anchor targets the LAST parenthetical in the headline. This correctly selects `Jason Cook` from `(Jason Cook) (ID Rachel Haight)` ONLY if we want the first parens — the trailing `(ID Rachel Haight)` would be the last. So we need the FIRST parenthetical after the bracket tag, not the last.

**Revised approach — target the FIRST parenthetical after the bracket tag:**
```sql
(regexp_match(
  split_part(s.comments, '<br>', 1),       -- headline only
  '^\[[^\]]+\] .+\(([^()]+)\)'            -- bracket tag + text + first parens
))[1]
```

However this also matches `(Jason Cook)` in the `(Jason Cook) (ID Rachel Haight)` case ONLY if the regex is greedy and stops at the first `\(`. But regex `\(([^()]+)\)` without `$` matches the first parens, not the last. Given the patterns observed:

- `[Tag] text (Name)<br>...` → match `Name`
- `[Tag] text (Name1) (ID Name2)<br>...` → we WANT `Name1` (the first parens after the description text)
- `(heading northwest, ...)` → contains comma → NULL by post-processing or regex guard

**Recommended approach (pending D-03 census confirmation):**

```sql
-- Extract first parenthetical after bracket tag in headline, NULL if contains comma or "ID"
NULLIF(
  CASE
    WHEN (regexp_match(
           split_part(s.comments, '<br>', 1),
           '^\[[^\]]+\]\s+.+?\(([^()]+)\)'
         ))[1] ~ ',' 
      OR (regexp_match(
           split_part(s.comments, '<br>', 1),
           '^\[[^\]]+\]\s+.+?\(([^()]+)\)'
         ))[1] ~ '^IDs?\s'
    THEN NULL
    ELSE (regexp_match(
           split_part(s.comments, '<br>', 1),
           '^\[[^\]]+\]\s+.+?\(([^()]+)\)'
         ))[1]
  END,
  NULL
)::text AS "recordedBy"
```

This is ASSUMED and MUST be confirmed by a D-03 census against full prod `maplify.sightings` before the migration is finalized. The census task is a mandatory Wave 1 deliverable.

**For Maplify rows WITHOUT a bracket tag** (source-only rows like `whale_alert`, `FARPB`, and non-bracket trusted rows): the regex `^\[[^\]]+\]` will not match, so `regexp_match(...)` returns NULL → `recordedBy = NULL`. This is correct per D-02 ("When no parenthetical name is present… `recordedBy = NULL`").

### Pattern 5: datasetName JOIN

**Native branch:**
```sql
-- public.observations already has collection_id populated by Phase 11 backfill
-- collection_id DEFAULT = (SELECT id FROM public.collections WHERE slug = 'salishsea-direct')
-- Collection name = 'SalishSea.io Direct'
-- Result: 'SalishSea.io — SalishSea.io Direct'
JOIN public.collections c ON c.id = o.collection_id
-- datasetName:
('SalishSea.io — ' || c.name)::text AS "datasetName"
```

Since `public.observations.collection_id` has a NOT NULL DEFAULT of the `salishsea-direct` collection id, this JOIN is always non-null for the native branch.

**Maplify branch:**
```sql
-- maplify.sightings.collection_id is populated by Phase 11 resolve_collection backfill
-- But some rows may have collection_id IS NULL (FARPB = STAY_NULL, and any trusted rows
-- without a resolvable tag)
-- D-06: COALESCE fallback to 'Whale Alert (Global)'
LEFT JOIN public.collections c ON c.id = s.collection_id
-- datasetName:
('SalishSea.io — ' || COALESCE(c.name, 'Whale Alert (Global)'))::text AS "datasetName"
```

A `LEFT JOIN` is required (not `JOIN`) because `collection_id` can be NULL on Maplify rows. If `collection_id IS NULL`, `c.name` is NULL, and the COALESCE returns `'Whale Alert (Global)'`. [CITED: D-06 in CONTEXT.md]

**Distinct `datasetName` values expected (post-Phase 12):**
Based on the Phase 11 census (6,832 prod rows), collections with exported rows will include:
`SalishSea.io — Orca Network`, `SalishSea.io — Whale Alert (Global)`, `SalishSea.io — Whale Alert (Alaska)`, `SalishSea.io — The Marine Mammal Center`, `SalishSea.io — Cascadia Research Collective`, `SalishSea.io — Whale Alert`, `SalishSea.io — PSWS`, `SalishSea.io — MCW`, `SalishSea.io — SalishSea.io Direct`, and possibly others. All prefixed `'SalishSea.io — '`.

### Pattern 6: EML associatedParty Structure

**GBIF EML 2.1.1 `<associatedParty>` element structure (from schema analysis):**

The GBIF EML profile uses `associatedParty` as type `agentWithRoleType`, which adds a required `<role>` child to the base `agentType`. For an organization without an individual contact, the minimal element is:

```xml
<associatedParty>
  <organizationName>Orca Network</organizationName>
  <onlineUrl>https://orcanetwork.org</onlineUrl>
  <role>contentProvider</role>
</associatedParty>
```

[CITED: `https://rs.gbif.org/schema/eml-gbif-profile/1.1/eml-gbif-profile.xsd` — agentWithRoleType extends agentType with role element]

**Placement in EML document:** After the `<contact>` block, before `<methods>`. Standard EML 2.1.1 ordering allows multiple `<associatedParty>` elements.

**Data source for the list (D-08 — only orgs represented in the export):**

A `dwc.associated_parties` view follows the `dwc.datasets` view-over-VALUES precedent. However this view needs to be data-driven (only orgs with exported rows), which requires joining to the occurrence data:

```sql
CREATE VIEW dwc.associated_parties AS
SELECT DISTINCT
  org.name,
  org.url
FROM dwc.occurrences occ
JOIN maplify.sightings s ON occ."occurrenceID" = 'maplify:' || s.id::text
JOIN public.collections c ON c.id = s.collection_id
JOIN public.organizations org ON org.id = c.organization_id
WHERE org.id IS NOT NULL;
```

**Alternative approach (recommended — avoids performance issues with join to full view):**

A build-time query in `build.ts` (Step 15.5) that runs against the Postgres DB before EML generation:

```sql
SELECT DISTINCT org.name, org.url
FROM maplify.sightings s
JOIN public.collections c ON c.id = s.collection_id
JOIN public.organizations org ON org.id = c.organization_id
WHERE s.trusted = TRUE
  AND NOT s.is_test
  AND s.number_sighted BETWEEN 1 AND 1000
  AND s.source != 'rwsas'
UNION
SELECT DISTINCT org.name, org.url
FROM public.observations o
JOIN public.collections c ON c.id = o.collection_id
JOIN public.organizations org ON org.id = c.organization_id
ORDER BY name;
```

This query mirrors the view filters, avoiding a full scan of `dwc.occurrences`. It runs once per nightly build.

**`EmlInput` extension (D-07/08/09):**

```typescript
// Add to EmlInput interface
export interface AssociatedParty {
  readonly name: string;
  readonly url: string;
  readonly role: 'contentProvider';
}

export interface EmlInput {
  readonly datasets: DatasetsRow;
  readonly temporalCoverage: { readonly begin: string; readonly end: string };
  readonly associatedParties: readonly AssociatedParty[];   // NEW
}
```

`buildEml` renders each party as:
```xml
<associatedParty>
  <organizationName>${xmlEsc(party.name)}</organizationName>
  <onlineUrl>${xmlEsc(party.url)}</onlineUrl>
  <role>contentProvider</role>
</associatedParty>
```

**Handling the hardcoded org prose in `eml.ts` lines 130-142:**
`methodsPara2` currently mentions "Orca Network and Cascadia Research Collective" by name in the methods text. After Phase 12, the data-driven `<associatedParty>` elements carry this credit — but the methods text still accurately describes the ingestion path. The methods text does NOT need to be updated this phase (it remains factually correct); it may be refined in Phase 13 if needed.

### Pattern 7: Version Bump v1.2 → v1.3

**All locations carrying the version string:**

1. `supabase/migrations/20260617203900_dwc_schema.sql` line 273:
   `'SalishSea.io Cetacean Occurrences (v1.2)'::text AS "datasetName"` — on `dwc._native_occurrences`. **This changes to per-collection `datasetName` in Phase 12** (the old constant datasetName is replaced entirely), so the v1.2 string is gone.

2. `supabase/migrations/20260617203900_dwc_schema.sql` line 574:
   `'SalishSea.io Cetacean Occurrences (v1.2)'::text` — `title` column in `dwc.datasets`. This must be updated to `'SalishSea.io Cetacean Occurrences (v1.3)'` in the Phase 12 migration.

3. `scripts/dwca/eml.test.ts` line 31:
   `title: 'SalishSea.io Cetacean Occurrences (v1.2)'` — mock DatasetsRow in the EML test. Must be updated to `(v1.3)`.

4. No other TS/config files carry the version string — `build.ts`, `meta-xml.ts`, `guard.ts`, `assertions.ts` do not hardcode `v1.2`.

**Method:** The Phase 12 migration issues an UPDATE to the `dwc.datasets` view's underlying VALUES. Since `dwc.datasets` is a view-over-VALUES (not a table), there is no `UPDATE dwc.datasets SET title = ...`. Instead, the migration recreates `dwc.datasets`:

```sql
-- In Phase 12 migration:
CREATE OR REPLACE VIEW dwc.datasets AS
SELECT * FROM (
  VALUES (
    'https://salishsea.io/datasets/occurrences-v1'::text,
    NULL::text,
    'SalishSea.io Cetacean Occurrences (v1.3)'::text,  -- v1.2 → v1.3
    ...  -- remaining 16 columns unchanged
  )
) AS d (...);
```

`CREATE OR REPLACE VIEW dwc.datasets` works here because the column count and types are unchanged — only a VALUES literal changes. [CITED: Postgres `CREATE OR REPLACE VIEW` — column list must not change]

### Pattern 8: trusted Filter and Guard Update

**`trusted` column properties on `maplify.sightings`:**
```sql
trusted boolean NOT NULL,    -- initial_schema.sql line 213
```
`trusted boolean NOT NULL` — no NULL values possible. `AND s.trusted` is a total filter; no `IS TRUE` or `COALESCE` needed. [CITED: `20250903172708_initial_schema.sql` line 213]

**Impact on row count:** The Phase 11 census found 6,832 prod rows total. The current view filters out `is_test`, `number_sighted NOT BETWEEN 1 AND 1000`, and `source = 'rwsas'` rows. Adding `AND s.trusted` will further reduce the Maplify export. The exact trusted-row count requires a D-03 census against prod; this is flagged as ASSUMED below.

**Guard update (guard.ts):** The current hard floor is `ROW_FLOOR = 1,000` rows (`guard.ts` line 41). The guard queries `COUNT(*) FROM dwc.occurrences`. After Phase 12, the count will decrease (trusted-only Maplify instead of all non-test Maplify). If the resulting row count drops below 1,000 (unlikely given ~6,800 total prod rows), the floor would need adjustment. More likely: the floor stays at 1,000 and the actual count remains well above it. No change to `guard.ts` is required unless the prod trusted-row count is unexpectedly low.

**No `guard.test.ts` changes needed** — the test mocks DuckDB and does not hardcode expected row counts.

### Anti-Patterns to Avoid

- **`CREATE OR REPLACE VIEW` when adding a column:** Fails with "cannot change number of columns". Must DROP + CREATE.
- **`CASCADE` on dependent views:** `DROP VIEW dwc.occurrences CASCADE` would also drop `dwc._native_occurrences` and `dwc._maplify_occurrences` (its sources) — no, wait, `dwc.occurrences` SELECTS FROM the branches; it depends on them, not the other way. In Postgres, `CASCADE` on `dwc.occurrences` only drops objects that depend ON `dwc.occurrences`. The branches are not dependents. But: there may be downstream views or materialized views that depend on `dwc.occurrences` — check before running CASCADE. Based on code review, no other view depends on `dwc.occurrences`. [CITED: codebase review]
- **JOIN instead of LEFT JOIN for Maplify collection:** `collection_id` can be NULL (FARPB rows and any unresolved trusted rows). Use `LEFT JOIN public.collections c ON c.id = s.collection_id` plus `COALESCE(c.name, 'Whale Alert (Global)')`.
- **Regex on raw `comments` without extracting headline first:** The comments field contains `<br><br>` dividers. The parenthetical name appears in the headline segment (before the first `<br>`). Matching against the full comments string could match an `(observer)` pattern in the attribution line below the `<br>`.
- **Using `usernm` for `recordedBy`:** `usernm` is the UI client username (the Whale Alert app user), NOT the observer. [CITED: D-02 in CONTEXT.md — "Maplify `usernm` passes through NULL per D-10 (anonymous Whale Alert submissions exist)"]
- **Removing the CROSS JOIN LATERAL before DROP:** No cleanup needed; the entire Maplify view is replaced in the migration.
- **Version string in `datasetID`:** `datasetID` is `'https://salishsea.io/datasets/occurrences-v1'` — the `/occurrences-v1` slug does NOT change with the v1.3 bump. Only the human-readable `title` and `datasetName` carry the version string.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parenthetical extraction from comments | Custom tokenizer | Postgres `regexp_match()` | Built-in, tested, runs in-view |
| EML XML generation | String concatenation | Extend `buildEml()` + `xmlEsc()` | Already handles XML escaping; `T-06-03-XML` threat mitigation in place |
| View dependency ordering | Manual tracking | Postgres raises on incorrect DROP order | Migration fails loudly if order is wrong |
| org-list query | Hardcoded org array | SQL query against `public.collections JOIN public.organizations` | D-08 requires data-driven list |

---

## Common Pitfalls

### Pitfall 1: `CREATE OR REPLACE VIEW` Silently Changes Column Semantics (but not count)

**What goes wrong:** If you `CREATE OR REPLACE VIEW dwc._native_occurrences` with the same 25 columns but different expressions, the view updates. If you try it with 26 columns, Postgres raises `ERROR: cannot change number of columns of view "_native_occurrences"`.

**How to avoid:** Always DROP + CREATE when column count changes.

**Warning signs:** Migration error mentioning "cannot change number of columns".

### Pitfall 2: UNION ALL Silently Accepts Type Coercion

**What goes wrong:** If column 19 in the native branch is `'SalishSea'::text` but column 19 in the Maplify branch is `'SalishSea'` (no cast), Postgres may coerce silently at CREATE VIEW time, producing `unknown` typed columns that behave differently in downstream consumers.

**How to avoid:** Every scalar in both branch views carries an explicit `::text` cast. The new `institutionCode`, updated `rightsHolder`, and new `datasetName` expressions must all have `::text`.

### Pitfall 3: recordedBy Regex Matching Non-Name Parentheticals

**What goes wrong:** The regex extracts `(heading northwest, aka northwestbound)` → `recordedBy = 'heading northwest, aka northwestbound'`, which is garbage in the archive.

**How to avoid:** Post-filter: if the extracted string contains a comma, or begins with `IDs? `, NULL it out. Confirm the regex against full prod census (D-03) before committing.

### Pitfall 4: Forgetting `dwc.datasets` Title Update (v1.3 bump)

**What goes wrong:** The `dwc.datasets` view still emits `'SalishSea.io Cetacean Occurrences (v1.2)'` as `title` because the VALUES literal in the migration is not updated. The EML `<title>` then shows v1.2.

**How to avoid:** Phase 12 migration must `CREATE OR REPLACE VIEW dwc.datasets` with the v1.3 title string. `eml.test.ts` must be updated to match.

### Pitfall 5: LEFT JOIN Not Used for Maplify collection_id

**What goes wrong:** `JOIN public.collections c ON c.id = s.collection_id` (inner join) silently drops Maplify rows where `collection_id IS NULL` (FARPB rows, any unresolved trusted rows). The export row count drops below the true trusted-only baseline with no error.

**How to avoid:** Use `LEFT JOIN` + `COALESCE(c.name, 'Whale Alert (Global)')`. Confirm with SC#3 assertion: `SELECT COUNT(*) FROM dwc.occurrences WHERE "datasetName" IS NULL` = 0.

### Pitfall 6: `assertFieldAlignment` Fails After Ordinal Shift Without Matching Test Update

**What goes wrong:** `fields.test.ts` hardcodes position tests for indices 19 and 22 (dcterms pair). After the shift, the dcterms pair is at 20 and 23. If the test is not updated, it fails for the wrong reason (positions mismatch, not URI mismatch), confusing diagnosis.

**How to avoid:** Update `fields.test.ts` in the same commit as `fields.ts`. Specifically update lines 77-82 (position checks) and lines 84-91 (the "non-dcterms" exclusion set) to use `{20, 23}` instead of `{19, 22}`.

### Pitfall 7: EML `<associatedParty>` Placed in Wrong Document Location

**What goes wrong:** GBIF EML profile expects `<associatedParty>` elements inside `<dataset>`, after `<creator>` / `<metadataProvider>` / `<pubDate>` / `<abstract>` etc., and before `<coverage>` or `<contact>`. Placing them after `<methods>` or outside `<dataset>` causes XSD validation failure in Phase 13.

**How to avoid:** Place `<associatedParty>` elements before `<coverage>` in `buildEml()`. The EML 2.1.1 schema sequence is: `title`, `creator*`, `metadataProvider*`, `associatedParty*`, `pubDate`, `language`, `abstract`, ... `contact`, `methods`.

### Pitfall 8: `dwc.occurrences` Depends on Branch Views — DROP order matters

**What goes wrong:** Dropping `dwc._native_occurrences` before `dwc.occurrences` causes `ERROR: cannot drop view dwc._native_occurrences because other objects depend on it — DETAIL: view dwc.occurrences depends on view dwc._native_occurrences`.

**How to avoid:** Drop in order: `dwc.occurrences` first, then `dwc._maplify_occurrences`, then `dwc._native_occurrences`.

---

## Code Examples

### 26th Column Addition in Native Branch

```sql
-- Source: supabase/migrations/20260617203900_dwc_schema.sql (to be updated)
-- Insert after recordedBy (col 18), before current rightsHolder (now col 20)

-- 18. recordedBy (unchanged — contributor name)
c.name::text                                       AS "recordedBy",
-- 19. institutionCode (NEW col 26)
'SalishSea'::text                                  AS "institutionCode",
-- 20. rightsHolder (was col 19, now constant per ATTR-01)
'SalishSea.io'::text                               AS "rightsHolder",
-- 21. datasetName (was col 20, now per-collection per ATTR-02)
('SalishSea.io — ' || c.name)::text                AS "datasetName",
-- 22. datasetID (was col 21, unchanged)
'https://salishsea.io/datasets/occurrences-v1'::text AS "datasetID",
-- ...remaining columns shifted accordingly
```

### Maplify Branch recordedBy + datasetName + trusted Filter

```sql
-- In dwc._maplify_occurrences WHERE clause (after existing filters):
WHERE NOT s.is_test
  AND s.number_sighted BETWEEN 1 AND 1000
  AND s.source != 'rwsas'
  AND s.trusted                    -- D-05: trusted-only export

-- LEFT JOIN for collection (D-04, D-06):
LEFT JOIN public.collections c ON c.id = s.collection_id

-- recordedBy extraction (D-02/D-03 — to be finalized after prod census):
NULLIF(
  (CASE
    WHEN (regexp_match(split_part(s.comments, '<br>', 1),
                       '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '[,]'
      OR (regexp_match(split_part(s.comments, '<br>', 1),
                       '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1] ~ '^IDs?\s'
    THEN NULL
    ELSE (regexp_match(split_part(s.comments, '<br>', 1),
                       '^\[[^\]]+\]\s+.+?\(([^()]+)\)'))[1]
  END)::text,
  NULL
)                                                          AS "recordedBy",
-- institutionCode (NEW):
'SalishSea'::text                                          AS "institutionCode",
-- rightsHolder (was org display_name, now constant per D-01):
'SalishSea.io'::text                                       AS "rightsHolder",
-- datasetName (was display_name, now per-collection per D-04/D-06):
('SalishSea.io — ' || COALESCE(c.name, 'Whale Alert (Global)'))::text AS "datasetName",
```

### fields.ts: Adding institutionCode Entry

```typescript
// Source: scripts/dwca/fields.ts (to be updated)
// Insert at array index 19 (between recordedBy and rightsHolder):
export const OCCURRENCE_FIELDS = [
    // ... indices 0-18 unchanged ...
    { name: 'recordedBy',    termUri: 'http://rs.tdwg.org/dwc/terms/recordedBy' },     // 18
    { name: 'institutionCode', termUri: 'http://rs.tdwg.org/dwc/terms/institutionCode' }, // 19 NEW
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'rightsHolder',  termUri: 'http://purl.org/dc/terms/rightsHolder' },         // 20 (was 19)
    { name: 'datasetName',   termUri: 'http://rs.tdwg.org/dwc/terms/datasetName' },      // 21 (was 20)
    { name: 'datasetID',     termUri: 'http://rs.tdwg.org/dwc/terms/datasetID' },        // 22 (was 21)
    // dcterms — NOT dwc/terms; per F-03 the URI is carried literally per entry.
    { name: 'license',       termUri: 'http://purl.org/dc/terms/license' },              // 23 (was 22)
    { name: 'dynamicProperties', termUri: 'http://rs.tdwg.org/dwc/terms/dynamicProperties' }, // 24 (was 23)
    { name: 'informationWithheld', termUri: 'http://rs.tdwg.org/dwc/terms/informationWithheld' }, // 25 (was 24)
] as const satisfies readonly OccurrenceField[];
```

### EML associatedParty XML block

```xml
<!-- GBIF EML 2.1.1 — inside <dataset>, before <coverage> -->
<associatedParty>
  <organizationName>Orca Network</organizationName>
  <onlineUrl>https://orcanetwork.org</onlineUrl>
  <role>contentProvider</role>
</associatedParty>
<associatedParty>
  <organizationName>Cascadia Research Collective</organizationName>
  <onlineUrl>https://cascadiaresearch.org</onlineUrl>
  <role>contentProvider</role>
</associatedParty>
```
[CITED: `https://rs.gbif.org/schema/eml-gbif-profile/1.1/eml-gbif-profile.xsd` — agentWithRoleType definition]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (already installed) |
| Config file | `vite.config.ts` (includes test config) or auto-discovered |
| Quick run command | `npm test -- --run scripts/dwca/fields.test.ts` |
| Full suite command | `npm test -- --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ATTR-01 | `OCCURRENCE_FIELDS.length === 26` | unit | `npm test -- --run scripts/dwca/fields.test.ts` | ✅ (update needed) |
| ATTR-01 | `assertFieldAlignment` confirms view ↔ TS array | runtime | `npm run build:dwca` (integration) | ✅ assertions.ts |
| ATTR-01 | `institutionCode` at index 19 carries dwc/terms URI | unit | `npm test -- --run scripts/dwca/fields.test.ts` | ✅ (update needed) |
| ATTR-02 | `datasetName` prefixed `'SalishSea.io — '` | sql snippet | `psql ... -f supabase/snippets/12_dwc_attribution_assertions.sql` | ❌ Wave 0 |
| ATTR-03 | `COUNT(*) dwc.occurrences` within trusted Maplify + native bounds | sql snippet | `psql ... -f supabase/snippets/12_dwc_attribution_assertions.sql` | ❌ Wave 0 |
| ATTR-04 | EML `<associatedParty>` block present with role=contentProvider | unit | `npm test -- --run scripts/dwca/eml.test.ts` | ✅ (update needed) |
| ATTR-04 | `dwc.associated_parties` view returns org rows | sql snippet | `psql ... -f supabase/snippets/12_dwc_attribution_assertions.sql` | ❌ Wave 0 |
| meta.xml | 26 fields in correct ordinal order | unit | `npm test -- --run scripts/dwca/meta-xml.test.ts` | ✅ (update needed) |

### Sampling Rate

- **Per task commit:** `npm test -- --run scripts/dwca/fields.test.ts scripts/dwca/meta-xml.test.ts scripts/dwca/eml.test.ts`
- **Per wave merge:** `npm test -- --run` (full suite)
- **Phase gate:** Full suite green + `psql ... -f supabase/snippets/12_dwc_attribution_assertions.sql` passes

### Wave 0 Gaps

- [ ] `supabase/snippets/12_dwc_attribution_assertions.sql` — covers SC#1 (institutionCode distinct), SC#2 (rightsHolder distinct), SC#3 (datasetName prefix + recordedBy), SC#4 (npm test green — post-hoc), SC#5 (row-count guard)
- [ ] D-03 census script (one-time read-only prod query for recordedBy regex validation) — not a test file, but a mandatory research artifact before the regex is finalized

---

## Security Domain

`security_enforcement` is not explicitly set to `false` in `.planning/config.json`. Default treatment: enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — (no auth changes) |
| V3 Session Management | No | — |
| V4 Access Control | No | — (dwc schema not PostgREST-exposed, no RLS changes) |
| V5 Input Validation | Partial | `xmlEsc()` in `eml.ts` handles XML injection from org names/URLs; regex over user-supplied `comments` is read-only |
| V6 Cryptography | No | — |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XML injection via org name/URL in EML | Tampering | `xmlEsc()` already applied in `buildEml()` — extend to `associatedParty` values |
| Regex catastrophic backtracking on `comments` | Denial of Service | Use atomic regex patterns; `regexp_match` in Postgres uses POSIX RE2-like engine with linear guarantees |
| Cross-schema view leakage | Information Disclosure | `dwc` schema not in `api.schemas` (PostgREST-unexposed); unchanged by this phase |

---

## Open Questions (RESOLVED)

1. **D-03 prod census — exact trusted row count and full parenthetical shape inventory**
   - What we know: 169-row sample shows the dominant pattern clearly; ~6,800 total prod rows; `AND s.trusted` will filter out untrusted rows
   - What's unclear: Exact count of trusted rows; any edge-case parenthetical shapes not in the sample; whether any trusted row has `comments IS NULL`
   - Recommendation: Wave 1 task: read-only prod census query against `maplify.sightings WHERE trusted = TRUE`, capturing `DISTINCT regexp_match(split_part(comments, '<br>', 1), '^\[[^\]]+\]\s+.+?\(([^()]+)\)')` results; commit as `maplify_trusted_comments_census.tsv`
   - RESOLVED: Plan 12-01 Wave-1 read-only census (`supabase/snippets/12_comments_census.sql`) grounds the regex before it ships; the exact trusted row count is discovered at execution time, and the `guard.ts` floor is adjusted in Plan 12-03 if the trusted count is below the existing guard floor (ROW_FLOOR = 1,000).

2. **`dwc.associated_parties` as a SQL view vs build-time query**
   - What we know: D-08 requires data-driven org list; `dwc.datasets` is a view-over-VALUES precedent; build.ts already queries multiple views
   - What's unclear: Whether a Postgres view that JOINs `dwc.occurrences` has acceptable performance (view has no indexes; full scan at each `buildEml` invocation is once-per-nightly-build)
   - Recommendation: Build-time query in `build.ts` is simpler and avoids adding another view to the `dwc` schema. The query runs once per build, not per view-consumer.
   - RESOLVED: Build-time query in `build.ts` feeding `EmlInput.associatedParties` — it mirrors the export-view filters and adds no new DB object (per Plan 12-03). No `dwc.associated_parties` view is created.

3. **`EmlInput.associatedParties` ordering**
   - What we know: D-08 says "distinct org_id across collections with exported rows"; multiple orgs possible
   - What's unclear: Desired sort order for the XML output (alphabetical by name? by row count?)
   - Recommendation: Sort alphabetically by org name for determinism. `ORDER BY org.name` in the query.
   - RESOLVED: `ORDER BY org.name` — alphabetical by organization name for deterministic EML output (per Plan 12-03).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Trusted-only Maplify row count stays well above 1,000 after `AND s.trusted` filter | §Pattern 8: trusted Filter | If trusted rows < 1,000, guard.ts ROW_FLOOR needs adjustment |
| A2 | Proposed recordedBy regex correctly handles all prod comment patterns after D-03 census | §Pattern 4: recordedBy | Garbage or missed names in `recordedBy` field; SC#3 failure |
| A3 | The `<associatedParty>` element placement (before `<coverage>`) passes GBIF XSD validation | §Pattern 6: EML associatedParty | EML validation failure in Phase 13 |
| A4 | No other Postgres objects (functions, materialized views, policies) depend on `dwc.occurrences` and will be broken by DROP | §Pattern 1: DROP and Recreate | Migration error; need to identify and drop dependents first |
| A5 | `dwc.associated_parties` query (or build-time equivalent) returns at least Orca Network and Cascadia for the current prod dataset | §Pattern 6: EML associatedParty | EML has empty `<associatedParty>` list; D-07/D-08 not satisfied |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (It is not empty — A1-A5 above require D-03 census confirmation.)

---

## Sources

### Primary (HIGH confidence)

- `supabase/migrations/20260617203900_dwc_schema.sql` — exact 25-column views, current column order, casts, WHERE clause, CROSS JOIN LATERAL CASE
- `supabase/migrations/20260619184037_reference_tables.sql` — `public.organizations` (5 seeded), `public.collections` (21 seeded), slugs, names, URLs
- `supabase/migrations/20260620000000_resolution_schema.sql` — `maplify.resolve_collection` precedence, `maplify.collection_rule` seed
- `supabase/migrations/20260620000100_resolution_backfill.sql` — Phase 11 `collection_id` backfill UPDATEs; confirms `maplify.sightings.contributor_id` stays NULL (D-13)
- `supabase/migrations/20250903172708_initial_schema.sql` lines 201-217 — `maplify.sightings` schema: `comments varchar(2000)`, `trusted boolean NOT NULL`, `usernm`, `source`
- `scripts/dwca/fields.ts` — exact 25-entry OCCURRENCE_FIELDS array with ordinals and termUris
- `scripts/dwca/fields.test.ts` — test expectations for length, dcterms positions {19,22}, column-name list
- `scripts/dwca/meta-xml.ts` — pure-function buildMetaXml, emits field count = occFields.length + mmFields.length
- `scripts/dwca/meta-xml.test.ts` — hardcoded checks for total=31, positions[19] and [22]
- `scripts/dwca/eml.ts` — `buildEml`, `DatasetsRow`, `EmlInput`, hardcoded org prose at lines 130-142
- `scripts/dwca/eml.test.ts` — mock DatasetsRow with v1.2 title; tests for methods paragraphs, coverage
- `scripts/dwca/guard.ts` — `ROW_FLOOR = 1000`, `COUNT(*) FROM pgdb.dwc.occurrences`
- `scripts/dwca/guard.test.ts` — mock-based tests, no hardcoded row counts
- `scripts/dwca/assertions.ts` — `assertFieldAlignment` implementation (position-by-position diff)
- `scripts/dwca/build.ts` — full 22-step pipeline; DuckDB ATTACH; `TAB_COLLAPSE_COLS` set
- `.planning/phases/11-resolution-backfill/maplify_census.tsv` — confirmed prod census: 6,832 total rows, collection slug mapping
- `occurrence-bodies.tsv` — 169-row prod sample of occurrence body/comments; parenthetical census
- `.planning/phases/12-dwc-view-rebuild/12-CONTEXT.md` — all locked decisions D-01 through D-11
- `https://rs.gbif.org/schema/eml-gbif-profile/1.1/eml-gbif-profile.xsd` — `agentWithRoleType` definition for `<associatedParty>`

### Secondary (MEDIUM confidence)

- `supabase/snippets/11_resolution_assertions.sql` — established assertion snippet pattern (DO $$ blocks, RAISE EXCEPTION on failure, PROD-ONLY sections)
- `supabase/snippets/05_dwc_assertions.sql` — Phase 5 assertion pattern (ALIGN-01..06 shape)

### Tertiary (LOW confidence)

- Proposed recordedBy regex — ASSUMED; requires D-03 prod census before finalization
- Trusted row count estimate — ASSUMED; requires prod census

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing stack fully read from source
- Architecture (view rebuild): HIGH — exact column order/casts verified from migration source
- institutionCode ordinal: HIGH — derived from existing array + DwC namespace convention
- recordedBy regex: LOW — sample from 169 rows; D-03 census against 6,800+ rows is mandatory before commit
- EML associatedParty structure: MEDIUM — verified from XSD schema; exact placement order confirmed by EML 2.1.1 sequence rule
- Pitfalls: HIGH — derived from code reading + Postgres documentation

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable tech stack; migration schema is locked by Phase 11)
