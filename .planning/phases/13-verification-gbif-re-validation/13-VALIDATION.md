---
phase: 13
slug: verification-gbif-re-validation
status: draft
nyquist_compliant: true
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
| **Estimated runtime** | ~20 seconds (full suite); ~3 seconds for a single `scripts/dwca/*.test.ts` file |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- scripts/dwca`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | ATTR-05 (SC#2/SC#3/SC#4a/SC#4b) | T-13-01-PARSE / T-13-01-IDX | Columns resolved by NAME via header map (no positional literals); throw on header drift so a shifted column cannot silently pass; upstream org names asserted in `<associatedParty>`, never in `institutionCode` | unit | `npm test -- scripts/dwca/verify-artifact.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | ATTR-05 (PITFALLS items 3/4/5/6/10 + 1/2/8/9/11/12) | T-13-01-RO | Read-only prod SQL via `--linked` only; no UPDATE/INSERT/DELETE/ALTER; `comments` column never written (immutability invariant) | smoke (recorded-result grep) | `test -f .planning/phases/13-verification-gbif-re-validation/13-CHECKLIST.md && grep -qE "SRC-01\|institutionCode\|rightsHolder\|datasetName\|occurrenceID" .planning/phases/13-verification-gbif-re-validation/13-CHECKLIST.md && grep -qiE "PASS\|FAIL" .planning/phases/13-verification-gbif-re-validation/13-CHECKLIST.md && [ "$(grep -ciE 'verified by Phase' .planning/phases/13-verification-gbif-re-validation/13-CHECKLIST.md)" -ge 6 ]` | ✅ (produces 13-CHECKLIST.md) | ⬜ pending |
| 13-02-01 | 02 | 1 | ATTR-05 (SC#1) | T-13-02-CRED / T-13-02-VAL | `assertIndexeable` checks `indexeable === true` (strict boolean) + zero RESOURCE_INTEGRITY/RESOURCE_STRUCTURE; creds env-sourced, Authorization header never logged | unit | `npm test -- scripts/dwca/validate-gbif.test.ts` | ❌ W0 | ⬜ pending |
| 13-03-01 | 03 | 2 | ATTR-05 (SC#1–SC#4) | T-13-03-DSN / T-13-03-CRED | Fresh build ATTACHes prod read-only (maskDsn scrubs DSN); GBIF run env-sourced; F-02 26-col alignment guard gates the COPY | integration (recorded-evidence grep; build + GBIF run are external) | `test -f .planning/phases/13-verification-gbif-re-validation/13-VERIFICATION.md && grep -qiE "indexeable" .planning/phases/13-verification-gbif-re-validation/13-VERIFICATION.md && grep -qE "SC#1\|SC#2\|SC#3\|SC#4" .planning/phases/13-verification-gbif-re-validation/13-VERIFICATION.md` | ✅ (produces 13-VERIFICATION.md; consumes 13-01/13-02 scripts) | ⬜ pending |
| 13-03-02 | 03 | 2 | ATTR-05 (SC#1 gate review) | — | Operator confirms SC#1 (indexeable + zero blocking) and selects remediation set; no code change in this task | manual (checkpoint:human-verify) | N/A — `<human-check>`: operator confirms the SC#1 gate state and selects remediation (none \| eml-contact \| maplify-coord \| both) | N/A | ⬜ pending |
| 13-03-03 | 03 | 2 | ATTR-05 (D-03/D-04 inline remediation) | T-13-03-VIEWONLY / T-13-03-FIELDLOCK | View-only `CREATE OR REPLACE` (no source-table write, `comments` untouched, SRC-01 two-branch UNION preserved); fields.ts/meta.xml/fields.test.ts NOT touched (field already at index 14) | unit (full suite — 26-field + pgdb-qualification gate) | `npm test` | ✅ (fields.test.ts / build-queries.test.ts / eml.test.ts exist) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/dwca/verify-artifact.ts` — artifact-level assertions (SC#2 occurrenceID-prefix scan, SC#3 attribution spot-check against built `occurrence.txt`, SC#4b EML v1.3 title, SC#4a EML `<associatedParty>` presence with no upstream org name in `institutionCode`)
- [ ] `scripts/dwca/validate-gbif.ts` — GBIF validator API submit + poll + `indexeable`/blocking-category gate (SC#1)
- [ ] Existing `scripts/dwca/*.test.ts` cover the field-contract / EML round-trip assertions (incl. eml.test.ts associatedParty cases)

*Existing vitest infrastructure covers the field-contract + EML tests; the two new scripts above are Wave 0 additions. Tasks 13-01-02 and 13-03-01 are recorded-result/recorded-evidence checks (the prod DB and GBIF API are external) — their `<automated>` commands assert the produced markdown artifact exists and carries the required results.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GBIF validator "can be indexed by GBIF" (SC#1 live run) | ATTR-05 | External service; basic-auth + async job — fallback to manual upload if API unreliable (D-01) | Submit built zip to GBIF validation API (or gbif.org/tools/data-validator); confirm `indexeable: true` + zero RESOURCE_INTEGRITY/RESOURCE_STRUCTURE issues (13-03-01) |
| GBIF result review + remediation decision | ATTR-05 | Human judgment on which non-blocking warnings to remediate vs accept (D-03/D-04/D-06) | Operator reviews 13-VERIFICATION.md, confirms SC#1, selects remediation set (13-03-02 checkpoint) |
| Fresh local build against prod (D-02) | ATTR-05 | Needs `SUPABASE_DB_URL` (prod DSN via pooler, never committed) — operator sets env, runs `npm run build:dwca` | F-02 26-col alignment guard must pass; dist/dwca/{zip,occurrence.txt} produced (13-03-01) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
