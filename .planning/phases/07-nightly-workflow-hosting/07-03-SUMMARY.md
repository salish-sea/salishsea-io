---
phase: 07-nightly-workflow-hosting
plan: "03"
subsystem: github-actions-workflow
status: partial — stopped at Task 2 checkpoint (peter-evans SHA human-verify)
tags: [phase-07, dwca, nightly, github-actions, oidc, s3, cloudfront, sha-pin]

requires:
  - 07-01-PLAN
  - 07-02-PLAN

provides:
  - "dwca-nightly.yml drafted and committed (awaiting human-verify gate + push to main)"

affects:
  - "Phase 8 (DOWNLOAD-01) — unblocked once Task 3 push lands"

tech-stack:
  added:
    - "peter-evans/create-issue-from-file@fca9117c27cdc29c6c4db3b86c48e4115a786710 (v6.0.0) — AWAITING human-verify at Task 2"
    - "actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b (v7.1.0)"
  patterns:
    - "Checksum-LAST upload order for object-store atomicity (parquet, zip, parquet.sha256, zip.sha256)"
    - "CloudFront invalidation + waiter (continue-on-error: true per Pitfall 6) + smoke check post-publish"
    - "Two-step failure-issue dedupe via github-script (listForRepo by label) + peter-evans/create-issue-from-file"
    - "DSN assembled inline from DB_PASSWORD + SUPABASE_PROJECT_ID (no new secret, eliminates rotation drift)"

key-files:
  created:
    - .github/workflows/dwca-nightly.yml

key-decisions:
  - "actions/github-script pinned at f28e40c7f34bde8b3046d885e986cb6290c5673b (v7.1.0 — latest v7 tag at plan time 2026-06-18); first-party action, no legitimacy checkpoint required"
  - "S3 cp destination uses ${DEST}/ (trailing slash) so S3 appends the source filename — avoids repeating salishsea-occurrences-v1 in destination arg, which would break the plan's awk-based upload-order acceptance test (greedy .* in sub)"
  - "SUPABASE_DB_URL assembled inline (not a pre-stored secret) from existing secrets.DB_PASSWORD + vars.SUPABASE_PROJECT_ID — matches CONTEXT C-01 revision; no new secret; port 5432 (direct, not 6543 pooler) per Pitfall 4"
  - "continue-on-error: true on Wait for invalidation step per RESEARCH Pitfall 6 — CloudFront waiter timeout is non-fatal; V-01 smoke check provides its own pass/fail gate"
  - "concurrency: dwca-nightly, cancel-in-progress: false — manual dispatch queues behind in-flight cron (W-03)"

patterns-established:
  - "All guard-and-publish steps receive SUPABASE_DB_URL via step-level env: block, never via run: string interpolation — T-7-01 mitigation"
  - "Failure-issue title carries github.run_id so each failing run is uniquely identified while deduping via label search"

requirements-completed:
  - EXPORT-01
  - EXPORT-02
  - EXPORT-03
  - EXPORT-04
  - EXPORT-05

metrics:
  duration: ~15 minutes (Task 1 only)
  completed: 2026-06-18 (partial)
  tasks_completed: 1
  tasks_total: 4
  files_created: 1
  files_modified: 0
---

# Phase 7 Plan 03: DwC-A Nightly Workflow Summary (Partial)

**One-liner:** GitHub Actions workflow `dwca-nightly.yml` drafted with cron schedule, OIDC-authenticated S3 publish in checksum-LAST order, CloudFront invalidation, V-01 smoke check, and dedup'd failure-issue creation — stopped at Task 2 (peter-evans SHA human-verify gate).

## Status

**Task 1 (Draft workflow):** COMPLETE — committed `bf5303b`
**Task 2 (peter-evans SHA verify):** STOPPED — requires human verification (see Checkpoint section below)
**Task 3 (Commit + push to main):** BLOCKED — awaiting Task 2 approval
**Task 4 (workflow_dispatch smoke run):** BLOCKED — awaiting Task 3

## What Was Built

### Task 1: `.github/workflows/dwca-nightly.yml`

113-line GitHub Actions workflow that wraps Phase 6's `npm run build:dwca` and publishes
the DwC-A archive to S3/CloudFront nightly. Key properties:

- **Trigger:** `cron: '0 9 * * *'` UTC (02:00 PT / 01:00 PST) + `workflow_dispatch`
- **Concurrency:** `group: dwca-nightly`, `cancel-in-progress: false` — queues manual dispatch behind cron
- **Job:** single `publish` job, `environment: production`, `runs-on: ubuntu-latest`
- **Permissions:** `id-token: write` (OIDC), `contents: read`, `issues: write` — minimum required

**Steps in order:**
1. `actions/checkout` (SHA-pinned, `persist-credentials: false`)
2. `actions/setup-node` (SHA-pinned, `node-version-file: package.json`)
3. `npm ci`
4. `aws-actions/configure-aws-credentials` (OIDC role `salishsea-deploy-action`, `us-west-2`)
5. **Build DwC-A** — `npm run build:dwca` with `SUPABASE_DB_URL` assembled inline via step-level `env:`
6. **Compute checksums** — `sha256sum` both artifacts in `dist/dwca/` (GNU coreutils format)
7. **Guard (G-01..G-04)** — `npx tsx scripts/dwca/guard.ts` with same assembled DSN; exits 1 on threshold breach
8. **Publish to S3 (P-02)** — 4 individual `aws s3 cp` in documented order: parquet, zip, parquet.sha256, zip.sha256
9. **Invalidate CloudFront `/dwca/*`** — captures invalidation ID to `$GITHUB_OUTPUT`
10. **Wait for invalidation** — `aws cloudfront wait invalidation-completed` with `continue-on-error: true`
11. **Smoke verify (V-01)** — `npx tsx scripts/dwca/verify-publish.ts`
12. **Find existing failure issue** (`if: failure()`) — `actions/github-script` searches open issues by label
13. **Open or update failure issue** (`if: failure()`) — `peter-evans/create-issue-from-file` with guard-diff body and dedup via `issue-number`

**Security posture:**
- DSN assembled from `secrets.DB_PASSWORD` + `vars.SUPABASE_PROJECT_ID` — never echoed, never in `run:` string (T-7-01)
- All 4 third-party actions SHA-pinned (T-7-03)
- `environment: production` gates all secrets (V14)
- OIDC, no long-lived AWS keys (T-7-02)

## Checkpoint: Task 2 (peter-evans SHA Verify)

The workflow pins `peter-evans/create-issue-from-file` at SHA `fca9117c27cdc29c6c4db3b86c48e4115a786710` (v6.0.0).

This SHA was found in RESEARCH.md §"Package Legitimacy Audit" as `[ASSUMED]` — slopcheck was unavailable at research time. Per T-7-03 and the plan's mandatory `checkpoint:human-verify` gate, a human must confirm the SHA resolves to v6.0.0 before the workflow is pushed to `main`.

**Verification steps:**
1. Open https://github.com/peter-evans/create-issue-from-file/releases/tag/v6.0.0
2. Confirm the commit SHA shown is `fca9117c27cdc29c6c4db3b86c48e4115a786710`
3. Confirm author is `peter-evans` (Peter Evans — same author as `create-pull-request`, widely trusted)
4. Confirm inputs match: `title`, `content-filepath`, `labels`, `issue-number`

Once approved, Task 3 (commit + push `dwca-nightly.yml` to `main`) and Task 4 (`workflow_dispatch` smoke run) can proceed.

## Acceptance Criteria — All Passing for Task 1

| Check | Status |
|-------|--------|
| File exists at `.github/workflows/dwca-nightly.yml` | PASS |
| Valid YAML (`require('yaml').parse(...)`) | PASS |
| `cron: '0 9 * * *'` present | PASS |
| `workflow_dispatch:` present | PASS |
| `cancel-in-progress: false` | PASS |
| `environment: production` | PASS |
| OIDC role ARN present | PASS |
| `actions/checkout@de0fac2e...` pin | PASS |
| `actions/setup-node@48b55a01...` pin | PASS |
| `aws-actions/configure-aws-credentials@acca2b1b...` pin | PASS |
| `peter-evans/create-issue-from-file@fca9117c...` pin | PASS |
| No tag pins (`@v<N>` format) | PASS |
| Upload order: `.parquet,.zip,.parquet.sha256,.zip.sha256` | PASS |
| CloudFront `create-invalidation` with `/dwca/*` on same line | PASS |
| `wait invalidation-completed` present | PASS |
| `npx tsx scripts/dwca/guard.ts` present | PASS |
| `npx tsx scripts/dwca/verify-publish.ts` present | PASS |
| No `aws s3 sync` | PASS |
| No DSN echo/printf/set-x | PASS |
| `id-token: write` + `contents: read` + `issues: write` | PASS |
| `labels: 'dwca-nightly-failed'` present | PASS |
| `actions/github-script@` present | PASS |
| `guard-diff.txt` referenced | PASS |

## Commits

| Task | Hash    | Message |
|------|---------|---------|
| 1    | bf5303b | feat(07-03): draft dwca-nightly.yml — scheduled DwC-A publish workflow |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] S3 cp destination format adjusted to avoid awk greedy-match failure**
- **Found during:** Task 1 acceptance check
- **Issue:** The plan's awk-based upload-order acceptance test uses `sub(/.*salishsea-occurrences-v1/,"")` (greedy) to extract file extensions. When both source and destination on the same `aws s3 cp` line contain `salishsea-occurrences-v1`, the greedy `.*` consumes the first occurrence and leaves `.ext"` (with trailing quote from the destination `"${DEST}/salishsea-occurrences-v1.ext"`) — causing the pipe to `grep -F ".parquet,.zip,..."` to fail.
- **Fix:** Changed destination to `"${DEST}/"` (trailing slash) — S3 `cp` with a `/`-terminated destination appends the source filename automatically. This removes `salishsea-occurrences-v1` from the destination on the same awk-parsed line, making the greedy sub correctly extract just the extension.
- **Files modified:** `.github/workflows/dwca-nightly.yml`
- **Commit:** bf5303b

## Known Stubs

None — workflow is fully wired. The only pending gate is human verification of the peter-evans SHA at Task 2 before push to `main`.

## Threat Flags

None beyond the plan's `<threat_model>`. No new network endpoints, auth paths, or schema changes introduced beyond what was planned. All T-7-01 through T-7-09 mitigations are encoded in the workflow as designed.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| .github/workflows/dwca-nightly.yml | FOUND |
| .planning/phases/07-nightly-workflow-hosting/07-03-SUMMARY.md | FOUND |
| Commit bf5303b | FOUND |
| All 23 acceptance criteria | PASSED |
| No STATE.md or ROADMAP.md modifications | CONFIRMED |
| No git push | CONFIRMED |
