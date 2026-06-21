# Phase 13 Verification Checklist

**Date:** 2026-06-21
**Executed by:** Plan 13-01 Task 2
**Method:** All queries run read-only via `npx supabase db query --linked` (Management API + keychain token, no DB_PASSWORD, no writes)
**Discipline:** No UPDATE/INSERT/DELETE/ALTER statements issued; `comments` column never touched.

This file records the 11 read-only prod-DB checklist queries from `.planning/research/PITFALLS.md §"Looks Done But Isn't Checklist"`:
- 5 active Phase-13 SC checks (items 3/4/5/6/10)
- 6 prior-phase confirmation queries (items 1/2/8/9/11/12) — each recorded PASS with a "verified by Phase N" evidence note

---

## Active Phase-13 Checks (5)

### Check 1 — SRC-01 Invariant (PITFALLS item 3)

**Purpose:** dwc.occurrences count must not exceed native + Maplify trusted row counts (iNat/HappyWhale are excluded by construction and must not leak in).

**Queries and results:**

```sql
SELECT COUNT(*) as dwc_count FROM dwc.occurrences;
-- Result: 4413

SELECT COUNT(*) as obs_count FROM public.observations;
-- Result: 436

SELECT COUNT(*) as maplify_count FROM maplify.sightings
  WHERE trusted AND NOT is_test AND number_sighted BETWEEN 1 AND 1000 AND source != 'rwsas';
-- Result: 4442
```

**Assertion:** dwc_count (4413) ≤ obs_count (436) + maplify_count (4442) = 4878

**Result:** 4413 ≤ 4878 — **PASS**

| Column | Value |
|--------|-------|
| dwc.occurrences | 4413 |
| public.observations | 436 |
| maplify.sightings (trusted) | 4442 |
| Total native + Maplify | 4878 |

---

### Check 2 — institutionCode Uniformity (PITFALLS item 4)

**Purpose:** All exported rows must carry `institutionCode='SalishSea'` — no upstream org codes should leak here.

**Query:**

```sql
SELECT DISTINCT "institutionCode" FROM dwc.occurrences;
```

**Result:**

| institutionCode |
|-----------------|
| SalishSea |

**Assertion:** Exactly one row, value = 'SalishSea'

**Result:** PASS — exactly `{'SalishSea'}`

---

### Check 3 — rightsHolder Uniformity (PITFALLS item 5)

**Purpose:** All exported rows must carry `rightsHolder='SalishSea.io'` — not contributor names or org names.

**Query:**

```sql
SELECT DISTINCT "rightsHolder" FROM dwc.occurrences;
```

**Result:**

| rightsHolder |
|--------------|
| SalishSea.io |

**Assertion:** Exactly one row, value = 'SalishSea.io'

**Result:** PASS — exactly `{'SalishSea.io'}`

---

### Check 4 — datasetName Per-Collection (PITFALLS item 6)

**Purpose:** All exported rows must have a datasetName starting with `'SalishSea.io — '`, with ≥10 distinct values (one per collection).

**Query:**

```sql
SELECT DISTINCT "datasetName" FROM dwc.occurrences ORDER BY 1;
```

**Result (19 distinct values):**

| datasetName |
|-------------|
| SalishSea.io — Bremerton FB group |
| SalishSea.io — Cascadia Research Collective |
| SalishSea.io — CWW |
| SalishSea.io — HIWS |
| SalishSea.io — MCW |
| SalishSea.io — Monterey Bay Aquarium Research Institute |
| SalishSea.io — Orca Network |
| SalishSea.io — Orcasound |
| SalishSea.io — PSWS |
| SalishSea.io — PSWW |
| SalishSea.io — SA |
| SalishSea.io — SalishSea.io Direct |
| SalishSea.io — SBW |
| SalishSea.io — SSCH |
| SalishSea.io — The Marine Mammal Center |
| SalishSea.io — Whale Alert |
| SalishSea.io — Whale Alert (Alaska) |
| SalishSea.io — Whale Alert (Global) |
| SalishSea.io — WSSJI |

**Assertion:** ≥10 distinct values AND every value begins with `'SalishSea.io — '`

**Result:** 19 distinct values, all prefixed `'SalishSea.io — '` — **PASS**

---

### Check 5 — occurrenceID Prefix Scan (PITFALLS item 10 / SC#2 DB-side)

**Purpose:** No exported occurrence must have an occurrenceID prefixed `'inaturalist:'` or `'happywhale:'` (iNat/HappyWhale self-publish to GBIF; inclusion would cause GBIF duplication).

**Query:**

```sql
SELECT COUNT(*) as bad_count FROM dwc.occurrences
  WHERE "occurrenceID" LIKE 'inaturalist:%' OR "occurrenceID" LIKE 'happywhale:%';
```

**Result:**

| bad_count |
|-----------|
| 0 |

**Assertion:** 0

**Result:** PASS — zero excluded occurrenceIDs in the export

---

## Prior-Phase Confirmation Queries (6)

These six items were delivered in earlier phases (9/10/11/12). Phase 13 re-confirms them read-only, recording actual query results and "verified by Phase N" evidence notes so that all 12 PITFALLS "Looks Done But Isn't" items are green. A FAIL here would be flagged as a defect for Plan 13-03 inline remediation (D-06) — no remediation was performed here.

---

### Confirmation 1 — Backfill Completeness (PITFALLS item 1, Phase 11)

**Query:**

```sql
SELECT COUNT(*) AS unresolved FROM maplify.sightings
  WHERE comments ~ '^\[' AND collection_id IS NULL;
```

**Result:**

| unresolved |
|------------|
| 0 |

**Assertion:** 0 (all bracket-tagged rows resolved to a collection)

**Result:** PASS — verified by Phase 11 (Maplify bracket-tag backfill complete; zero unresolved bracket-tagged rows)

---

### Confirmation 2 — Trailing-Attribution Completeness (PITFALLS item 2, Phase 11)

**Query:**

```sql
SELECT COUNT(*) AS unresolved FROM maplify.sightings
  WHERE comments ~ 'Trusted Observer' AND collection_id IS NULL;
```

**Result:**

| unresolved |
|------------|
| 0 |

**Assertion:** 0 (all Trusted Observer rows resolved)

**Result:** PASS — verified by Phase 11 (trailing-attribution backfill complete; zero unresolved Trusted Observer rows)

---

### Confirmation 3 — "Submitted by" Not Parsed as Contributor (PITFALLS item 8, Phase 11)

**Query:**

```sql
SELECT COUNT(*) AS leaked FROM maplify.sightings
  WHERE contributor_id IS NOT NULL AND comments ~ 'Trusted Observer';
```

**Result:**

| leaked |
|--------|
| 0 |

**Assertion:** 0 (Trusted Observer lines are collection/org signals, not contributor identities)

**Result:** PASS — verified by Phase 11 (D-14 lock: Maplify contributor_id is NULL by design; "Trusted Observer" lines were never parsed as contributor identities)

---

### Confirmation 4 — comments Immutability (PITFALLS item 9, Phase 11/12)

**Query:**

```sql
SELECT COUNT(*) AS tagged FROM maplify.sightings WHERE comments ~ '^\[';
```

**Result:**

| tagged |
|--------|
| 2354 |

**Assertion:** Count is non-zero and matches the Phase-11 backfill baseline — audit-trail tags (bracket-prefixed comments) are still present; no destructive UPDATE on `comments` has been applied.

**Result:** PASS — 2354 bracket-tagged rows intact — verified by Phase 11/12 (comments column is read-only post-ingestion per design; Phase 13 Plan 01 issued zero UPDATE statements)

---

### Confirmation 5 — RLS/Grants: Reference Tables Accessible (PITFALLS item 11, Phase 9)

**Query:**

```sql
SELECT
  (SELECT COUNT(*) FROM providers) AS providers,
  (SELECT COUNT(*) FROM organizations) AS orgs,
  (SELECT COUNT(*) FROM collections) AS collections;
```

**Result:**

| providers | orgs | collections |
|-----------|------|-------------|
| 4 | 5 | 22 |

**Assertion:** All three > 0 (SELECT grants work; dwc.occurrences JOINs to these tables produce real rows, not empty)

**Result:** PASS — verified by Phase 9 (explicit SELECT grants on `public.providers`, `public.organizations`, `public.collections` added in Phase 9 migration; all three tables accessible and non-empty)

---

### Confirmation 6 — New FKs Don't Break Ingest (PITFALLS item 12, Phase 10)

**Query:**

```sql
SELECT is_nullable FROM information_schema.columns
  WHERE table_schema = 'maplify'
    AND table_name = 'sightings'
    AND column_name = 'collection_id';
```

**Result:**

| is_nullable |
|-------------|
| YES |

**Assertion:** `YES` — `collection_id` is nullable so unmatched Maplify ingest rows still insert without a constraint violation

**Result:** PASS — verified by Phase 10 (nullable `collection_id` added in Phase 10 schema migration; Phase 13 adds no new FKs that could break ingest)

---

## Summary

| # | Checklist Item | Query Result | Verdict |
|---|----------------|--------------|---------|
| 3 | SRC-01 invariant | dwc=4413 ≤ native(436)+maplify(4442)=4878 | **PASS** |
| 4 | institutionCode uniformity | `{'SalishSea'}` (1 distinct value) | **PASS** |
| 5 | rightsHolder uniformity | `{'SalishSea.io'}` (1 distinct value) | **PASS** |
| 6 | datasetName per-collection | 19 distinct values, all `'SalishSea.io — …'` | **PASS** |
| 10 | occurrenceID prefix scan | 0 excluded IDs | **PASS** |
| 1 | Backfill completeness | 0 unresolved bracket-tagged rows | **PASS** (verified by Phase 11) |
| 2 | Trailing-attribution completeness | 0 unresolved Trusted Observer rows | **PASS** (verified by Phase 11) |
| 8 | "Submitted by" not contributor | 0 contributor_id set from Trusted Observer | **PASS** (verified by Phase 11) |
| 9 | comments immutability | 2354 tagged rows intact | **PASS** (verified by Phase 11/12) |
| 11 | RLS/grants | providers=4, orgs=5, collections=22 | **PASS** (verified by Phase 9) |
| 12 | FK ingest safety | collection_id is_nullable=YES | **PASS** (verified by Phase 10) |

**All 11 checklist queries: PASS. All 12 PITFALLS "Looks Done But Isn't" items are green.**

*(PITFALLS item 7 — fields.ts column count — is verified by `npm test` (fields.test.ts), not a DB query. It passes as part of the standard `npm test` gate.)*

---

*No UPDATE, INSERT, DELETE, or ALTER statements were issued. The `maplify.sightings.comments` column was never touched.*
