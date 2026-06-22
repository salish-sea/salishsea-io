---
phase: 14
slug: dwc-a-build-pre-prod-gate-seeded-local-db
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test` (unit only — no DSN; `build.test.ts` skips) |
| **Full suite command** | `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test` (un-skips `build.test.ts` against the seeded local stack) |
| **Estimated runtime** | ~60–120 seconds with DSN (includes `npm run build:dwca`) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (no DSN — confirms unit suite stays green and the no-DSN skip path is preserved).
- **After every plan wave:** Run the full suite with `SUPABASE_DB_URL` against a freshly `db reset` + seeded local stack.
- **Before `/gsd-verify-work`:** Full suite must be green with the seeded DB, AND the no-DSN run must still be green (cross-cutting constraint).
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

> Filled by the planner/executor as tasks are defined. Core proofs this phase must achieve:

| Proof | Requirement | Test Type | Automated Command | Status |
|-------|-------------|-----------|-------------------|--------|
| `supabase db reset` applies full migration chain cleanly (A3 risk) | DB-RESET | integration | `supabase db reset` exits 0 | ⬜ pending |
| CI fixture makes `dwc.occurrences` + `dwc.multimedia` non-empty | FIXTURE | integration | seeded `build.test.ts` DWCA-01..04/06 pass | ⬜ pending |
| Gate runs in `build.yml` on PRs (suite un-skips) | CI-GATE | integration | CI `npm test` step executes the integration block | ⬜ pending |
| No-DSN `npm test` still skips cleanly (green) | NO-DSN | unit | `npm test` exits 0 with `build.test.ts` skipped | ⬜ pending |
| Gate fails on a deliberate bare-schema-ref regression | RED-TEST | manual | revert `aad63dd`-style fix → seeded suite goes red | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing infrastructure (vitest + `build.test.ts` + the local Supabase stack) covers all phase requirements. No new test framework needed — Phase 14 *activates* the already-written integration suite rather than authoring new test code.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gate fails on a query regression | RED-TEST | Deliberately introducing a bug into committed code is not a permanent automated test (kept out of the suite to stay clean) | On a scratch branch, reintroduce a bare un-`pgdb.`-qualified schema ref in `build.ts`, run the seeded suite, confirm it goes red, then discard the branch. Document the result in verification. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or are explicitly manual (RED-TEST)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (none — existing infra)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
