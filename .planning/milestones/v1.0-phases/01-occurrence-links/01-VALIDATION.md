---
phase: 1
slug: occurrence-links
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD-copy-url | 01 | 1 | LINK-02 | unit | `npx vitest run src/obs-summary.test.ts` | ❌ W0 | ⬜ pending |
| TBD-date-derive | 01 | 1 | LINK-03 | unit | `npx vitest run src/salish-sea.test.ts` | ❌ W0 | ⬜ pending |
| TBD-copy-button | 01 | 1 | LINK-01 | manual | — | N/A | ⬜ pending |
| TBD-map-center | 01 | 1 | LINK-04 | manual | — | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/obs-summary.test.ts` — unit test for URL construction (LINK-02): verifies `buildShareUrl(id)` returns `origin + pathname + ?o=<id>`
- [ ] `src/salish-sea.test.ts` — unit test for date derivation (LINK-03): verifies `observed_at` ISO string → `PlainDate` string via Temporal

*Note: If URL construction and date derivation remain as inline logic inside component methods, they must be extracted to testable pure helpers to enable these unit tests. Planner should include extraction as an explicit task.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Copy button visible in obs-summary header | LINK-01 | Lit shadow DOM / lifecycle not feasible in jsdom | Open app, find an occurrence card, verify copy link icon appears in header |
| Map centers on occurrence location at ~zoom 12 | LINK-04 | OpenLayers rendering not feasible in Vitest/jsdom | Load `?o=<id>` in fresh tab, verify map centers and zooms to occurrence location |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
