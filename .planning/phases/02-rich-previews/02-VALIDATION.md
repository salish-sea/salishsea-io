---
phase: 2
slug: rich-previews
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-04
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (app) + jest/ts-jest (infra CDK) |
| **Config file** | `vitest.config.ts` (root) / `infra/jest.config.js` |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run && cd infra && npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test -- --run && cd infra && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | PREV-01, PREV-02 | unit stubs | `cd infra && npm test` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | PREV-03 | smoke stubs | `cd infra && npm test` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | PREV-01 | unit | `cd infra && npm test` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | PREV-01 | unit | `cd infra && npm test` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | PREV-02 | unit | `cd infra && npm test` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 1 | PREV-02 | unit | `cd infra && npm test` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | PREV-03 | smoke | `cd infra && npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `infra/lib/edge-handler/index.test.ts` — unit stubs for PREV-01 (bot UA detection) and PREV-02 (OG tag generation, license check, fallback)
- [ ] `infra/test/infra.test.ts` — expand placeholder to assert EdgeFunction and Distribution constructs exist (CDK assertions API)

*All test files are missing — Wave 0 must create them before functional code is written.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bluesky preview card renders in production | PREV-01 | Requires deployed edge function + live crawler | Share a URL in a Bluesky post; confirm card appears with correct title/image |
| RCS/iMessage preview renders | PREV-01 | Platform-specific crawler; cannot simulate locally | Send URL via iMessage on device; confirm link preview shows |
| Facebook preview renders | PREV-01 | Facebook crawler requires production deployment | Use Facebook Sharing Debugger tool with production URL |
| og:image loads for licensed occurrence | PREV-02 | Requires production deployment + real occurrence data | Inspect rendered preview card image source |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
