---
phase: 7
slug: nightly-workflow-hosting
status: planned
nyquist_compliant: true
wave_0_complete: true  # Plans 07-01 + 07-02 are the foundation; no separate Wave 0 gap
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
| 07-01-T1 | 07-01 | 1 | EXPORT-03 | T-7-01 | empty-result guard rejects under-threshold zip/parquet/row-count and writes structured diff | unit | `npx vitest run scripts/dwca/guard.test.ts` | ❌ → 07-01 creates | ⬜ pending |
| 07-01-T2 | 07-01 | 1 | EXPORT-04, EXPORT-05 | T-7-04 | sha256 sidecar (GNU coreutils format) round-trips against the published artifact for both .zip and .parquet | unit | `npx vitest run scripts/dwca/verify-publish.test.ts` | ❌ → 07-01 creates | ⬜ pending |
| 07-02-T1 | 07-02 | 1 | EXPORT-02 | T-7-05 | Lambda@Edge `handler` passes `/dwca/*` URIs straight through, BEFORE the bot-UA branch; non-/dwca paths unchanged | unit | `cd infra && npm test -- --testPathPattern edge-handler` | ✅ exists; extended by 07-02 | ⬜ pending |
| 07-02-T2 | 07-02 | 1 | EXPORT-02 | T-7-05 | L-01 deployed to production CloudFront — bot-UA request to `/dwca/*` returns non-text/html | smoke (human-verify) | `curl -sI -A 'facebookexternalhit/1.1' https://salishsea.io/dwca/probe-l01` | live after deploy.yml | ⬜ pending |
| 07-03-T1 | 07-03 | 2 | EXPORT-01, EXPORT-03 | T-7-01, T-7-02, T-7-03, T-7-06, T-7-07 | workflow file encodes cron, dispatch, SHA-pins, OIDC, P-02 ordering, guard step, invalidation | static lint | grep assertions in 07-03-PLAN.md Task 1 acceptance_criteria | ❌ → 07-03 creates | ⬜ pending |
| 07-03-T2 | 07-03 | 2 | EXPORT-01 | T-7-03 | peter-evans/create-issue-from-file@fca9117c… resolves to v6.0.0 on github.com | manual (human-verify) | open github.com/peter-evans/create-issue-from-file/releases/tag/v6.0.0 | n/a — external | ⬜ pending |
| 07-03-T3 | 07-03 | 2 | EXPORT-01 | T-7-01 | `SUPABASE_DB_URL` set in GH `production` env, port 5432 (direct) | manual (human-verify) | GitHub UI: Settings → Environments → production → Secrets | n/a — external | ⬜ pending |
| 07-03-T4 | 07-03 | 2 | EXPORT-01 | — | workflow file pushed to main; deploy.yml side-effect run completes | git assertion | `git rev-parse HEAD == git ls-remote origin main` | ❌ → 07-03 pushes | ⬜ pending |
| 07-03-T5 | 07-03 | 2 | EXPORT-01, EXPORT-02, EXPORT-03, EXPORT-04, EXPORT-05 | T-7-04, T-7-05 | first `workflow_dispatch` run completes green; both .zip + .parquet + .sha256 sidecars reachable at /dwca/; sha256sum -c round-trip green; no dwca-nightly-failed issue | smoke (human-verify) | `gh workflow run dwca-nightly.yml && gh run watch` then `curl -sI` × 4 + `sha256sum -c` | live after Task 4 push | ⬜ pending |

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
