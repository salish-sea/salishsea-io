---
phase: 8
slug: frontend-download-link
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7 (jsdom env via `// @vitest-environment jsdom` pragma) |
| **Config file** | `vitest.config.ts` (excludes `e2e/**`, `infra/**`, `node_modules/**`) |
| **Quick run command** | `npm test -- src/salish-sea.test.ts src/download-info.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds (quick); ~15–30 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/salish-sea.test.ts src/download-info.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds (quick)

---

## Per-Task Verification Map

> Populated by the planner from RESEARCH.md §"Validation Architecture → Phase Requirements → Test Map".

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-XX-XX | XX | N | DOWNLOAD-01 | — | Section renders all four hrefs + license + dwc.tdwg.org links | unit (DOM) | `npm test -- src/salish-sea.test.ts -t "download section renders"` | ❌ W0 | ⬜ pending |
| 08-XX-XX | XX | N | DOWNLOAD-01 | — | `formatBytes` returns "1.4 MB", "65 B" at expected thresholds | unit (pure) | `npm test -- src/download-info.test.ts -t formatBytes` | ❌ W0 | ⬜ pending |
| 08-XX-XX | XX | N | DOWNLOAD-01 | — | `formatRelativeTime` returns "updated 6 hours ago"; falls back to absolute past 7-day cutoff | unit (pure, time-injected) | `npm test -- src/download-info.test.ts -t formatRelativeTime` | ❌ W0 | ⬜ pending |
| 08-XX-XX | XX | N | DOWNLOAD-01 | — | HEAD fires on first `onAboutClicked` for `.zip` + `.parquet` | unit (vi.spyOn fetch) | `npm test -- src/salish-sea.test.ts -t "HEAD fires on open"` | ❌ W0 | ⬜ pending |
| 08-XX-XX | XX | N | DOWNLOAD-01 | — | HEAD does NOT refire on second open (session cache) | unit (vi.spyOn fetch) | `npm test -- src/salish-sea.test.ts -t "HEAD does not refire"` | ❌ W0 | ⬜ pending |
| 08-XX-XX | XX | N | DOWNLOAD-01 | T-08-01 | On HEAD failure: fallback copy renders; no sizes shown | unit (vi.spyOn mocked rejection) | `npm test -- src/salish-sea.test.ts -t "fallback on HEAD failure"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/download-info.ts` — pure helpers (`formatBytes`, `formatRelativeTime`)
- [ ] `src/download-info.test.ts` — pure-function tests covering threshold boundaries (KB↔MB, hour↔day↔week, the 7-day absolute fallback) with an injected `now`
- [ ] New test cases appended to `src/salish-sea.test.ts` (DOM render assertion, HEAD-fires-on-open, HEAD-doesn't-refire, fallback-on-failure) — file already exists; no new framework install

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production deploy serves the new section and the links resolve to real archives | DOWNLOAD-01 | Phase 7's CloudFront + Lambda@Edge + actual S3 contents can't be reproduced in CI without a deploy | After merge to `main` + `deploy.yml` finishes: open `https://salishsea.io`, click ⓘ to open the About modal, confirm the Data download section renders with file sizes + "updated X ago"; click `.zip` and `.parquet` links, confirm files download with correct filenames; click both `.sha256` "verify" links, confirm they download as text |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`download-info.ts` + tests)
- [ ] No watch-mode flags
- [ ] Feedback latency < ~5s on quick command
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
