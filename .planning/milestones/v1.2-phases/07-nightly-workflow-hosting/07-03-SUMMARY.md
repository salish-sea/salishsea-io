---
phase: 07-nightly-workflow-hosting
plan: "03"
subsystem: github-actions-workflow
status: complete — all 4 tasks verified end-to-end; smoke run 27778836650 succeeded after three diagnostic iterations
tags: [phase-07, dwca, nightly, github-actions, oidc, s3, cloudfront, sha-pin]

requires:
  - 07-01-PLAN
  - 07-02-PLAN

provides:
  - ".github/workflows/dwca-nightly.yml on main (scheduled + workflow_dispatch) — verified green via 2 successful workflow_dispatch runs (27778665159, 27778836650)"
  - "https://salishsea.io/dwca/salishsea-occurrences-v1.{zip,parquet,zip.sha256,parquet.sha256} reachable; sha256sum -c round-trip green"

affects:
  - "Phase 8 (DOWNLOAD-01) — unblocked; stable URL is live"
  - "scripts/dwca/build.ts + guard.ts — maskDsn upgraded to preserve error body while masking password substring"

tech-stack:
  added:
    - "peter-evans/create-issue-from-file@fca9117c27cdc29c6c4db3b86c48e4115a786710 (v6.0.0) — SHA verified via gh api"
    - "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 (v9.0.0)"
    - "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 (v7.0.0)"
    - "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e (v6.4.0)"
    - "aws-actions/configure-aws-credentials@e7f100cf4c008499ea8adda475de1042d6975c7b (v6.2.0)"
  patterns:
    - "Checksum-LAST upload order for object-store atomicity (parquet, zip, parquet.sha256, zip.sha256)"
    - "CloudFront invalidation + waiter (continue-on-error: true per Pitfall 6) + smoke check post-publish"
    - "Two-step failure-issue dedupe via github-script (listForRepo by label) + peter-evans/create-issue-from-file"
    - "DSN assembled at runtime in a dedicated step that URL-encodes DB_PASSWORD (handles @ : / in raw secret), masks the encoded value with ::add-mask::, and exports via $GITHUB_ENV — Build + Guard inherit SUPABASE_DB_URL with no inline env: blocks"
    - "Supabase session pooler (port 5432, aws-1-us-west-1.pooler.supabase.com) for IPv4 reachability — direct connection at db.<ref>.supabase.co is IPv6-only and GHA runners are IPv4"
    - "Default failure-issue body pre-seeded at dist/dwca/guard-diff.txt right after npm ci so peter-evans/create-issue-from-file has a valid content-filepath even for pre-guard failures"

key-files:
  created:
    - .github/workflows/dwca-nightly.yml

key-decisions:
  - "Action SHAs bumped to current majors after user feedback ('don't use deprecated actions'): checkout v6→v7.0.0, configure-aws-credentials v6.0→v6.2.0, github-script v7→v9.0.0. setup-node already at v6.4.0; peter-evans/create-issue-from-file at v6.0.0 (latest). Memory saved: always verify latest release before copying SHAs from sibling workflows."
  - "S3 cp destination uses ${DEST}/ (trailing slash) so S3 appends the source filename — avoids repeating salishsea-occurrences-v1 in destination arg, which would break the plan's awk-based upload-order acceptance test (greedy .* in sub)"
  - "SUPABASE_DB_URL assembled at runtime (not a pre-stored secret) from existing secrets.DB_PASSWORD + vars.SUPABASE_PROJECT_ID — matches CONTEXT C-01 revision; no new secret"
  - "Supabase **session pooler** (port 5432 at aws-1-us-west-1.pooler.supabase.com) instead of direct connection. Direct connection at db.<ref>.supabase.co is IPv6-only and GHA runners are IPv4-only. The plan's original Pitfall 4 (DuckDB can't use port 6543 transaction pooler) is correct — but the SESSION pooler at port 5432 on the same hostname works because PgBouncer in session mode preserves prepared statements and other session features that DuckDB ATTACH needs. Discovered after run 27778227950 failed (db.<ref>.supabase.co IPv6-only)."
  - "DB_PASSWORD URL-encoded before substitution into the DSN — raw password contains `@` (and possibly `:`/`/`), which broke the URL parser when interpolated directly (run 27778446122 failed with `could not translate host name ETR@aws-1-...` — the `ETR` was a tail of the password split by the literal `@`). Fix: a dedicated 'Prepare Postgres DSN' step encodes via Node's encodeURIComponent, registers the encoded value with ::add-mask::, and exports the assembled URL via $GITHUB_ENV."
  - "maskDsn (in scripts/dwca/build.ts + guard.ts) upgraded from all-or-nothing `<redacted>` to regex-based password-only masking. The original implementation collapsed the entire error message whenever it contained `://`, making the production connection failures undiagnosable. New behavior preserves the rest of the message and falls back to hard redaction if no structured DSN is found."
  - "Default failure-issue body pre-seeded at dist/dwca/guard-diff.txt immediately after npm ci. Without this, peter-evans/create-issue-from-file silently no-ops on early-stage failures (it logs 'File not found' and exits 0). Discovered after the first 3 failed runs filed zero failure issues despite the on: failure() steps reporting success."
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
  duration: "~90 min total — Task 1 draft (~15 min) + 4 fix-iterations + final smoke (~30 min)"
  completed: 2026-06-18
  tasks_completed: 4
  tasks_total: 4
  files_created: 1
  files_modified: 3  # scripts/dwca/build.ts, scripts/dwca/guard.ts (maskDsn fix), .github/workflows/dwca-nightly.yml (3 fixes)
  smoke_runs_succeeded: 2  # 27778665159, 27778836650
---

# Phase 7 Plan 03: DwC-A Nightly Workflow Summary

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
