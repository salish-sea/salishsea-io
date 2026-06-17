---
phase: 5
slug: db-projection-dwc-schema
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-17
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `05-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Plain SQL `psql` assertions against the local Supabase database. No JS/Python test runner — this is a migration-only phase. |
| **Config file** | None new. Connection: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (per `supabase/config.toml`). |
| **Quick run command** | `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/snippets/05_dwc_assertions.sql` |
| **Full suite command** | Same — single assertion script. |
| **Estimated runtime** | ~30 seconds (db reset + assertion run on local DB) |

---

## Sampling Rate

- **After every task commit:** Run the quick command (above).
- **After every plan wave:** Same.
- **Before `/gsd-verify-work`:** Same — must exit 0.
- **Max feedback latency:** ~30 seconds.

The assertion script uses `\set ON_ERROR_STOP on` + `DO $$ BEGIN IF (assertion fails) THEN RAISE EXCEPTION END $$;` per requirement. `psql` exit code 0 = green, non-zero = red.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Behavior | Test Type | Automated Command (assertion within `05_dwc_assertions.sql`) | File Exists | Status |
|---------|------|------|-------------|----------|-----------|-------------------------------------------------------------|-------------|--------|
| 05-04-T2 | 05-04 | 0 | infra | `supabase/snippets/05_dwc_assertions.sql` scaffolding | wave-0 | (the script itself) | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-01 | 05-04 | 1 | ALIGN-01 | `dwc.occurrences` returns native + Maplify only | smoke | `SELECT split_part("occurrenceID",':',1) AS prefix FROM dwc.occurrences GROUP BY 1;` — expect `{salishsea, maplify}` exactly | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-02 | 05-04 | 1 | ALIGN-02 | 4 GBIF-required terms NOT NULL on every row | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "occurrenceID" IS NULL OR "basisOfRecord" IS NULL OR "scientificName" IS NULL OR "eventDate" IS NULL;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-03a | 05-04 | 1 | ALIGN-03 | Higher-rank taxon emits no fabricated binomial | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "taxonRank" IN ('family','subfamily','superfamily','order','class','phylum','kingdom') AND "genus" IS NOT NULL;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-03b | 05-04 | 1 | ALIGN-03 | `taxonRank` populated for every row | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "taxonRank" IS NULL;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-04a | 05-04 | 1 | ALIGN-04 | Lat/lon range sanity | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "decimalLatitude" NOT BETWEEN -90 AND 90 OR "decimalLongitude" NOT BETWEEN -180 AND 180;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-04b | 05-04 | 1 | ALIGN-04 | Known Salish Sea point lands at ~48°N, ~-123°W (axis sanity) | assertion | nearest-point by `ABS(lat-48.5)+ABS(lon+123)` lands in `lat 47..50, lon -125..-122` | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-04c | 05-04 | 1 | ALIGN-04 | `coordinateUncertaintyInMeters` is never 0 | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "coordinateUncertaintyInMeters" = 0;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-04d | 05-04 | 1 | ALIGN-04 | `geodeticDatum` always `WGS84` | assertion | `SELECT COUNT(DISTINCT "geodeticDatum") FROM dwc.occurrences;` — expect ≤ 1 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-05a | 05-04 | 1 | ALIGN-05 | Maplify `eventDate` is date-precision only (no `T`) | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "occurrenceID" LIKE 'maplify:%' AND "eventDate" LIKE '%T%';` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-05b | 05-04 | 1 | ALIGN-05 | Native `eventDate` includes time component (`T`) | assertion | `SELECT COUNT(*) FROM dwc.occurrences WHERE "occurrenceID" LIKE 'salishsea:%' AND "eventDate" NOT LIKE '%T%';` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-ALIGN-06 | 05-04 | 1 | ALIGN-06 | `occurrenceID` unique across all rows | assertion | `SELECT COUNT(*) FROM (SELECT "occurrenceID" FROM dwc.occurrences GROUP BY 1 HAVING COUNT(*) > 1) dup;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-M05a | 05-04 | 1 | M-05 contract | `taxa_classification` genus is NULL for family-and-above taxa | assertion | `SELECT COUNT(*) FROM dwc.taxa_classification tc JOIN inaturalist.taxa t ON t.id = tc.taxon_id WHERE t.rank IN ('family','subfamily','superfamily','order','class','phylum','kingdom') AND tc.genus IS NOT NULL;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-M05b | 05-04 | 1 | M-05 contract | `taxa_classification` one row per taxon | assertion | counts of `dwc.taxa_classification` and `inaturalist.taxa` must match | ✅ | ⬜ pending DB run |
| 05-04-T4-POL-1.4 | 05-04 | 1 | POLICY §1.4 | `dwc.multimedia` excludes `none`/NULL license rows | assertion | `SELECT COUNT(*) FROM dwc.multimedia WHERE "license" IS NULL;` — expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-DWCA-03 | 05-04 | 1 | DWCA-03 readiness | Every `dwc.multimedia.coreId` is in `dwc.occurrences` | assertion | left-join anti-join expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-D15-16 | 05-04 | 1 | D-15/D-16 wiring | `dwc.occurrences.datasetID` matches `dwc.datasets.dataset_id` | assertion | left-join anti-join expect 0 | ✅ | ⬜ pending DB run |
| 05-04-T4-D20 | 05-04 | 1 | D-20 / §1.1 | `license` is a subset of the two canonical legalcode URIs | assertion | `array_agg(DISTINCT "license")` ⊆ `{CC-BY-NC .../legalcode, CC-BY .../legalcode}` | ✅ | ⬜ pending DB run |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Task ID format:** `05-04-T{task#}[-{requirement-ID}]`. The harness file exists (Task 2 / `05-04-T2`) and every assertion block is encoded. Each assertion's runtime status is `⬜ pending DB run` — flip to ✅ after the assertion suite exits 0 against a populated local DB (Task 4).

---

## Wave 0 Requirements

- [ ] `supabase/snippets/05_dwc_assertions.sql` — assertion script (`\set ON_ERROR_STOP on` + one `DO $$ BEGIN IF (…) THEN RAISE EXCEPTION '<req-id>: <reason>' END IF; END $$;` block per row in the verification map above, each labeled with its requirement ID).
- [ ] (Optional) `supabase/snippets/README.md` line noting `05_dwc_assertions.sql` is the Phase 5 verification harness.
- [ ] No framework install — `psql` ships with Supabase CLI.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `maplify.source` distinct values match the encoded display-name mapping | POLICY §2.2 Assumption A2 | Requires production-data shape; local fixture may not exhaustively cover real values. | After projection works locally, run `SELECT DISTINCT source FROM maplify.sightings;` against production (via supabase CLI or psql with prod connection). Confirm each value has a CASE arm in the Maplify branch. |
| `rwsas` is excluded at ingest | POLICY §5.3 | Requires inspecting production data. | `SELECT COUNT(*) FROM maplify.sightings WHERE source = 'rwsas';` against production. If 0, the Maplify-branch filter is belt-and-suspenders; if >0, the filter is load-bearing. |
| GBIF DwC-A validator pass | DWCA-05 | Phase 6's job (archive generator must exist first). | Out of Phase 5 scope. |

---

## Validation Sign-Off

- [x] All tasks have an automated verify command in the table OR a Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers the assertion-script scaffold (committed in plan 05-04 task 2)
- [x] No watch-mode flags (`psql -f` is single-shot)
- [x] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter after the planner fills task IDs — **pending DB run**

**Approval:** task IDs filled by plan 05-04 task 5 on 2026-06-17. **Assertion run deferred** — local Supabase DB unavailable at execution time (Docker daemon not running; port 54322 closed). `nyquist_compliant` stays `false` until the assertion suite has actually exited 0 against a populated local DB.

**To complete validation (user-runnable):**

```bash
supabase db reset                                       # apply all migrations + seed
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -v ON_ERROR_STOP=1 -f supabase/snippets/05_dwc_assertions.sql
echo "exit code: $?"                                    # expect 0
```

On exit 0, edit this file's frontmatter to `nyquist_compliant: true` + `wave_0_complete: true` and update **Approval** to `auto-approved by plan 05-04 task 4 — psql exit 0 on YYYY-MM-DD`.
