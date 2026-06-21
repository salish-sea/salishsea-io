# Phase 13: Verification & GBIF Re-validation — Research

**Researched:** 2026-06-21
**Domain:** GBIF DwC-A validation, EML metadata, DwC field-contract extension, artifact-level verification
**Confidence:** HIGH — grounded in direct API probing, live prod-DB queries, and the actual repo source files.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Run the GBIF validator via its REST API — automate submission + poll. Fallback: manual browser upload to gbif.org/tools/data-validator if the API proves unworkable.
- **D-02:** Validate + spot-check a **fresh local build** against prod DB (not the nightly cron). A local build is representative; SC#1/SC#2/SC#3/SC#4 run against the built `occurrence.txt`/`eml.xml`.
- **D-03:** Fill out the **existing single contact** (Peter Abrahamsen) fully — name, email, and whichever sub-elements GBIF flags as incomplete. Do NOT add a separate org-level contact unless research shows GBIF requires it.
- **D-04:** Derive `coordinateUncertaintyInMeters` **honestly where possible, NULL elsewhere**. No fabricated constant. Consequence accepted: the GBIF warning may only partially clear.
- **D-05:** Add `coordinateUncertaintyInMeters` as an **isolated, gated field-contract PR**: `fields.ts` → migration → meta.xml → GeoParquet column set → round-trip tests. `npm test` green BEFORE the GBIF validation run.
- **D-06:** Inline remediation — if the checklist or validator surfaces a defect, fix it in Phase 13 and re-verify. Phase 13 closes only when everything is green.

### Claude's Discretion

- Exact ordering/structure of the checklist run (which queries hit prod DB via `npx supabase db query --linked` vs. parse the built artifact).
- Whether to extend `scripts/dwca/verify-publish.ts` vs. add a new verification script for artifact-level assertions.

### Deferred Ideas (OUT OF SCOPE)

- `coordinateUncertaintyInMeters` full coverage — per-channel constant / methodological floor.
- Seeded-local-DB pre-prod build gate.
- Cross-provider `contributor_links` unification.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ATTR-05 | The regenerated archive passes the GBIF DwC-A validator with no blocking/structural errors and no attribution regressions (field-list ↔ view ↔ meta.xml parity intact, `npm test` green) | D-01 (validator API confirmed), D-05 (field-contract gate), checklist verification queries documented below |
</phase_requirements>

---

## Summary

Phase 13 has two sequenced strands. Strand A is a **field-contract change** (adding `coordinateUncertaintyInMeters` to `fields.ts`, migration, and tests) that must land with `npm test` green before the archive is re-built. Strand B is the **verification pass**: run the 12-item "Looks Done But Isn't" checklist (DB-side SQL queries via `npx supabase db query --linked`, plus artifact-level assertions against the built `occurrence.txt`/`eml.xml`), then submit the archive to the GBIF validator REST API and assert `indexeable: true` with zero `RESOURCE_INTEGRITY` or `RESOURCE_STRUCTURE` category issues.

The two warning fixes (EML contacts, `coordinateUncertaintyInMeters`) are non-blocking additions — the GBIF "can be indexed" gate is driven by `indexeable: true` in the API response, which is not affected by `METADATA_CONTENT` category issues like `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`.

Key facts discovered by research: (1) the GBIF validator REST API exists at `POST https://api.gbif.org/v1/validation` and requires HTTP Basic Auth with a GBIF account; (2) `coordinateUncertaintyInMeters` is already in `fields.ts` at index 14 and already in the Phase 12 views — the Maplify branch emits `NULL::integer`, the native branch emits `NULLIF(o.accuracy, 0)::integer`; but `o.accuracy` is NULL for all 436 prod native rows, so both channels currently emit NULL; (3) the migration change for D-04 is in the Maplify branch only — derive from decimal-place precision in the DuckDB COPY projection, not a new SQL view column.

**Primary recommendation:** Run the checklist first (pure reads, no risk), then do the `coordinateUncertaintyInMeters` + EML contact fixes as a single gated PR with `npm test` green, then do the local build + validator run in one wave.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GBIF validator submission | CLI script (local) | — | Runs against a locally-built zip; no server-side component needed |
| Checklist DB-side queries | Prod DB (read-only) | — | `npx supabase db query --linked`; no app tier involved |
| Checklist artifact-side assertions | File system (local) | — | Parse `dist/dwca/occurrence.txt` and `eml.xml` after `npm run build:dwca` |
| `coordinateUncertaintyInMeters` derivation | DwC view (SQL) / DuckDB COPY | — | Depends on approach chosen (see §Architecture Patterns) |
| EML contact enrichment | `scripts/dwca/eml.ts` | `eml.test.ts` | Isolated to the EML builder — no migration needed |
| Archive build | `scripts/dwca/build.ts` + DuckDB | Prod DB (read-only) | Existing pipeline; `SUPABASE_DB_URL` env var required |

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `npx supabase db query --linked` | Current Supabase CLI | Read-only prod SQL | No DB_PASSWORD needed; uses keychain token; outputs JSON |
| `npm run build:dwca` (`tsx scripts/dwca/build.ts`) | — | Produce local archive | Established pipeline; deterministic from prod DB |
| GBIF Validator REST API | v1 | Archive validation | D-01 locked; endpoint confirmed live |
| `vitest` | configured in `vitest.config.ts` | Test runner | Project standard (`npm test`) |

### Supporting

| Tool | Purpose |
|------|---------|
| `jq` | Parse `npx supabase db query` JSON output in checklist shell steps |
| `node:readline` / `node:fs` | Parse `occurrence.txt` TSV for artifact-level SC checks |

### Package Legitimacy Audit

No new packages are installed in this phase. All tooling is pre-existing.

---

## Architecture Patterns

### System Architecture Diagram

```
Prod DB (read-only)
    │
    ├──[npx supabase db query --linked]──▶ Checklist DB queries (12 items)
    │                                         Outputs JSON → jq assertions
    │
    └──[SUPABASE_DB_URL + DuckDB ATTACH]──▶ npm run build:dwca
                                               │
                                               ▼
                                          dist/dwca/
                                          ├── occurrence.txt   ◀── artifact SC checks
                                          ├── eml.xml          ◀── artifact SC checks
                                          ├── meta.xml
                                          └── salishsea-occurrences-v1.zip
                                                    │
                                                    ▼
                                     POST https://api.gbif.org/v1/validation
                                      (Basic auth: GBIF account)
                                                    │
                                                    ▼
                                     GET https://api.gbif.org/v1/validation/{key}
                                      (poll until complete)
                                                    │
                                                    ▼
                                     Assert: indexeable === true
                                     Assert: no RESOURCE_INTEGRITY or RESOURCE_STRUCTURE issues
```

### Recommended Project Structure

No new directories needed. Verification script goes in `scripts/dwca/`:

```
scripts/dwca/
├── build.ts           # existing — invoked by npm run build:dwca
├── verify-artifact.ts # NEW (or extend verify-publish.ts) — SC#2/SC#3 artifact checks
├── validate-gbif.ts   # NEW — GBIF REST API submit + poll + assert
├── fields.ts          # MODIFIED — coordinateUncertaintyInMeters already at index 14
├── eml.ts             # MODIFIED — add position/organization to contact block (D-03)
└── eml.test.ts        # MODIFIED — add assertions for new contact sub-elements
```

---

## Pattern 1: GBIF Validator REST API (D-01)

**What:** `POST https://api.gbif.org/v1/validation` (multipart/form-data, `file` field) submits a DwC-A zip. Returns a validation key (UUID). `GET https://api.gbif.org/v1/validation/{key}` polls for results.

**Authentication:** HTTP Basic Auth with a GBIF.org account (username:password). The 401 response on probe with invalid credentials confirms auth is required. [VERIFIED: direct API probe, 2026-06-21]

**Submit:**
```bash
# Source: direct API probe — POST https://api.gbif.org/v1/validation (2026-06-21)
curl -u "$GBIF_USER:$GBIF_PASS" \
  -F "file=@dist/dwca/salishsea-occurrences-v1.zip;type=application/zip" \
  https://api.gbif.org/v1/validation
# Returns: {"key": "<uuid>"}  (assumed — pattern from README + portal source)
```

**Poll:**
```bash
# GET /v1/validation/{key} — poll until state != RUNNING/QUEUED
curl -u "$GBIF_USER:$GBIF_PASS" \
  https://api.gbif.org/v1/validation/{key}
```

**Result JSON structure** [VERIFIED: github.com/gbif/gbif-data-validator/blob/master/doc/api.md]:
```json
{
  "indexeable": true,
  "fileName": "salishsea-occurrences-v1.zip",
  "fileFormat": "dwca",
  "validationProfile": "GBIF_INDEXING_PROFILE",
  "results": [
    {
      "fileType": "CORE",
      "rowType": "http://rs.tdwg.org/dwc/terms/Occurrence",
      "numberOfLines": 4413,
      "issues": [
        {
          "issue": "TAXON_MATCH_FUZZY",
          "issueCategory": "OCC_INTERPRETATION_BASED",
          "count": 42
        }
      ]
    },
    {
      "fileType": "METADATA",
      "issues": [
        {
          "issue": "RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE",
          "issueCategory": "METADATA_CONTENT"
        }
      ]
    }
  ]
}
```

**Asserting SC#1 ("zero blocking/structural errors"):**

The `indexeable` boolean is the primary gate. Blocking issue categories that prevent indexing are `RESOURCE_INTEGRITY` and `RESOURCE_STRUCTURE`. The `METADATA_CONTENT` and `OCC_INTERPRETATION_BASED` categories are non-blocking warnings. [VERIFIED: github.com/gbif/gbif-data-validator/blob/master/doc/evaluation_types.md + portal16/locales/translations]

**Programmatic assertion:**
```typescript
// Source: api.md — "Is the provided resource indexeable by GBIF?"
const result = await fetchValidationResult(key);
assert(result.indexeable === true, "GBIF validator: not indexeable");

const blockingCategories = new Set(["RESOURCE_INTEGRITY", "RESOURCE_STRUCTURE"]);
const blockingIssues = result.results.flatMap(r =>
  (r.issues ?? []).filter(i => blockingCategories.has(i.issueCategory))
);
assert(blockingIssues.length === 0, `Blocking issues: ${JSON.stringify(blockingIssues)}`);
```

**Known reliability note:** The GBIF validator service was offline on 2026-06-19 (STATE.md / pending todo). The manual fallback remains: upload `dist/dwca/salishsea-occurrences-v1.zip` at `https://www.gbif.org/tools/data-validator`. [ASSUMED — service uptime history based on STATE.md record]

**Environment needed:** A GBIF.org account (free registration). The user's credentials should be stored as env vars `GBIF_USER` / `GBIF_PASS` (not committed). The project has no existing GBIF credential management.

---

## Pattern 2: The 12-Item Checklist — Execution Map

Each checklist item from `PITFALLS.md §"Looks Done But Isn't"` is mapped to its execution mechanism and the exact command. Items 1–2 are out of scope for Phase 13 (they concern the Maplify backfill, not the DwC view). The active items for Phase 13 are:

| # | Checklist Item | Scope | Execution |
|---|---------------|-------|-----------|
| 3 | SRC-01 invariant: `COUNT(*) FROM dwc.occurrences` ≤ native + Maplify | Prod DB | `npx supabase db query --linked` |
| 4 | `institutionCode` uniformity: DISTINCT returns exactly `{'SalishSea'}` | Prod DB | `npx supabase db query --linked` |
| 5 | `rightsHolder` uniformity: DISTINCT returns exactly `{'SalishSea.io'}` | Prod DB | `npx supabase db query --linked` |
| 6 | `datasetName` per-collection: DISTINCT returns ~10+ values, all prefixed `SalishSea.io — ` | Prod DB | `npx supabase db query --linked` |
| 7 | `fields.ts` column count = view column count (26) | In-source + build | `npm test` (fields.test.ts) + `npm run build:dwca` (F-02 alignment guard) |
| 8 | Trailing "Submitted by" not parsed as contributor: no `contributor_id` set from Trusted Observer lines | N/A — Phase 11 / out of scope | Skip (Maplify contributor_id is NULL by Phase 11 lock D-14) |
| 9 | `comments` column unchanged | N/A — Phase 12/13 never writes `maplify.sightings.comments` | Skip (Phase 13 is read-only on DB except migrations) |
| 10 | No `occurrenceID` prefixed `'inaturalist:'` or `'happywhale:'` in exported rows | **Artifact** (`occurrence.txt`) | Parse `occurrence.txt` column 0; `grep -P "^(inaturalist\|happywhale):"` must return 0 matches |
| 11 | RLS/grants: reference tables accessible | Prod DB | Superseded — `providers`/`organizations`/`collections` have explicit SELECT grants per Phase 9 migration |
| 12 | New FKs don't break Maplify ingest | N/A in Phase 13 (no new FKs added this phase) | Skip |

**Additional SC checks from ROADMAP.md not in PITFALLS.md checklist:**

| SC | Check | Execution |
|----|-------|-----------|
| SC#2 | `occurrence.txt` has no `occurrenceID` prefixed `inaturalist:` or `happywhale:` | Artifact parse |
| SC#3 | Spot-check: Maplify rows carry `datasetName = "SalishSea.io — ..."`, `institutionCode = "SalishSea"`, `rightsHolder = "SalishSea.io"`, `recordedBy` as human name or NULL | Artifact parse (sample) |
| SC#4 | EML `<title>` = `SalishSea.io Cetacean Occurrences (v1.3)` | Artifact parse (`eml.xml`) or `eml.test.ts` (already asserts this) |

**DB-side query templates:**

```sql
-- SRC-01 (item 3)
SELECT COUNT(*) FROM dwc.occurrences;
SELECT COUNT(*) FROM public.observations;
SELECT COUNT(*) FROM maplify.sightings
  WHERE trusted AND NOT is_test AND number_sighted BETWEEN 1 AND 1000 AND source != 'rwsas';
-- Assert: dwc count <= obs count + maplify count

-- institutionCode (item 4)
SELECT DISTINCT "institutionCode" FROM dwc.occurrences;
-- Assert: exactly one row, value = 'SalishSea'

-- rightsHolder (item 5)
SELECT DISTINCT "rightsHolder" FROM dwc.occurrences;
-- Assert: exactly one row, value = 'SalishSea.io'

-- datasetName (item 6)
SELECT DISTINCT "datasetName" FROM dwc.occurrences ORDER BY 1;
-- Assert: all values start with 'SalishSea.io — '

-- occurrenceID prefix scan (SC#2, item 10) — DB-side version
SELECT COUNT(*) FROM dwc.occurrences
  WHERE "occurrenceID" LIKE 'inaturalist:%' OR "occurrenceID" LIKE 'happywhale:%';
-- Assert: 0
```

**Artifact-side assertions (`occurrence.txt`):**

The file is tab-delimited with a header line. `occurrenceID` is column index 0 (per `fields.ts`). `institutionCode` is index 19, `rightsHolder` is index 20, `datasetName` is index 21, `recordedBy` is index 18.

```bash
# SC#2: no iNat/HappyWhale occurrenceIDs in the built artifact
awk -F'\t' 'NR>1 && ($1 ~ /^inaturalist:/ || $1 ~ /^happywhale:/)' dist/dwca/occurrence.txt | wc -l
# Assert: 0

# SC#3: spot-check institutionCode, rightsHolder, datasetName on a Maplify row
grep "^maplify:" dist/dwca/occurrence.txt | head -5 | \
  awk -F'\t' '{print "institutionCode=" $20 " rightsHolder=" $21 " datasetName=" $22}'
```

**Note on column indices in `occurrence.txt`:** the header row lists column names. Use the `fields.ts` array order (0-indexed) plus 1 for awk `$N` (1-indexed). Better: write a small Node script that reads the header to build a name→index map, then asserts values by name. Extend `scripts/dwca/verify-publish.ts` or create `scripts/dwca/verify-artifact.ts`.

---

## Pattern 3: EML Resource Contacts Fix (D-03)

**What GBIF flags:** `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE` is in the `METADATA_CONTENT` category (non-blocking warning). [VERIFIED: github.com/gbif/portal16/blob/master/locales/translations/ru/components/validation.json]

**Current `eml.ts` contact block:**
```xml
<contact>
  <individualName>
    <givenName>Peter</givenName>
    <surName>Abrahamsen</surName>
  </individualName>
  <organizationName>SalishSea.io</organizationName>
  <electronicMailAddress>rainhead@gmail.com</electronicMailAddress>
</contact>
```

The existing contact has `individualName` (givenName + surName), `organizationName`, and `electronicMailAddress`. This appears to be complete per GBIF's minimum requirements (name + email). The warning may be triggered by missing `positionName` or `address` sub-elements. [ASSUMED — the exact triggering sub-element requires seeing the actual validator output; the current contact looks complete per the guidance researched]

**Research finding:** GBIF's minimum for a contact is a name (individual or position) and an email address. The current contact has all of these. The warning may be a false positive that clears when the current archive is re-submitted, OR it may require adding `<positionName>` (e.g., "Data Manager") alongside the individual name. [ASSUMED — needs the actual validator output to confirm]

**D-03 approach:** Run the validator on the current built archive first (before any EML changes), capture the actual warning message, then add whatever sub-element it specifies. The fix is a one-liner addition to the contact block in `eml.ts`. No new test needed unless a new sub-element is added.

**If `<positionName>` is needed:**
```xml
<!-- Source: GBIF IPT Manual — gbif.org/manual/ipt/latest/gbif-metadata-profile -->
<contact>
  <individualName>
    <givenName>Peter</givenName>
    <surName>Abrahamsen</surName>
  </individualName>
  <organizationName>SalishSea.io</organizationName>
  <positionName>Data Manager</positionName>
  <electronicMailAddress>rainhead@gmail.com</electronicMailAddress>
</contact>
```

---

## Pattern 4: coordinateUncertaintyInMeters Honest Derivation (D-04)

### Current State (prod)

- `fields.ts` already has `coordinateUncertaintyInMeters` at **index 14** with `termUri: 'http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters'`. [VERIFIED: fields.ts line 63]
- Phase 12 migration already emits the column in both branches:
  - Native (`dwc._native_occurrences`): `NULLIF(o.accuracy, 0)::integer` — but `public.observations.accuracy` is **NULL for all 436 prod rows** (verified by live DB query). So native rows → all NULL. [VERIFIED: live DB query 2026-06-21]
  - Maplify (`dwc._maplify_occurrences`): `NULL::integer` (hardcoded). [VERIFIED: migration `20260621000000_dwc_view_rebuild.sql` line 151]
- `fields.test.ts` already expects `coordinateUncertaintyInMeters` at index 14 and `OCCURRENCE_FIELDS.length === 26`. [VERIFIED: fields.test.ts]

**Conclusion: the field-contract change from D-05 is ALREADY DONE in Phase 12.** The `fields.ts` entry, the view column, and the test are already in place. The only change needed for D-04 is the **value derivation** in the Maplify branch.

### Coordinate Precision Reality (from prod data)

Live query against `dwc.occurrences` (2026-06-21) shows:

| Decimal places (lat) | Count | Channel | Uncertainty at 48°N |
|----------------------|-------|---------|---------------------|
| 2 | 7 | Maplify (human-rounded) | ~1,111 m |
| 4 | 601 | Maplify (human-rounded) | ~11 m (longitude ~7.8 m) |
| 6 | 3,266 | Native (GPS) | ~0.11 m (sub-meter) |
| 7+ | 539 | Native (GPS) | <0.01 m (GPS inherent precision) |

**Precision → meters conversion at ~48°N** [VERIFIED: wiki.openstreetmap.org/wiki/Precision_of_coordinates]:
- Latitude: 1 decimal place = 11,112 m, each additional place ÷ 10
- Longitude at 48°N: multiply by cos(48°) ≈ 0.669; a 4dp longitude uncertainty is ~7.8 m
- For circular uncertainty (larger of lat/lng error): at 4dp, lat precision = 11.1 m dominates

**DwC standard formula:** The `coordinateUncertaintyInMeters` is "the smallest circle containing the whole of the Location." For a rounded-to-N-decimal-places coordinate, the radius is half the grid cell diagonal. At 4dp and 48°N: lat grid = 11.1 m, lng grid = 7.8 m → diagonal ≈ 13.6 m → radius ≈ 6.8 m. Rounding up to next order-of-magnitude: **11 m** is a defensible value for 4dp. [ASSUMED — the "half cell diagonal" formula is standard georeferencing practice; the exact value requires choosing a convention. Using 111.32 × cos(lat) × 0.001 / 2 × √2 ≈ 7.8 m for 4dp at 48°N is a reasonable floor. Rounding to 10 m is common practice.]

**D-04 approach options:**

**Option A: DuckDB COPY projection (no SQL migration needed):**
Add a computed column in `build.ts`'s COPY SELECT clause for the Maplify branch. This is NOT possible because DuckDB COPYs from `pgdb.dwc.occurrences` as a whole — there is no per-branch SELECT at COPY time. The view already emits `NULL::integer` for the Maplify `coordinateUncertaintyInMeters` column.

**Option B: SQL migration (add derivation to `dwc._maplify_occurrences` view):**
Replace `NULL::integer AS "coordinateUncertaintyInMeters"` with a derived expression. The location is stored as a PostGIS geography in `s.location`. Extract lat/lng as floats, count decimal places in the text representation, map to meters.

```sql
-- Source: standard decimal-degree precision formula, verified via OpenStreetMap wiki
-- At 48°N: 4 decimal places → ~11 m lat uncertainty; use the lat uncertainty (larger)
-- Count decimal places from the text representation of ST_Y (latitude).
-- Cast to text, split on '.', measure trailing length. Watch for trailing zeros:
-- PostGIS stores geography at full precision; decimal-place count from text is reliable.
CASE
  WHEN LENGTH(SPLIT_PART(gis.ST_Y(s.location::gis.geometry)::numeric::text, '.', 2)) <= 2
    THEN 1111
  WHEN LENGTH(SPLIT_PART(gis.ST_Y(s.location::gis.geometry)::numeric::text, '.', 2)) <= 4
    THEN 11
  ELSE NULL  -- >4 dp: GPS-precision or unknown; NULL is honest (see note below)
END::integer AS "coordinateUncertaintyInMeters"
```

**Trailing-zero concern:** PostGIS stores geography coordinates at double-precision float. When cast to text, `48.5500` may become `48.55` (trailing zero dropped by numeric→text). This collapses a 4dp coordinate to apparent 2dp — over-estimating uncertainty. **Mitigation:** use `::numeric::text` (not `::float8::text`) which preserves significant figures for values entered with explicit precision. Alternatively, cast the float to `numeric(10, 4)` to normalize Maplify rows that were entered at 4dp. **This ambiguity means the decimal-place approach is NOT reliably detectable for Maplify.** [ASSUMED — this behavior of PostgreSQL numeric text casting needs to be verified against actual prod values in a SQL test before committing]

**D-04 honest conclusion (updated by prod data):**
- Native rows: `o.accuracy` is NULL for all 436 prod rows. The existing `NULLIF(o.accuracy, 0)::integer` already emits NULL. No change needed.
- Maplify rows: all 4,442 trusted-filtered rows currently emit NULL. Derivation from decimal places is possible for the ~601 rows that appear to be at 4dp, but the trailing-zero stripping problem makes it unreliable without additional checks.
- **Recommended D-04 approach:** Given the trailing-zero ambiguity and D-04's "honest derivation, NULL where not derivable" policy, the safest move is to **leave both branches as NULL** and note this as the honest finding. The GBIF warning (`COORDINATE_UNCERTAINTY_METERS_INVALID` or similar) is non-blocking. The planner may choose to either (a) keep NULL and accept the warning, or (b) add the decimal-place derivation with an explicit `::numeric(15,7)` cast to preserve trailing zeros — but this needs a prod data census first.
- **If the planner chooses to add derivation:** it is a SQL migration change to `dwc._maplify_occurrences` only, NOT a `fields.ts` change (field already in place). The migration is low-risk (read-only view change). The `npm test` gate still needs to pass (no test changes needed unless the test checks specific values).

---

## Pattern 5: Build Mechanics

**Command:** `npm run build:dwca` (invokes `tsx scripts/dwca/build.ts`)

**Required env:** `SUPABASE_DB_URL` — the Postgres DSN for prod DB (not stored in any checked-in env file; must be set in the shell). [VERIFIED: build.ts line 132]

**Obtaining `SUPABASE_DB_URL` for prod:** Per project memory, use the IPv4 session pooler: `postgresql://postgres.<ref>@aws-1-us-west-1.pooler.supabase.com:5432/postgres` where `<ref>` is the Supabase project ref (`grztmjpzamcxlzecmqca`). The DB_PASSWORD must be provided. Alternatively, `npx supabase db query --linked` is fine for the DB-side checklist queries but does NOT provide the DSN that `build.ts` needs for DuckDB ATTACH — `build:dwca` needs `SUPABASE_DB_URL` set directly.

**Output files:**
```
dist/dwca/
├── salishsea-occurrences-v1.zip      # submitted to GBIF validator
├── salishsea-occurrences-v1.parquet  # GeoParquet sidecar
├── occurrence.txt                    # tab-delimited, 26-col header, UTF-8 no BOM
├── multimedia.txt                    # GBIF Simple Multimedia extension
└── (guard-diff.txt only if guard trips)
```

**F-02 alignment guard:** `build.ts` runs `assertFieldAlignment` at step 6/7, comparing `OCCURRENCE_FIELDS` against `DESCRIBE pgdb.dwc.occurrences`. This will catch any column-count or order mismatch before the COPY.

**Static guard:** `build-queries.test.ts` verifies all Postgres refs in `build.ts` are `pgdb`-qualified. This runs as part of `npm test` (no DB needed).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parse occurrence.txt by column name | Custom index-lookup logic | Read header line, build `Map<name, index>` from `OCCURRENCE_FIELDS` in fields.ts | OCCURRENCE_FIELDS is already the canonical ordered contract |
| Detect blocking vs warning GBIF issues | Category heuristics from string matching | Check `issueCategory` field: `RESOURCE_INTEGRITY` or `RESOURCE_STRUCTURE` = blocking | These categories are enumerated in the gbif-data-validator doc |
| Coordinate precision conversion | Roll your own degrees→meters math | Use the OSM table: 4dp lat ≈ 11 m, 2dp lat ≈ 1111 m | Well-established; cite osm wiki |
| GBIF validator polling loop | Long sleep intervals | 5–10 second poll with timeout (~5 min cap); the archive is small and validation is typically fast | |

---

## Common Pitfalls

### Pitfall 1: `coordinateUncertaintyInMeters` field-contract change is NOT needed
**What goes wrong:** Treating D-05 as a new fields.ts addition when it's already complete.
**Root cause:** Phase 12 already added `coordinateUncertaintyInMeters` at index 14 in `fields.ts`, the migration, and the test.
**How to avoid:** Confirm by reading `fields.ts` — the entry is there. D-05 in CONTEXT.md was written before Phase 12 landed the column. The remaining D-04 work is only the Maplify value derivation (SQL migration) — NOT a fields.ts change.

### Pitfall 2: Trailing-zero stripping makes decimal-place counting unreliable
**What goes wrong:** `48.5500` stored as float8 becomes `48.55` in PostgreSQL's `::text` cast, collapsing 4dp to apparent 2dp.
**Root cause:** IEEE 754 float-to-text conversions strip trailing zeros.
**How to avoid:** Before committing a decimal-place-counting expression, run a prod census: `SELECT gis.ST_Y(s.location::gis.geometry)::text, COUNT(*) FROM maplify.sightings WHERE trusted GROUP BY 1 LIMIT 20` to verify whether trailing zeros are present in the actual stored data.
**Warning signs:** The derivation returns `1111` (2dp class) for rows that visually look like 4dp values.

### Pitfall 3: GBIF validator authentication failure
**What goes wrong:** The validator API returns 401 or 403; the validation script fails.
**Root cause:** GBIF Basic Auth uses a GBIF.org account — different from Supabase credentials. The project has no existing GBIF credential management.
**How to avoid:** Register or use an existing GBIF.org account. Store credentials in `GBIF_USER`/`GBIF_PASS` env vars. Do NOT commit them. Have the manual fallback (browser upload) ready.

### Pitfall 4: GBIF validator service offline (known prior failure)
**What goes wrong:** The validator service was offline on 2026-06-19 (STATE.md). It may be intermittently unavailable.
**How to avoid:** If the API returns a non-2xx after retries, switch to the manual browser fallback at `https://www.gbif.org/tools/data-validator`. The validation result is still documentable (screenshot + manual SC#1 assertion).

### Pitfall 5: Confusing `METADATA_CONTENT` warnings with blocking errors
**What goes wrong:** The plan treats `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE` or `COORDINATE_UNCERTAINTY_METERS_INVALID` as blocking SC#1 failures.
**Root cause:** The `indexeable` field in the result JSON is the correct gate, not the presence of any issues at all.
**How to avoid:** SC#1 = `result.indexeable === true` AND zero `RESOURCE_INTEGRITY` or `RESOURCE_STRUCTURE` issues. `METADATA_CONTENT` and `OCC_INTERPRETATION_BASED` issues do NOT prevent indexing.

### Pitfall 6: Artifact-level column index off-by-one
**What goes wrong:** `occurrence.txt` is tab-delimited with a header; `awk $N` is 1-indexed; `OCCURRENCE_FIELDS[i]` is 0-indexed. Confusing these gives wrong column values.
**How to avoid:** Write the artifact parser in Node (read header line, build name→index map). Avoid raw awk column-number references.

---

## Runtime State Inventory

Not applicable. This phase is read-only on the prod DB (checklist queries via `npx supabase db query --linked`) plus one optional SQL migration for `coordinateUncertaintyInMeters` value derivation (view-only, no data written to source tables). No stored data renames, no live service config changes, no OS-registered state.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `tsx` | `npm run build:dwca` | ✓ | per package.json | — |
| `SUPABASE_DB_URL` | DuckDB ATTACH in build.ts | Must be set manually | — | Use `npx supabase db query` for read-only queries; build needs DSN |
| `npx supabase db query --linked` | DB-side checklist queries | ✓ | Current Supabase CLI | — |
| GBIF account (GBIF_USER / GBIF_PASS) | Validator API submission | Unknown — must create/locate | — | Manual browser upload at gbif.org/tools/data-validator |
| `jq` | JSON parse in shell steps | ✓ (macOS with Homebrew) | [ASSUMED] | Use Node script instead |

**Missing dependencies with no fallback:**
- `SUPABASE_DB_URL` for `npm run build:dwca` — this is the prod Postgres DSN. The user must assemble it from the pooler address in project memory.

**Missing dependencies with fallback:**
- GBIF credentials — manual browser upload is the documented fallback (D-01).

---

## Validation Architecture

Nyquist validation is ENABLED (config.json `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --reporter=verbose scripts/dwca/` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ATTR-05 | `OCCURRENCE_FIELDS.length === 26` with `coordinateUncertaintyInMeters` at index 14 | unit | `npm test -- scripts/dwca/fields.test.ts` | ✅ |
| ATTR-05 | `coordinateUncertaintyInMeters` `termUri` is correct DwC URI | unit | `npm test -- scripts/dwca/fields.test.ts` | ✅ |
| ATTR-05 | EML contact block includes name, org, email (+ new sub-elements if added) | unit | `npm test -- scripts/dwca/eml.test.ts` | ✅ (extend if new sub-elements) |
| ATTR-05 | `meta.xml` emits 26 fields in correct ordinal order | unit | `npm test -- scripts/dwca/meta-xml.test.ts` | ✅ |
| ATTR-05 | `build.ts` has no unqualified Postgres refs | static | `npm test -- scripts/dwca/build-queries.test.ts` | ✅ |
| ATTR-05 | No `occurrenceID` prefixed `inaturalist:` or `happywhale:` in artifact | smoke/artifact | `npm run build:dwca && node scripts/dwca/verify-artifact.ts` | ❌ Wave 0 |
| ATTR-05 | `institutionCode`, `rightsHolder`, `datasetName` correct in artifact | smoke/artifact | `npm run build:dwca && node scripts/dwca/verify-artifact.ts` | ❌ Wave 0 |
| ATTR-05 | GBIF validator returns `indexeable: true` with zero blocking issues | integration | `node scripts/dwca/validate-gbif.ts` (needs GBIF creds) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + GBIF validator green before close

### Wave 0 Gaps

- [ ] `scripts/dwca/verify-artifact.ts` — SC#2/SC#3 artifact-level assertions (occurrenceID prefix scan, attribution spot-check, EML title check)
- [ ] `scripts/dwca/validate-gbif.ts` — GBIF REST API submit + poll + assert (or extend verify-publish.ts)
- [ ] `eml.test.ts` — may need new assertions if `<positionName>` or other sub-elements are added (after validator output determines what's needed)

---

## Security Domain

`security_enforcement` is not set to false in config.json, so this section is included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | Partial | API response parsing: validate `indexeable` field type; don't trust issue category strings blindly |
| V6 Cryptography | No | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| GBIF credentials in env file accidentally committed | Information disclosure | Use `.env` (gitignored) or shell env; assert `GBIF_USER`/`GBIF_PASS` not present in any committed file |
| `SUPABASE_DB_URL` (prod DSN) in env | Information disclosure | Already handled by `build.ts` maskDsn; never log the DSN |
| EML XML injection via `xmlEsc` bypass | Tampering | Already mitigated: `buildEml` applies `xmlEsc` to all free-text values. No new vectors from adding `<positionName>` (it's a hardcoded literal). |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual browser upload to GBIF validator | REST API submit + poll (D-01) | Phase 13 | Automatable; assertable in CI |
| `rightsHolder = contributor name` (per-person) | `rightsHolder = 'SalishSea.io'` (constant) | Phase 12 | ATTR-01 compliance |
| `datasetName = 'SalishSea.io Cetacean Occurrences (v1.2)'` | Per-collection `'SalishSea.io — {collection}'` | Phase 12 | ATTR-02 compliance |
| 25-column DwC archive | 26-column (+ `institutionCode`) | Phase 12 | ATTR-01 compliance |
| `coordinateUncertaintyInMeters` = `NULLIF(o.accuracy, 0)` (native) | Same, but `o.accuracy` is NULL for all prod rows | Unchanged | D-04 honest-null policy already met for native branch |

**Deprecated/outdated:**
- v1.2 archive: `dwc.datasets.title = 'SalishSea.io Cetacean Occurrences (v1.2)'` — bumped to v1.3 by Phase 12 migration `20260621000000_dwc_view_rebuild.sql` Step 5.
- gbif-data-validator GitHub repo (archived 2022): the REST API at `api.gbif.org/v1/validation` is the current interface; the old Java validator is superseded.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The GBIF validator returns a JSON body with `"key"` on POST, then `GET /v1/validation/{key}` returns the full result JSON | Pattern 1: GBIF API | Script fails at poll step; fallback to manual upload |
| A2 | D-05 field-contract change is already done by Phase 12 (coordinateUncertaintyInMeters at index 14 in fields.ts) | Pattern 4 | Incorrect — but fields.ts was directly read and confirms the entry [this is actually VERIFIED, not assumed] |
| A3 | `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE` is triggered by the EML contact lacking a sub-element that the current contact block already has, making the warning potentially a false positive on the existing archive | Pattern 3 | The contact fix may need more sub-elements than expected; validator output will clarify |
| A4 | PostGIS stores Maplify geography coordinates and when cast to `numeric::text`, trailing zeros are stripped (4dp stored as float8 → `48.55` not `48.5500`) | Pattern 4 | Decimal-place derivation approach might over-state uncertainty for some rows |
| A5 | GBIF validator service will be available (it was offline 2026-06-19) | Pattern 1 | Use manual fallback |
| A6 | `jq` is available on the user's macOS system | Environment Availability | Use Node script instead for JSON parsing |

---

## Open Questions (RESOLVED)

1. **Does D-04 require a SQL migration?**
   - What we know: `coordinateUncertaintyInMeters` column is already in the view (Phase 12), emitting NULL for both channels. `o.accuracy` is NULL for all native prod rows. Maplify has no accuracy column.
   - What's unclear: Whether the planner chooses to add decimal-place derivation to the Maplify branch view, or accept NULL for all rows.
   - **RESOLVED (per D-03/D-04/D-06):** Run the validator FIRST and gate the optional Maplify derivation on actual validator output. NULL is the honest default (D-04: derive honestly where possible, NULL elsewhere; the GBIF coordinate-uncertainty warning is non-blocking and may only partially clear — accepted). The decimal-place derivation is DEFERRED by default (CONTEXT.md deferred list) and is only opted into in Plan 13-03 Task 3 — gated-last, after a prod trailing-zero census — if the operator chooses partial credit at the Task 2 human-verify checkpoint (D-06 inline remediation). No redundant field-contract task is created: the field already shipped Phase 12 at index 14.

2. **What exactly does the validator flag for `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`?**
   - What we know: The current EML contact has individual name + org + email — appears to meet minimum GBIF requirements.
   - What's unclear: Whether the validator flags this on the Phase 12 archive at all.
   - **RESOLVED (per D-03/D-06):** Do NOT speculatively edit the EML contact. Plan 13-03 Task 1 runs the validator on the un-remediated archive and captures the actual warning set; the Task 2 human-verify checkpoint reviews it; only if `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE` actually fires does Task 3 add the single named sub-element to `eml.ts` + a matching `eml.test.ts` assertion (D-03 metadata-only fix, D-06 inline remediation). If the warning is absent, the contact already meets GBIF minimums and no edit is made.

3. **Is a GBIF account already registered for SalishSea.io?**
   - What we know: The validator requires Basic Auth with a GBIF account. No GBIF credentials are in any project env file.
   - **RESOLVED (per D-01):** Captured as `user_setup` in Plans 13-02 and 13-03 — `GBIF_USER` / `GBIF_PASS` env vars sourced from a free GBIF.org account (gbif.org/user/profile). The documented fallback (D-01) is manual browser upload at gbif.org/tools/data-validator if the API is unworkable/offline; `validate-gbif.ts` `main()` prints this fallback when credentials are absent or the API returns non-2xx after retries. No separate "confirm credentials" task is needed — execute-plan surfaces the `user_setup` block.

---

## Sources

### Primary (HIGH confidence)
- `scripts/dwca/fields.ts` — OCCURRENCE_FIELDS array, coordinateUncertaintyInMeters at index 14 [VERIFIED: read directly]
- `scripts/dwca/eml.ts` — buildEml contact block [VERIFIED: read directly]
- `scripts/dwca/build.ts` — build pipeline, SUPABASE_DB_URL requirement [VERIFIED: read directly]
- `supabase/migrations/20260621000000_dwc_view_rebuild.sql` — Phase 12 view with NULL::integer for coordinateUncertaintyInMeters on Maplify [VERIFIED: read directly]
- Direct API probes to `api.gbif.org/v1/validation` — confirmed: POST endpoint exists, accepts multipart/form-data `file` param, requires Basic Auth [VERIFIED: curl 2026-06-21]
- `github.com/gbif/gbif-data-validator/blob/master/doc/api.md` — result JSON schema including `indexeable` field and issue structures [VERIFIED: curl raw 2026-06-21]
- `github.com/gbif/gbif-data-validator/blob/master/doc/evaluation_types.md` — evaluation type categories (RESOURCE_INTEGRITY, RESOURCE_STRUCTURE, METADATA_CONTENT, OCC_INTERPRETATION_BASED) [VERIFIED: curl raw 2026-06-21]
- `github.com/gbif/portal16/blob/master/locales/translations/ru/components/validation.json` — `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE` confirmed in METADATA_CONTENT category [VERIFIED: curl raw 2026-06-21]
- Live prod DB queries via `npx supabase db query --linked` — accuracy column NULL for all 436 native rows; decimal-place distribution in dwc.occurrences [VERIFIED: 2026-06-21]
- `wiki.openstreetmap.org/wiki/Precision_of_coordinates` — decimal-places-to-meters conversion table [CITED]

### Secondary (MEDIUM confidence)
- `ipt.gbif.org/manual/en/ipt/latest/gbif-metadata-profile` — EML contact sub-elements (individual name, org, email required minimum) [CITED]
- `github.com/gbif/gbif-data-validator/blob/master/README.md` — architecture confirms POST-then-poll pattern [CITED]

### Tertiary (LOW confidence)
- GBIF Community Forum (2019): "there is no API for the data validator" — this was true at that time but is now superseded by the current `api.gbif.org/v1/validation` endpoint [LOW — old source, superseded by direct probe]

---

## Metadata

**Confidence breakdown:**
- GBIF API endpoint and response schema: HIGH — confirmed by direct curl probes
- coordinateUncertaintyInMeters status: HIGH — fields.ts and migration read directly; prod DB queried
- EML contact fix details: MEDIUM — current contact looks complete; exact validator trigger unknown until first run
- Issue category severity (blocking vs warning): HIGH — evaluation_types.md and portal16 translations confirmed
- Decimal-place to meters conversion: MEDIUM — OSM wiki table verified; trailing-zero behavior is ASSUMED

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (stable domain; GBIF API endpoint stable)

---

## RESEARCH COMPLETE

Phase 13 research is complete. The key findings are:

1. **`coordinateUncertaintyInMeters` is already in the field contract** (Phase 12 placed it at index 14). D-05 as written in CONTEXT.md is already done. The remaining D-04 work is only whether to add a value-derivation expression to the Maplify view branch — or to leave both channels NULL (which is honest given the data).

2. **GBIF validator REST API is confirmed live** at `POST https://api.gbif.org/v1/validation` with multipart file upload and HTTP Basic Auth (GBIF.org account). The result JSON `indexeable` boolean is the SC#1 gate. Blocking issues are `RESOURCE_INTEGRITY` and `RESOURCE_STRUCTURE` categories only; `METADATA_CONTENT` (which includes `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`) is non-blocking.

3. **The 12-item PITFALLS.md checklist**, filtered for Phase 13 scope, maps cleanly to: (a) 5 prod-DB read-only SQL queries via `npx supabase db query --linked`, (b) 2 artifact-level parses of `dist/dwca/occurrence.txt`, and (c) 1 EML XML check (`eml.test.ts` already asserts the title).

4. **Two new scripts are needed**: `scripts/dwca/verify-artifact.ts` (SC#2/SC#3 artifact assertions) and `scripts/dwca/validate-gbif.ts` (D-01 API submit/poll/assert), or the planner may extend `verify-publish.ts`.

5. **EML contact enrichment (D-03)** should be deferred until after the first validator run to see what sub-element is actually missing — the current contact block looks complete per GBIF minimum requirements.
