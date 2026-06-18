---
phase: 07-nightly-workflow-hosting
verified: 2026-06-18T18:00:00Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 7: Nightly Workflow & Hosting — Verification Report

**Phase Goal:** A scheduled GitHub Actions workflow regenerates and publishes the archive nightly to the existing S3/CloudFront site, reusing the existing AWS OIDC role and bucket, with an atomic write-then-swap, an empty-result guard, a CloudFront invalidation, and a published checksum. This is the only prod-touching, secret-requiring surface.

**Verified:** 2026-06-18T18:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All 5 ROADMAP success criteria plus 8 plan-level must-haves verified:

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Scheduled workflow (+ workflow_dispatch) runs nightly | VERIFIED | `cron: '0 9 * * *'` + `workflow_dispatch:` both present in `.github/workflows/dwca-nightly.yml`. Two successful dispatch runs confirmed: 27778665159, 27778836650. |
| SC-2 | Archive reachable at stable `/dwca/…` URL, no new AWS infra | VERIFIED | Live: `https://salishsea.io/dwca/salishsea-occurrences-v1.zip` HTTP/2 200 `application/zip`; `.parquet` HTTP/2 200. Same OIDC role + S3 bucket reused. |
| SC-3 | Atomic publish, empty-result guard, CloudFront invalidation | VERIFIED | Upload order parquet→zip→parquet.sha256→zip.sha256 (checksum-LAST P-02). `guard.ts` exits 1 on threshold breach. `aws cloudfront create-invalidation --paths '/dwca/*'` + wait step present. |
| SC-4 | sha256 checksum published and verifiable | VERIFIED | `sha256sum -c salishsea-occurrences-v1.zip.sha256` on downloaded pair: PASS (hex `3b7ccc9c…`). GNU coreutils `<64-hex>  <filename>` format confirmed. |
| SC-5 | GeoParquet treated symmetrically | VERIFIED | `.parquet` + `.parquet.sha256` both at HTTP/2 200. Upload order includes both. Guard checks `PARQUET_FLOOR_BYTES`. `verify-publish.ts` NAMES array includes `.parquet`. `sha256sum -c` on parquet pair: PASS. |
| P7-01 | `cron: '0 9 * * *'` + `workflow_dispatch`, `concurrency: cancel-in-progress: false` | VERIFIED | Lines 4-10 of workflow. Concurrency group `dwca-nightly`, `cancel-in-progress: false`. |
| P7-02 | guard.ts exits non-zero + writes `dist/dwca/guard-diff.txt` on threshold breach | VERIFIED | `guard.ts` lines 127-149: builds diff struct, `writeFileSync(DIFF_PATH, humanBody)`, `process.exit(1)`. |
| P7-03 | verify-publish.ts parses GNU coreutils sidecar, verifies both artifacts | VERIFIED | `parseSha256Sidecar` splits on `/\s+/`, validates 64-char hex, called inside `verify()`. `NAMES = ['salishsea-occurrences-v1.zip', 'salishsea-occurrences-v1.parquet']`. Live round-trip passes. |
| P7-04 | DSN never logged (T-7-01) | VERIFIED | `printf … >> "${GITHUB_ENV}"` (writes to env file, not stdout). `ENCODED_PW` is `::add-mask::`'d before use. `grep -E '(console\.(log\|error)\|throw new Error).*://' guard.ts` — empty. No `echo $SUPABASE_DB_URL` or `set -x` in workflow. |
| P7-05 | Every third-party action SHA-pinned (T-7-03) | VERIFIED | checkout@9c091bb2 (v7.0.0), setup-node@48b55a01 (v6.4.0), configure-aws-credentials@e7f100cf (v6.2.0), github-script@3a2844b7 (v9.0.0), peter-evans/create-issue-from-file@fca9117c (v6.0.0). No `@v<N>` tag pins. |
| P7-06 | OIDC role reused, no new AWS infra (T-7-02) | VERIFIED | `role-to-assume: arn:aws:iam::648183724555:role/salishsea-deploy-action`. `permissions: id-token: write, contents: read, issues: write` only. |
| P7-07 | L-01 Lambda@Edge carve-out — `/dwca/*` passes through to S3 for bot UAs | VERIFIED | `infra/lib/edge-handler/index.ts` line 101: `if (request.uri.startsWith('/dwca/')) { return request; }` BEFORE `const ua = ...` (awk check confirmed). Live: `curl -A 'facebookexternalhit/1.1' https://salishsea.io/dwca/probe-l01` → HTTP/2 403 `application/xml` (S3 NoSuchKey, not Lambda OG-meta HTML). |
| P7-08 | On failure: dedup'd `dwca-nightly-failed` issue opened via peter-evans | VERIFIED | `actions/github-script` step lists open issues by label; `peter-evans/create-issue-from-file` passes `issue-number` for dedup. `content-filepath: ./dist/dwca/guard-diff.txt` (pre-seeded after `npm ci`). |

**Score:** 13/13 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.github/workflows/dwca-nightly.yml` | Scheduled + dispatchable publish workflow, ≥100 lines | VERIFIED | 155 lines. All 23 plan-01 acceptance criteria pass per SUMMARY self-check. |
| `scripts/dwca/guard.ts` | G-01..G-04 guard, exports `main`, maskDsn, PARQUET_FLOOR_BYTES, dwc.occurrences query | VERIFIED | 163 lines. All required patterns present. `grep -c maskDsn guard.ts` = 7. |
| `scripts/dwca/guard.test.ts` | ≥6 test() invocations, DSN-safety, diff shape | VERIFIED | `grep -c '^\s*test\(' guard.test.ts` = 6. |
| `scripts/dwca/verify-publish.ts` | Exports verify, parseSha256Sidecar, main; GNU coreutils format; DWCA_BASE_URL | VERIFIED | All 3 exports confirmed. DWCA_BASE_URL env-overridable. |
| `scripts/dwca/verify-publish.test.ts` | ≥6 test() invocations, no network | VERIFIED | `grep -c '^\s*test\(' verify-publish.test.ts` = 6. |
| `infra/lib/edge-handler/index.ts` | L-01 carve-out before UA branch | VERIFIED | `request.uri.startsWith('/dwca/')` at line 101, before `const ua` at line 105. |
| `infra/lib/edge-handler/index.test.ts` | ≥15 it() invocations, L-01 describe block | VERIFIED | `grep -c '^\s*it\(' index.test.ts` = 15. L-01 describe block confirmed. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `dwca-nightly.yml` | `scripts/dwca/guard.ts` | `npx tsx scripts/dwca/guard.ts` step | WIRED | Line 100 of workflow, SUPABASE_DB_URL inherited from GITHUB_ENV |
| `dwca-nightly.yml` | `scripts/dwca/verify-publish.ts` | `npx tsx scripts/dwca/verify-publish.ts` step | WIRED | Line 130 of workflow |
| `dwca-nightly.yml` | S3 bucket `salishsea-io/site/dwca/` | 4× `aws s3 cp … ${DEST}/` | WIRED | Lines 107-110; `DEST: s3://${{ vars.S3_BUCKET }}/site/dwca` |
| `dwca-nightly.yml` | CloudFront `/dwca/*` invalidation | `create-invalidation --paths '/dwca/*'` + `wait invalidation-completed` | WIRED | Lines 117, 125-127 |
| `dwca-nightly.yml` | Failure issue creation | github-script (find) + peter-evans (open/update) with `if: failure()` | WIRED | Steps 12-13, label `dwca-nightly-failed`, dedup via `issue-number` output |
| `index.ts handler` | L-01 carve-out | `startsWith('/dwca/')` BEFORE `isBot(ua)` branch | WIRED | awk ordering check confirmed "ok" |

---

## Threat Model Mitigation Verification

| Threat | Plan Claim | Shipped State | Verified |
|--------|-----------|---------------|---------|
| T-7-01 DSN masking | `maskDsn()` in guard.ts; `printf … >> $GITHUB_ENV`, `::add-mask::` before use | `maskDsn` present (7 occurrences). `printf` redirects to `${GITHUB_ENV}` with `>>`. `echo "::add-mask::${ENCODED_PW}"` before `printf`. No `console.log/error` with `://`. | VERIFIED |
| T-7-03 SHA pins | All 4 (+ github-script) pinned to 40-char hex | checkout@9c091bb2, setup-node@48b55a01, configure-aws-credentials@e7f100cf, github-script@3a2844b7, peter-evans@fca9117c — all 40-char hex, no `@v<N>` tag pins | VERIFIED — note: checkout and aws-credentials SHAs differ from 07-03-PLAN.md spec (plan listed deprecated v6/v6.0; shipped uses v7.0.0 and v6.2.0 respectively per key-decisions "bump deprecated action SHAs"). This is an intentional upgrade, not a drift. |
| T-7-04 Checksum-LAST upload order | parquet, zip, parquet.sha256, zip.sha256 | awk order extraction: `.parquet,.zip,.parquet.sha256,.zip.sha256,` — exact match | VERIFIED |
| T-7-05 L-01 Lambda@Edge carve-out | `startsWith('/dwca/')` before UA branch, deployed | Live: `facebookexternalhit` UA to `/dwca/probe-l01` → HTTP/2 403 `application/xml` (S3, not Lambda HTML) | VERIFIED |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `salishsea-occurrences-v1.zip` HTTP 200 + Content-Type | `curl -sI https://salishsea.io/dwca/salishsea-occurrences-v1.zip` | HTTP/2 200, `content-type: application/zip` | PASS |
| `salishsea-occurrences-v1.parquet` HTTP 200 | `curl -sI …/salishsea-occurrences-v1.parquet` | HTTP/2 200, `content-type: binary/octet-stream` | PASS |
| `.zip.sha256` sidecar HTTP 200 | `curl -sI …/salishsea-occurrences-v1.zip.sha256` | HTTP/2 200 | PASS |
| `.parquet.sha256` sidecar HTTP 200 | `curl -sI …/salishsea-occurrences-v1.parquet.sha256` | HTTP/2 200 | PASS |
| sha256 round-trip for zip | `curl … zip + zip.sha256; sha256sum -c` | `salishsea-occurrences-v1.zip: OK` | PASS |
| sha256 round-trip for parquet | `curl … parquet + parquet.sha256; sha256sum -c` | `salishsea-occurrences-v1.parquet: OK` | PASS |
| L-01 carve-out live (bot UA) | `curl -sI -A 'facebookexternalhit/1.1' https://salishsea.io/dwca/probe-l01` | HTTP/2 403 `application/xml` (S3 NoSuchKey — not Lambda OG HTML) | PASS |
| Two successful workflow_dispatch runs | `gh run list --workflow=dwca-nightly.yml --limit 10` | IDs 27778665159 (success) + 27778836650 (success) | PASS |

---

## Requirements Coverage

| Requirement | Description | Source Plan | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EXPORT-01 | Scheduled nightly regeneration | 07-03 | SATISFIED | `cron: '0 9 * * *'` + `workflow_dispatch`. Dispatch runs succeeded. |
| EXPORT-02 | Published to S3/CloudFront at stable `/dwca/…` URL, no new AWS infra | 07-02, 07-03 | SATISFIED | L-01 carve-out live. All 4 URLs HTTP/2 200. OIDC role + bucket reused. |
| EXPORT-03 | Atomic publish, empty-result guard, CloudFront invalidation | 07-01, 07-03 | SATISFIED | Checksum-LAST order. `guard.ts` exits 1 on breach. `create-invalidation + wait` present. |
| EXPORT-04 | sha256 checksum published alongside archive | 07-01, 07-03 | SATISFIED | `.zip.sha256` at HTTP/2 200. GNU coreutils format. sha256sum -c round-trip: OK. |
| EXPORT-05 | GeoParquet treated symmetrically (publish, guard, invalidation, checksum) | 07-01, 07-03 | SATISFIED | `.parquet` + `.parquet.sha256` at HTTP/2 200. `PARQUET_FLOOR_BYTES` in guard. sha256sum -c round-trip: OK. |

---

## Anti-Patterns Found

None. Specific negatives confirmed:

- No `aws s3 sync` (grep count = 0)
- No `@v<N>` tag pins (grep exits 1)
- No `echo $SUPABASE_DB_URL` / `set -x` / `printf` to stdout for the assembled DSN (printf redirects to `${GITHUB_ENV}` with `>>`)
- No `console.log/error` containing `://` in `guard.ts` or `verify-publish.ts`
- No `cancel-in-progress: true` on concurrency group
- No `workflow_dispatch.inputs` that could bypass the guard

---

## Notable Deviations from Plan (Intentional, Not Gaps)

1. **Action SHA pins updated from plan spec.** `07-03-PLAN.md` Task 1 specified `actions/checkout@de0fac2e` (v6) and `aws-actions/configure-aws-credentials@acca2b1b` (v6.0). Shipped uses `actions/checkout@9c091bb2` (v7.0.0) and `aws-actions/configure-aws-credentials@e7f100cf` (v6.2.0) per documented key-decision "bump deprecated action SHAs." The security posture is strictly better (newer versions, still SHA-pinned). No gap.

2. **SUPABASE_DB_URL assembled via dedicated step + GITHUB_ENV** (not inline `env:` on individual steps). This change from the original plan design was driven by the session-pooler switch and URL-encoding requirement, documented in key-decisions. The assembled DSN is masked via `::add-mask::` before export. T-7-01 is satisfied by this approach.

3. **Session pooler hostname** (`aws-1-us-west-1.pooler.supabase.com:5432`) instead of direct `db.<ref>.supabase.co:5432`. Plan Pitfall 4 noted the transaction pooler (port 6543) can't be used; the session pooler at port 5432 is the correct fix for GHA IPv4 runners. Documented in key-decisions.

4. **Default failure-issue body pre-seeded** (the "Seed default failure-issue body" step) was not in the original plan spec but was added to fix a real gap discovered during smoke runs where `peter-evans/create-issue-from-file` silently no-ops on a missing `content-filepath`. This is an additive hardening of O-01.

---

## Human Verification Required

None. All observable behaviors verified programmatically or against live production state.

---

_Verified: 2026-06-18T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
