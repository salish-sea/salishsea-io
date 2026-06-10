---
phase: 04-rights-data-model-policy-gate
verified: 2026-06-10T18:16:59Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Read Sections 1-2 of 04-POLICY.md against GAP-02/GAP-03 and D-08..D-11 — confirm the two-part D-08 consent basis, the contributor-identity-as-rightsHolder acceptance, and the dynamicProperties schema are complete and unambiguous as a policy instruction to Phase 5."
    expected: "Sections 1 and 2 are clear, actionable, and complete instructions for Phase 5 encoding without requiring re-decision."
    why_human: "Completeness and unambiguity of a documentation artifact cannot be verified by grep; requires reading for authorial intent and Phase 5 usability."
  - test: "Read Section 4 of 04-POLICY.md (Third-Party Redistribution Status) against D-01..D-07 and the RESEARCH redistribution landscape — confirm the conferral questions are precisely and correctly framed for each of Whale Alert/Conserve.IO, Orca Network, and Cascadia Research."
    expected: "Each per-org conferral question accurately names the data pathway and requests the specific permission needed; no permission is asserted or implied."
    why_human: "Legal framing quality and accuracy of the conferral questions require human judgment; grep cannot assess whether a question is precise or adequate."
  - test: "Read Section 3 gap tables and confirm that every audited gap from 04-RESEARCH.md's Data-Model Gap Audit appears with an explicit resolution row — none silently defaulted."
    expected: "Every gap identified in 04-RESEARCH.md is either resolved in Section 3 or explicitly cross-referenced (e.g., GAP-04 exclusion gaps cross-referenced to Sections 1.4 and 2.4)."
    why_human: "Requires cross-reading 04-RESEARCH.md gap audit against Section 3 tables; completeness cannot be verified by grep alone."
---

# Phase 4: Rights & Data-Model Policy Verification Report

**Phase Goal:** Resolve and document all rights/licensing and data-model gap decisions as explicit findings, so the downstream `dwc` views and generator have a single authoritative policy to encode and nothing left to silently fudge.
**Verified:** 2026-06-10T18:16:59Z
**Status:** human_needed (all automated checks pass; human review of document completeness and quality requested)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A reader can find an explicit resolution OR a framed conferral question for every audited data/datatype gap — none is silently defaulted (SC-1) | VERIFIED | Section 3 contains per-source gap tables for `public.sightings`, `maplify.sightings`, and `public.sighting_photos` with explicit resolution for every audited term. License-less photo and unvalidated-identifier exclusions (GAP-04) are documented in Sections 1.4 and 2.4 and cross-referenced from Section 3. No "TBD" or "FIXME" markers found. |
| 2 | The occurrence-record license is recorded as CC-BY-NC 4.0 as the exact resolvable URI `https://creativecommons.org/licenses/by-nc/4.0/legalcode`, plus the native contributor-consent stance (D-08) (SC-2) | VERIFIED | URI appears literally at line 21 (Section 1.1 code block), line 36 (converter table row), line 152, and line 172. D-08 two-part consent basis documented at Section 1.3 (lines 47-53): platform-policy assertion for existing records + submission-form notice going forward. |
| 3 | A reader can find which fields carry `recordedBy`, `rightsHolder`, and dataset/record provenance for native (D-09) and Whale Alert + nested Orca Network / Cascadia sources (D-10/D-11) (SC-3) | VERIFIED | Section 2.1 (D-09): native `rightsHolder` = `contributors.name`, `recordedBy` = same. Section 2.2 (D-10, D-11): third-party `recordedBy` = `usernm`, `datasetName` = sub-source mapping, `rightsHolder` = sub-source-org else "Whale Alert / Maplify". Section 2.3: `dynamicProperties` schema with all five keys defined (travelDirection, aggregatorSource, aggregatorChain, countIsMinimum, unvalidatedIdentifiers). |
| 4 | A reader can find a recorded decision on Whale Alert / Maplify redistribution — the include-and-attribute holding rule (D-02), the hosted-but-unlinked hold (D-05/D-06), and a per-organization conferral question — so generation cannot proceed on an unresolved rights question (SC-4) | VERIFIED | Section 4.1 records D-01 build stance, D-02 include-and-attribute default, D-03 per-source drop granularity, D-05 hosted-but-unlinked hold (suppresses only frontend link), D-06 native-only eligibility, D-07 flagged OPEN for Phase 7/8. Sections 4.2–4.4 record distinct conferral questions for Whale Alert/Conserve.IO (info@whalealert.org), Orca Network, and Cascadia Research. D-07 open question explicitly flagged. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md` | Single authoritative rights & data-model-gap policy, min 150 lines | VERIFIED | 333 lines. Contains all five named sections (`## 1.` through `## 5.`). Contains exact string `https://creativecommons.org/licenses/by-nc/4.0/legalcode`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `04-POLICY.md` | Phase 5 dwc schema (SQL encoding of D-01..D-03, D-09..D-14) | Named decision sections with stable anchors; pattern `occurrenceStatus.*present` | VERIFIED | `occurrenceStatus = present` recorded at lines 151, 171, 187, 325. Section headings `## 1.` through `## 5.` are stable named anchors. Decision Index table at lines 310-327 maps every D-NN to section. |
| `04-POLICY.md` | Phase 7/8 hosting + download link (hold rule D-05/D-06, open D-07 question) | Redistribution Status section with holding rule and flagged open question; pattern `hosted.but.unlinked` | VERIFIED | "Hosted-but-unlinked hold (D-05)" heading at line 215. "unlisted" state documented at line 217. D-07 explicitly flagged OPEN for Phase 7/8 planner at line 221. |

### Data-Flow Trace (Level 4)

Not applicable — documentation-only phase with no runtime or data-rendering artifacts.

### Behavioral Spot-Checks

Step 7b: SKIPPED — documentation-only phase with no runnable entry points.

### Probe Execution

Step 7c: SKIPPED — no probe scripts declared or applicable for a documentation phase.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| GAP-01 | 04-01-PLAN.md | Data and datatype gaps audited and documented as explicit findings (not silently fudged) | SATISFIED | Section 3 gap tables cover all three source tables with per-row resolutions. REQUIREMENTS.md marks GAP-01 Complete. |
| GAP-02 | 04-01-PLAN.md | Occurrence records carry CC-BY-NC 4.0 license and `rightsHolder` as resolvable URIs; per-photo converter | SATISFIED | Section 1.1 records exact legalcode URI. Section 1.2 per-photo converter table covers all 8 enum values. REQUIREMENTS.md marks GAP-02 Complete. |
| GAP-03 | 04-01-PLAN.md | Source attribution and provenance carried into archive (`recordedBy`, dataset provenance for Whale Alert and nested sources) | SATISFIED | Section 2 (2.1–2.4) specifies all attribution fields for native and third-party sources plus `dynamicProperties` schema. REQUIREMENTS.md marks GAP-03 Complete. |
| GAP-04 | 04-01-PLAN.md | Records and fields lacking usable value handled per documented policy — omit-when-unknown, exclude license-less photos, exclude unvalidated identifiers | SATISFIED | Section 1.4 (license-less photo exclusion), Section 2.4 (unvalidated identifier exclusion), Section 3 gap rows for `coordinateUncertaintyInMeters`, `individualCount` sparseness. REQUIREMENTS.md marks GAP-04 Complete. |

All four requirements carry matching status in REQUIREMENTS.md traceability table (Phase 4: GAP-01..04, all "Complete").

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `04-POLICY.md` | 45 | Internal cross-reference says "gap table row for `observation_photos`" but Section 3.3 heading is `public.sighting_photos` | INFO | Stale internal cross-reference uses the older table name from PLAN task text. Section 3.3 itself uses the correct name. Does not affect policy content; cosmetic navigability issue only. |

No `TBD`, `FIXME`, or `XXX` debt markers found. No SQL, app code, schema changes, or migration files were produced — commit `631bf50` modifies exactly one file: `04-POLICY.md`.

### D-NN Citation Completeness

Every decision D-01 through D-14 is cited in `04-POLICY.md`:

| Decision | Cited At |
|----------|---------|
| D-01 | Section 4.1 (line 207), Decision Index (line 312) |
| D-02 | Section 4.1 (line 209), Decision Index (line 313) |
| D-03 | Section 4.1 (line 213), Decision Index (line 314) |
| D-04 | Section 4.2 intro (line 203), Sections 4.2/4.3/4.4 "NOT stated" text, Decision Index (line 317) |
| D-05 | Section 4.1 (line 215), Sections 4.2/4.3/4.4 hold status, Decision Index (line 318) |
| D-06 | Section 4.1 (line 219), Decision Index (line 319) |
| D-07 | Section 4.1 (line 221), Decision Index (line 320) |
| D-08 | Section 1.3 (line 47, 49), Decision Index (line 321) |
| D-09 | Section 2.1 (lines 75, 76), Section 3.1 (line 148), Decision Index (line 322) |
| D-10 | Section 2.2 (lines 84, 85), Section 3.2 (lines 165, 166, 168), Decision Index (line 323) |
| D-11 | Section 2.2 (line 86), Section 3.2 (line 167), Decision Index (line 324) |
| D-12 | Section 3.1 (line 151), Section 3.2 (line 171), Section 3.4 (line 185), Decision Index (line 325) |
| D-13 | Section 3.1 (line 145), Section 3.2 (line 163), Section 3.5 (line 191), Decision Index (line 326) |
| D-14 | Section 2.3 (line 115), Section 3.2 (line 163), Section 5.2 (multiple), Decision Index (line 327) |

All 14 decisions confirmed cited. D-14 correction (CONTEXT.md "maplify `min_count`" inaccuracy) is explicitly documented and self-contained in Section 5.2.

### Acceptance Criteria Audit (All Tasks)

**Task 1 acceptance criteria:**

| Criterion | Status | Evidence |
|-----------|--------|---------|
| `04-POLICY.md` exists with title `# Rights & Data-Model Policy` | PASS | Line 1 |
| Contains exact string `https://creativecommons.org/licenses/by-nc/4.0/legalcode` | PASS | Lines 21, 36, 152, 172 |
| Per-photo converter row for `cc0`, `cc-by`, `cc-by-nc`, `none` with `none` excluded | PASS | Lines 34–41 |
| Native consent basis citing D-08 (platform policy + submission-form notice) | PASS | Section 1.3, lines 47–53 |
| Native `rightsHolder` = individual contributor, `recordedBy` = contributor display name, citing D-09 | PASS | Section 2.1, lines 75–76 |
| Third-party `datasetName` = sub-source, `recordedBy` = `usernm`, `rightsHolder` = sub-source-when-known-else-Whale-Alert/Maplify, citing D-10 and D-11 | PASS | Section 2.2, lines 84–86 |
| `dynamicProperties` schema names keys `travelDirection`, `aggregatorChain`, `unvalidatedIdentifiers` | PASS | Section 2.3, lines 112–116 |
| Regex-extracted identifiers never emitted as `organismID` or `catalogNumber` | PASS | Section 2.4, line 125 |

**Task 2 acceptance criteria:**

| Criterion | Status | Evidence |
|-----------|--------|---------|
| `occurrenceStatus = present` constant column citing D-12 | PASS | Sections 3.1, 3.2, 3.4 |
| `individualCount` emitted only when real count exists, citing D-13 | PASS | Sections 3.1, 3.2, 3.5 |
| `coordinateUncertaintyInMeters` omitted when unknown, never 0 | PASS | Sections 3.1 (line 144), 3.2 (line 162) |
| Maplify `eventDate` at date precision only, referencing ALIGN-05 | PASS | Section 3.2 gap row for `eventDate` (line 160) |
| `basisOfRecord = HumanObservation` and `geodeticDatum = WGS84` as constants | PASS | Sections 3.1 (lines 150, 153), 3.2 (lines 173-174) |
| D-14 min-count no-op, CONTEXT.md wording corrected explicitly | PASS | Section 5.2 (lines 282–296) |
| License-less photo and unvalidated-identifier exclusions as GAP-04 resolutions | PASS | Sections 1.4, 2.4, and Section 3 gap rows |
| Section 5 records HappyWhale and iNaturalist as excluded from v1.2 | PASS | Section 5.1 (lines 275–280) |

**Task 3 acceptance criteria:**

| Criterion | Status | Evidence |
|-----------|--------|---------|
| Distinct conferral question for each of Whale Alert (Conserve.IO), Orca Network, and Cascadia Research | PASS | Sections 4.2, 4.3, 4.4 |
| Names `info@whalealert.org` / Conserve.IO, explicitly distinguishes from `whale-alert.io` crypto tracker | PASS | Section 4.2 (lines 226–227, 233) |
| Hosted-but-unlinked hold citing D-05 (publish to `/dwca/`; suppress only frontend link) | PASS | Section 4.1 (lines 215–217) |
| Include-and-attribute default citing D-02 and per-`maplify.source` drop granularity citing D-03 | PASS | Section 4.1 (lines 209, 213) |
| Native-only public eligibility citing D-06 | PASS | Section 4.1 (line 219) |
| D-07 native-only-variant question flagged OPEN for Phase 7/8 | PASS | Section 4.1 (line 221) |
| Does not assert redistribution permission where none was found | PASS | Sections 4.2–4.4 each state "No redistribution policy found. Hold applies." |

### Human Verification Required

#### 1. Document completeness — Sections 1-2 quality for Phase 5 encoding

**Test:** Read Sections 1 and 2 of `04-POLICY.md` in full against GAP-02/GAP-03 and D-08..D-11 — confirm the two-part D-08 consent basis, the contributor-identity-as-rightsHolder acceptance, and the `dynamicProperties` schema are complete and unambiguous as policy instructions to Phase 5.
**Expected:** Sections 1 and 2 provide clear, actionable, and complete instructions for Phase 5 SQL encoding without requiring re-decision; no ambiguity that would cause Phase 5 to silently choose between alternatives.
**Why human:** Completeness and authorial quality of a documentation artifact cannot be verified by pattern matching; requires reading for Phase 5 usability and intent.

#### 2. Section 4 conferral question quality

**Test:** Read Section 4 (`Third-Party Redistribution Status`) against D-01..D-07 and `04-RESEARCH.md`'s redistribution landscape — confirm the conferral questions for each of Whale Alert/Conserve.IO, Orca Network, and Cascadia Research are precisely and correctly framed.
**Expected:** Each per-org conferral question accurately names the data pathway, requests the specific permission needed, and avoids any implication that permission has already been granted; "no prohibition = permission" pattern is absent.
**Why human:** Legal framing quality and accuracy requires human judgment; grep cannot assess whether a question is adequately precise or legally sound.

#### 3. Section 3 gap audit completeness

**Test:** Cross-read `04-RESEARCH.md` Data-Model Gap Audit section against the Section 3 gap tables — confirm every gap identified in the research appears in Section 3 with an explicit resolution or is explicitly cross-referenced.
**Expected:** No gap from `04-RESEARCH.md` is missing from Section 3; the cross-references to Sections 1.4 and 2.4 for GAP-04 exclusions close those gaps without re-stating them.
**Why human:** Requires side-by-side reading of research and policy; gap omissions are not detectable by grep.

---

## Summary

**04-POLICY.md** is substantive, well-structured, and passes all mechanically verifiable checks:

- The document is 333 lines with all five named sections.
- Every D-01 through D-14 is cited; D-14 correction is self-contained and explicit.
- The exact legalcode URI appears four times; the per-photo converter covers all 8 enum values including `none` (excluded).
- All 23 per-task acceptance criteria pass.
- All four GAP requirements are satisfied per REQUIREMENTS.md traceability.
- The commit that produced this document (`631bf50`) modifies exactly one file; no SQL, app code, schema, or migration was produced.
- One cosmetic INFO issue: line 45 cross-references "observation_photos" (the old table name) while Section 3.3 correctly uses `sighting_photos`. This does not affect policy substance.

Three human review items are requested to confirm document completeness and conferral-question quality — these cannot be resolved by automated checks.

---

_Verified: 2026-06-10T18:16:59Z_
_Verifier: Claude (gsd-verifier)_
