---
phase: 13
slug: verification-gbif-re-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — `scripts/dwca/*.test.ts`) |
| **Config file** | repo root (vitest); see `scripts/dwca/*.test.ts` |
| **Quick run command** | `npm test -- scripts/dwca` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~{N} seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- scripts/dwca`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | ATTR-05 | T-13-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/dwca/verify-artifact.ts` — artifact-level assertions (SC#2 occurrenceID-prefix scan, SC#3 attribution spot-check against built `occurrence.txt`)
- [ ] `scripts/dwca/validate-gbif.ts` — GBIF validator API submit + poll + `indexeable`/blocking-category gate (SC#1)
- [ ] Existing `scripts/dwca/*.test.ts` cover the field-contract / EML round-trip assertions

*Existing vitest infrastructure covers the field-contract + EML tests; the two new scripts above are Wave 0 additions.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GBIF validator "can be indexed by GBIF" | ATTR-05 | External service; basic-auth + async job — fallback to manual upload if API unreliable | Submit built zip to GBIF validation API (or gbif.org/tools/data-validator); confirm `indexeable: true` + zero RESOURCE_INTEGRITY/RESOURCE_STRUCTURE issues |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
