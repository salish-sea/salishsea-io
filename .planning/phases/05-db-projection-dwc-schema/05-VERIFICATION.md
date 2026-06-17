---
phase: 5
status: passed
score: 5/5
created: 2026-06-17
verified: 2026-06-17T00:00:00Z
verifier: Claude (gsd-verifier, Opus 4.7)
---

# Phase 5: DB Projection — DwC Schema — Verification Report

**Phase Goal (ROADMAP.md):**
A dedicated read-only `dwc` Postgres schema projects in-scope occurrences into DarwinCore-aligned columns, built directly from source tables, encoding the Phase 4 gap decisions as auditable SQL. Leaf dependency that blocks Phases 6–8.

**Verification mode:** Initial (no previous VERIFICATION.md present).

**Deliverable footprint:**
- `supabase/migrations/20260617203900_dwc_schema.sql` (single migration, all 6 views + grants)
- `supabase/snippets/05_dwc_assertions.sql` (17-block psql assertion harness; user-run on 2026-06-17 exited 0 after fix `2fbeb01`)

---

## Goal Achievement

### Observable Truths (mapped from ROADMAP success criteria)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | `dwc.occurrences` returns DarwinCore-aligned rows from source tables (`public.observations`, `maplify.sightings`), never `public.occurrences`; iNaturalist + Whale Alert excluded. | VERIFIED | `dwc.occurrences` defined L517-520 as `SELECT * FROM dwc._native_occurrences UNION ALL SELECT * FROM dwc._maplify_occurrences`. Branch views read `FROM public.observations o` (L303) and `FROM maplify.sightings s` (L465). No active SQL references `public.occurrences` (all 4 occurrences are in `--` comments documenting "not from this table"). iNaturalist + HappyWhale excluded by construction (absent from UNION). Assertion ALIGN-01 (snippets L26-42) verifies source prefixes are subset of `{salishsea, maplify}` — passed in user-run. |
| SC-2 | Every row carries the 4 GBIF-required terms, `occurrenceID` stable + source-prefixed surrogate. | VERIFIED | Native branch L222: `('salishsea:' \|\| o.id::text)::text AS "occurrenceID"`. Maplify branch L366: `('maplify:' \|\| s.id::text)::text AS "occurrenceID"`. Both branches emit constants `'HumanObservation'::text AS "basisOfRecord"`, join `dwc.taxa_classification` for `scientificName`, and emit non-null `eventDate`. Assertions ALIGN-02 (4 terms NOT NULL) and ALIGN-06 (occurrenceID unique) passed in user-run. |
| SC-3 | Recursive walk over `taxa` parent hierarchy fills `taxonRank` + `kingdom..genus`; genus/family rows carry correct `taxonRank` with no fabricated binomial. | VERIFIED | `dwc.taxa_classification` (L85-167) uses `WITH RECURSIVE ancestors` walking `inaturalist.taxa.parent_id` with depth-50 cycle guard. `taxon_rank` populated from leaf's own rank cast (L134). Genus gated by explicit 12-rank IN list (L150-164): NULL for family-and-above. Assertions ALIGN-03a/03b (no fabricated binomial; taxonRank populated) and M-05a/05b (genus NULL for family+; row-count parity with `inaturalist.taxa`) passed in user-run. |
| SC-4 | Spatial terms emit `decimalLatitude`/`decimalLongitude` with correct axis/sign, constant WGS84 `geodeticDatum`, `coordinateUncertaintyInMeters` omitted when unknown (never 0). | VERIFIED | Native L246: `gis.ST_Y(o.subject_location::gis.geometry) AS "decimalLatitude"`; L248 `ST_X(...)` for longitude. Maplify L390/L392 mirror. Both emit `'WGS84'::text AS "geodeticDatum"` (L250, L394). Native L254: `NULLIF(o.accuracy, 0)::integer AS "coordinateUncertaintyInMeters"`. Maplify L397: `NULL::integer` (no source column; never fabricate). Assertions ALIGN-04 range, axis-sanity (Salish Sea bbox), uncertainty-never-0, datum-constant all passed in user-run. |
| SC-5 | ISO-8601 `eventDate` at honest per-source precision — Maplify date-precision only, never false second-level sighting time. | VERIFIED | Native L228: `to_char(o.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::text AS "eventDate"` — Z-suffixed full precision. Maplify L373: `((s.created_at AT TIME ZONE 'GMT')::date)::text AS "eventDate"` — date-only (no `T`). Assertions ALIGN-05a (Maplify no `T`) and ALIGN-05b (native has `T`) both passed in user-run. |

**Score:** 5/5 ROADMAP success criteria verified.

### Required Artifacts (3-level: exists, substantive, wired)

| Artifact | Expected | Exists | Substantive | Wired | Status |
|---|---|---|---|---|---|
| `supabase/migrations/20260617203900_dwc_schema.sql` | schema + 6 views + grants | yes (717 lines) | yes (all 6 `CREATE VIEW dwc.*` present; per-column casts; encoded POLICY §1.1, §1.2, §1.4, §2.1, §2.2, §2.3, §2.4, §3.1, §3.2, §3.3, §4.1, §5.3, §6.x) | yes (referenced by snippet harness; commits applied) | VERIFIED |
| `supabase/snippets/05_dwc_assertions.sql` | psql harness, exit 0 on green | yes (311 lines) | yes (17 DO blocks across ALIGN-01..06, M-05 ×2, POLICY §1.4, DWCA-03, D-15/16, D-20) | yes (exit 0 against local DB on 2026-06-17 per VALIDATION sign-off; commit `2fbeb01` fixed PG14 `array_agg DISTINCT … ORDER BY` syntax) | VERIFIED |

### Six dwc.* Views Inventory

| View | Source | Purpose | Status |
|---|---|---|---|
| `dwc.taxa_classification` | `inaturalist.taxa` | M-05 recursive Linnaean helper; one row per taxon; genus gated by 12-rank list | VERIFIED |
| `dwc._native_occurrences` | `public.observations` + `public.contributors` + helper | Native gap projection (POLICY §3.1) | VERIFIED |
| `dwc._maplify_occurrences` | `maplify.sightings` + helper + LATERAL CASE | Maplify gap projection (POLICY §3.2); rwsas filter unconditional | VERIFIED |
| `dwc.occurrences` | `_native UNION ALL _maplify` | M-02 public surface | VERIFIED |
| `dwc.datasets` | VALUES literal (D-15) | Single-row dataset reification (D-16, D-17, D-18, M-04) | VERIFIED |
| `dwc.multimedia` | `public.observation_photos` (native-only) | GBIF Simple Multimedia ext; D-19 two-branch license CASE | VERIFIED |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `dwc.taxa_classification` | `inaturalist.taxa` | `WITH RECURSIVE` over `parent_id` (L86-111) | WIRED |
| `dwc._native_occurrences` | `public.observations` | `FROM public.observations o` (L303) | WIRED |
| `dwc._native_occurrences` | `public.contributors` | `JOIN c ON c.id = o.contributor_id` (L304) | WIRED |
| `dwc._native_occurrences` | `dwc.taxa_classification` | `JOIN tc ON tc.taxon_id = o.taxon_id` (L305) | WIRED |
| `dwc._maplify_occurrences` | `maplify.sightings` | `FROM maplify.sightings s` (L465) + filter (L490-492) | WIRED |
| `dwc._maplify_occurrences` | `dwc.taxa_classification` | `JOIN tc ON tc.taxon_id = s.taxon_id` (L466) | WIRED |
| `dwc._maplify_occurrences` | LATERAL `dn.display_name` | `CROSS JOIN LATERAL (...) AS dn` (L476-483) — reused in `rightsHolder`, `datasetName`, `aggregatorSource`, `aggregatorChain` | WIRED |
| `dwc.occurrences` | `_native_occurrences ∪ _maplify_occurrences` | `UNION ALL` (L518-520) | WIRED |
| `dwc.multimedia.coreId` | `dwc.occurrences."occurrenceID"` | `'salishsea:' \|\| op.observation_id::text` (L666) — matches native L222 | WIRED (DWCA-03 assertion passed) |
| `dwc.occurrences."datasetID"` | `dwc.datasets.dataset_id` | constant URI `'https://salishsea.io/datasets/occurrences-v1'` (L275, L428, L571) | WIRED (D-15/D-16 assertion passed) |

### Requirements Coverage

| Req ID | Description | Source Plan(s) | Status | Evidence |
|---|---|---|---|---|
| ALIGN-01 | Dedicated `dwc` schema from source tables, native + Maplify only | 05-02, 05-03, 05-04 | SATISFIED | `dwc.occurrences` UNION ALL; no `public.occurrences` reference outside comments; ALIGN-01 assertion passed. REQUIREMENTS.md L23 marked complete. |
| ALIGN-02 | Four GBIF-required terms on every record | 05-02, 05-03, 05-04 | SATISFIED | Both branches emit non-null `occurrenceID`/`basisOfRecord`/`scientificName`/`eventDate`; ALIGN-02 assertion passed. REQUIREMENTS.md L24. |
| ALIGN-03 | Taxonomy walk; correct `taxonRank`; no fabricated binomials | 05-01, 05-04 | SATISFIED | `dwc.taxa_classification` recursive CTE; explicit 12-rank IN list for genus gate (L150-164); ALIGN-03a, ALIGN-03b, M-05a, M-05b assertions passed. REQUIREMENTS.md L25. |
| ALIGN-04 | Lat/lon axis/sign correct, constant WGS84, uncertainty never 0 | 05-02, 05-03, 05-04 | SATISFIED | `ST_Y`/`ST_X` correct axes; constant `'WGS84'`; native `NULLIF(accuracy, 0)`; Maplify `NULL::integer`; 4 ALIGN-04 assertions passed (range, axis-sanity, no-zero, datum-constant). REQUIREMENTS.md L26. |
| ALIGN-05 | ISO-8601 per-source precision; Maplify date-only | 05-02, 05-03, 05-04 | SATISFIED | Native `to_char(...'YYYY-MM-DD"T"HH24:MI:SS"Z"')`; Maplify `((created_at AT TIME ZONE 'GMT')::date)::text`; ALIGN-05a (no `T` on Maplify) and ALIGN-05b (native has `T`) assertions passed. REQUIREMENTS.md L27. |
| ALIGN-06 | Stable deterministic source-prefixed `occurrenceID` | 05-02, 05-03, 05-04 | SATISFIED | Native: `'salishsea:' \|\| o.id::text`; Maplify: `'maplify:' \|\| s.id::text`; cross-source collision impossible by prefix; ALIGN-06 uniqueness assertion passed. REQUIREMENTS.md L28. |

**All 6 ALIGN-0X requirements appear in PLAN frontmatters and are tracked in REQUIREMENTS.md.** No orphaned requirements.

### Auditable Encodings of Phase 4 POLICY (beyond ALIGN)

| POLICY § | Encoding Site | Status |
|---|---|---|
| §1.1 (D-20) native CC-BY-NC | L278 (native `license` constant) | VERIFIED (D-20 assertion passed) |
| §1.1 (D-20) Maplify CC-BY | L432 (Maplify `license` constant) | VERIFIED |
| §1.2 (D-19) photo license CASE | L672-683 (`dwc.multimedia` 7 CC arms + 2 NULL arms) | VERIFIED |
| §1.4 none/NULL multimedia exclusion | L695-696 (WHERE filter) | VERIFIED (POLICY §1.4 assertion passed) |
| §2.1 (D-09) recordedBy = rightsHolder | L266, L269 (both = `c.name`) | VERIFIED |
| §2.2 (D-10/D-11) source mapping LATERAL | L476-483 + reuse at L416, L422, L459, L460 | VERIFIED |
| §2.3 dynamicProperties (native 2-key) | L300 | VERIFIED |
| §2.3 dynamicProperties (Maplify 4-key) | L457-462 | VERIFIED |
| §3.5 (D-13) individualCount bounds | L491 (Maplify WHERE `BETWEEN 1 AND 1000`); native CHECK upstream | VERIFIED |
| §4.1 (D-03) source-drop lever | L494 (commented placeholder) | VERIFIED (encoded as "ready, not active") |
| §5.2 (D-14) no-op | NOT emitted (no `countIsMinimum` key) | VERIFIED |
| §5.3 rwsas defensive filter | L492 (`AND s.source != 'rwsas'`) | VERIFIED |
| §6.2/§6.3 (D-15..D-18) dwc.datasets | L568-611 (single-row VALUES; M-04 email at L579/582/584) | VERIFIED (D-15/D-16 dataset-wiring assertion passed) |
| DWCA-03 coreId/occurrenceID parity | L666 mirrors L222 | VERIFIED (DWCA-03 assertion passed) |

### Anti-Pattern Scan

| File | Pattern checked | Result |
|---|---|---|
| `supabase/migrations/20260617203900_dwc_schema.sql` | `TBD`/`FIXME`/`XXX` | 0 matches |
| `supabase/migrations/20260617203900_dwc_schema.sql` | `TODO`/`HACK`/`PLACEHOLDER` | 0 matches |
| `supabase/snippets/05_dwc_assertions.sql` | `TBD`/`FIXME`/`XXX` | 0 matches |
| `supabase/snippets/05_dwc_assertions.sql` | `TODO`/`HACK`/`PLACEHOLDER` | 0 matches |
| Migration | hardcoded empty data rendered | NONE — every NULL constant is policy-driven (e.g. coordinateUncertaintyInMeters for Maplify per POLICY §3.2 gap; informationWithheld NULL per POLICY §2.4) |
| Comments noting "placeholder" | `abstract`, `methods`, `geographic_coverage`, `temporal_coverage` in `dwc.datasets` | INFO ONLY — POLICY §6.7 explicitly assigns these to Phase 6 authoring; in-scope NULL per plan deliverable |

No blocker- or warning-class anti-patterns found.

### Behavioral Spot-Checks

| Behavior | Mechanism | Result | Status |
|---|---|---|---|
| `dwc` schema + 6 views compile against live DB | `supabase db reset` then `psql -v ON_ERROR_STOP=1 -f supabase/snippets/05_dwc_assertions.sql` | exit 0 on 2026-06-17 (user-run, post-`2fbeb01`) | PASS |
| All 17 contract assertions hold against live data | Same harness, RAISE EXCEPTION on violation | All 17 assertion blocks green | PASS |
| Migration file commit lineage matches user-provided context | `git log` shows commits `58e4233`, `bb62272`, `e1c0047`, `18a93e5` (05-01); `04229bb`, `b88e067`, `19db0b6` (05-02); `f3d046c`, `9a81430`, `2052419` (05-03); `7e73915`, `3302d94`, `83f5fd2`, `63f19f4`, `2fbeb01` (05-04) | All 15 commits present in `main` branch log | PASS |

### Probe Execution

The verifier did not re-execute the psql probe in this session — the user explicitly confirmed it ran with exit 0 on the local Supabase DB on 2026-06-17 after applying the syntax fix in commit `2fbeb01`. VALIDATION.md L88-96 records the user-confirmed sign-off with `nyquist_compliant: true` and `wave_0_complete: true`. Per verifier override convention, treating user-confirmed live-DB run + signed-off VALIDATION as authoritative evidence here; the probe artifact itself (`supabase/snippets/05_dwc_assertions.sql`) was inspected directly and all 17 blocks are well-formed, requirement-labeled, and structurally correct.

| Probe | Command | Result | Status |
|---|---|---|---|
| `supabase/snippets/05_dwc_assertions.sql` | `psql -v ON_ERROR_STOP=1 -f …` | exit 0 (user-confirmed 2026-06-17) | PASS (user-attested) |

### Deviations Noted in SUMMARYs

| Deviation | Plan | Resolution |
|---|---|---|
| 05-04 SUMMARY originally recorded DB run as DEFERRED with `nyquist_compliant: false`. | 05-04 | Resolved 2026-06-17: user ran suite against local DB, fix `2fbeb01` applied for PG14 `array_agg` ordering, suite exited 0, VALIDATION.md flipped to `nyquist_compliant: true` / `wave_0_complete: true`. No remaining work. |
| Discrepancy 1 (table renames) — POLICY §3.1/§3.3 still uses pre-2025-09-15 table names (`public.sightings`); migration uses current names (`public.observations`). | header L25-30 | Documented in-place; current name used; no impact. |
| Discrepancy 2 (D-19 NULL arm unreachable) — `public.observation_photos.license_code` is still NOT NULL so the IS NULL branch of the multimedia license CASE is currently unreachable. | header L32-40, multimedia L680-682 | Encoded for forward-compat with a future `DROP NOT NULL`; both 'none' and NULL excluded by view WHERE; documented; no impact on v1.2 correctness. |

---

## Gaps Summary

None. All five ROADMAP success criteria are observable in the codebase:

- The migration creates exactly the 6 expected `dwc.*` views and sources them from `public.observations` / `maplify.sightings` (never from `public.occurrences`); the comments-only references to `public.occurrences` are explicit "NOT from this" annotations.
- All Phase 4 POLICY encodings (D-09, D-10, D-11, D-13, D-15..D-20, M-02..M-05) are present at expected line ranges.
- The 17-block assertion harness covers ALIGN-01..06, M-05 ×2, POLICY §1.4, DWCA-03 readiness, D-15/D-16 wiring, and D-20, and the user ran it against the populated local DB with exit 0.
- All 6 ALIGN requirement IDs are declared in PLAN frontmatters and tracked in REQUIREMENTS.md.
- No debt markers, no stubs, no unwired artifacts. Multi-plan single-migration discipline held (one file, four plans, six views, parity-enforced UNION).

---

## VERIFICATION PASSED

Phase 5 goal achieved: a read-only `dwc` Postgres schema projects in-scope occurrences into DarwinCore-aligned columns, built directly from source tables, with auditable SQL encoding of every Phase 4 gap decision. Ready to unblock Phases 6–8.

_Verified: 2026-06-17_
_Verifier: Claude (gsd-verifier, Opus 4.7)_
