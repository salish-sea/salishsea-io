---
phase: 7
slug: nightly-workflow-hosting
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) + GitHub Actions workflow_dispatch |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run scripts/dwca/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (local); ~3–5 min (workflow_dispatch smoke) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run scripts/dwca/` (or the touched test file)
- **After every plan wave:** Run `npx vitest run` + lint
- **Before `/gsd-verify-work`:** Full suite + at least one successful `workflow_dispatch` of `dwca-nightly.yml` on a non-prod branch (dry-run mode)
- **Max feedback latency:** 30 seconds local; 300 seconds for workflow smoke

---

## Per-Task Verification Map

> Populated by planner — table seeded from RESEARCH.md validation architecture.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 0 | EXPORT-03 | — | empty-result guard rejects under-threshold archives | unit | `npx vitest run scripts/dwca/guard.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 0 | EXPORT-04 | — | sha256 sidecar matches archive bytes | unit | `npx vitest run scripts/dwca/verify-publish.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | EXPORT-02 | — | Lambda@Edge passes `/dwca/*` straight through (no UA branch) | unit | `npx vitest run infra/lambda-edge/og-meta/index.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | 2 | EXPORT-01 | — | scheduled workflow + workflow_dispatch publishes archive + parquet + checksums | manual | `gh workflow run dwca-nightly.yml` then HEAD checksums | ✅ W2 | ⬜ pending |
| TBD | TBD | 2 | EXPORT-05 | — | GeoParquet sidecar published with checksum + invalidation | manual | HEAD `/dwca/occurrences.parquet` + sha256 | ✅ W2 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/dwca/guard.ts` + `scripts/dwca/guard.test.ts` — empty/under-threshold guard (EXPORT-03)
- [ ] `scripts/dwca/verify-publish.ts` + `scripts/dwca/verify-publish.test.ts` — sha256 sidecar + atomic upload helper (EXPORT-04)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scheduled cron triggers nightly | EXPORT-01 | GHA scheduler is external; cannot unit-test | Inspect Actions run history 24h after merge; confirm at least one scheduled run |
| Archive reachable at `https://salishsea.io/dwca/dwc-archive.zip` after publish | EXPORT-02 | Requires CloudFront invalidation + live edge | `curl -I` URL after workflow run, expect 200 + matching ETag |
| CloudFront serves fresh content (invalidation works) | EXPORT-02 | Edge cache behavior is external | Compare HEAD ETag pre- and post-invalidation |
| Empty-result guard rejects on real export anomaly | EXPORT-03 | Requires running export to completion | `workflow_dispatch` with forced-empty mode; expect issue created, no overwrite |
| sha256 verifies against published file | EXPORT-04 | End-to-end download + verify | `curl -O` archive + .sha256, `sha256sum -c` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (guard + verify-publish unit tests)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (local) / 300s (smoke)
- [ ] `nyquist_compliant: true` set in frontmatter after planner fills the per-task table

**Approval:** pending
