---
phase: 4
slug: rights-data-model-policy-gate
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

**This phase writes a policy document, not code.** There is no runtime, schema, or test
infrastructure to exercise. Validation is human review of the produced policy document
(`04-POLICY.md`) against the four ROADMAP success criteria. Nyquist sampling does not apply
to executable behavior here; the table below records the manual verification contract instead.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — documentation phase, no executable artifacts |
| **Config file** | none |
| **Quick run command** | none |
| **Full suite command** | none |
| **Estimated runtime** | n/a |

---

## Sampling Rate

- **After every task commit:** n/a — no automated tests
- **After every plan wave:** n/a
- **Before `/gsd-verify-work`:** Policy document complete and self-consistent (every audited gap has a resolution OR an explicit conferral question)
- **Max feedback latency:** n/a (human review)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (documentation phase) | 01 | 1 | GAP-01..04 | — | N/A | manual | none | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.* No test framework, fixtures, or
stubs are needed — the phase deliverable is a markdown policy document.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Every audited data-model gap (eventDate precision, omit-unknown coordinateUncertainty, per-source basisOfRecord, count/occurrenceStatus, license-less photo exclusion, unvalidated identifier exclusion) has a recorded resolution — none silently defaulted | GAP-01, GAP-03 | Policy decisions, not executable behavior | Read `04-POLICY.md`; confirm each gap from RESEARCH.md appears with an explicit resolution |
| Occurrence license recorded as CC-BY-NC 4.0 resolvable CC URI with native-record/contributor-consent stance documented | GAP-02 | License string + consent stance are prose decisions | Confirm the URI string is exactly `https://creativecommons.org/licenses/by-nc/4.0/legalcode` and the D-08 consent basis is documented |
| Attribution/provenance model specified — which fields carry `recordedBy`, `rightsHolder`, `datasetName`, and the Whale Alert → sub-source provenance chain | GAP-03 | Field-mapping policy, not code | Confirm `04-POLICY.md` specifies the attribution model for native and third-party records (D-09..D-11) |
| Redistribution decision recorded for Whale Alert (Conserve.IO) / Maplify — confirmed permission OR explicit native-only fallback + per-organization conferral questions | GAP-04 | External legal/ToS question; resolution is a documented stance + hold rule | Confirm `04-POLICY.md` records the conferral-question framing (D-04) and the hosted-but-unlinked hold rule (D-05/D-06) |

---

## Validation Sign-Off

- [x] All tasks have manual verification mapped to a success criterion (no automated verify applicable — documentation phase)
- [x] Sampling continuity: n/a (no executable tasks)
- [x] Wave 0 covers all MISSING references (none — no infrastructure needed)
- [x] No watch-mode flags
- [x] Feedback latency: n/a (human review)
- [x] `nyquist_compliant: true` set in frontmatter (documentation phase — manual contract complete)

**Approval:** pending
