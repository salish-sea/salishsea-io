---
status: complete
phase: 04-rights-data-model-policy-gate
source: [04-VERIFICATION.md]
started: 2026-06-10T18:16:59Z
updated: 2026-06-17T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Document completeness — Sections 1-2 quality for Phase 5 encoding
expected: Sections 1 and 2 of 04-POLICY.md provide clear, actionable, complete instructions for Phase 5 SQL encoding without requiring re-decision — the two-part D-08 consent basis, contributor-identity-as-rightsHolder acceptance, and the dynamicProperties schema are unambiguous.
result: issue
reported: "§1.2 and §1.4 document NULL and 'none' as semantically identical exclusion cases instead of flagging the redundancy. Confirmed via migrations: license_code was originally NOT NULL, a later migration did DROP NOT NULL, and several projection paths now write explicit NULL. Phase 5 should not have to encode a compound 'IS NULL OR = none' branch in its CASE. Either: (a) collapse at the data-model layer — backfill NULL → 'none', restore NOT NULL, default 'none'; or (b) give NULL a distinct meaning of 'unknown' (not 'no license') and define its handling separately. Current treatment of NULL as a silent alias for 'none' is the structural defect."
severity: minor

### 2. Section 4 conferral question quality
expected: Each per-org conferral question (Whale Alert/Conserve.IO, Orca Network, Cascadia Research) accurately names the data pathway, requests the specific permission needed, and never implies permission has already been granted ("no prohibition = permission" absent).
result: pass

### 3. Section 3 gap audit completeness
expected: Every gap from 04-RESEARCH.md's Data-Model Gap Audit appears in Section 3 with an explicit resolution or an explicit cross-reference (GAP-04 exclusions → Sections 1.4/2.4); none silently defaulted.
result: pass

## Summary

total: 3
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "§1.1 / §2.2 / §4.2 correctly encode the license basis for Maplify (Conserve.IO / Whale Alert) records."
  status: resolved
  resolution: "2026-06-17 — D-20 added to 04-POLICY.md. Per-record license is per-source: native = CC-BY-NC 4.0, Maplify = CC-BY 4.0 (upstream assertion at Acartia cooperative, acartia.io/register). §1.1 split, §2.2 license rule added, §3.1/§3.2 gap tables updated, §4 rewritten — conferral questions reframed as courtesy notifications, D-05 hold preserved but reframed as data-QA gate (primary) + courtesy window (secondary). D-02/D-03/D-04/D-05 annotated as reframed by D-20."
  reason: "User reported: Per https://acartia.io/register, data contributed as part of the Acartia data cooperative (all data coming via conserve.io) are licensed CC BY."
  severity: major
  test: 1
  artifacts:
    - .planning/phases/04-rights-data-model-policy-gate/04-POLICY.md (§1.1, §2.2, §3.1, §3.2, §4.1, §4.2, §4.3, §4.4, §4.5, D-20)
  missing: []

- truth: "§1.2 and §1.4 give Phase 5 a single, non-compound rule for license-less photo exclusion."
  status: resolved
  resolution: "2026-06-17 — D-19 added to 04-POLICY.md: NULL and 'none' are now documented as semantically distinct ('none' = 'no license, terminal'; NULL = 'unknown, non-terminal'). Both excluded in v1.2. Phase 5 emits separate CASE branches preserving the distinction (not the originally proposed collapse). §1.2, §1.4, §3.3 updated; §3.3 also corrected to reference observation_photos (post-rename) and nullable license_code."
  reason: "User confirmed: NULL and 'none' are documented as semantically identical exclusion cases without flagging the redundancy. license_code was originally NOT NULL; a later migration dropped NOT NULL; projection paths now write explicit NULL. Resolution should be either (a) collapse at the data-model layer — backfill NULL → 'none', restore NOT NULL, default 'none' — so Phase 5's CASE has one exclusion branch; or (b) redefine NULL to mean 'unknown' (distinct from 'no license') with explicit handling. Current silent-alias treatment is the defect."
  severity: minor
  test: 1
  artifacts:
    - .planning/phases/04-rights-data-model-policy-gate/04-POLICY.md (§1.2, §1.4, §3.3, D-19)
  missing: []
