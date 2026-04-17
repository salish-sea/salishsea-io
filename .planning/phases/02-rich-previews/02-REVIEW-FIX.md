---
phase: 02-rich-previews
fixed_at: 2026-04-17T00:00:00Z
review_path: .planning/phases/02-rich-previews/02-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-04-17
**Source review:** .planning/phases/02-rich-previews/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: Supabase anon key passed as plaintext shell argument in CI

**Files modified:** `.github/workflows/deploy.yml`
**Commit:** 8c2c11f
**Applied fix:** Added `env: SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_KEY }}` block to the CDK deploy step and changed the `--context` argument to read from the environment variable with proper quoting: `--context "supabaseAnonKey=${SUPABASE_ANON_KEY}"`.

### CR-02: SSM parameter for anon key created as StringParameter, not SecureString

**Files modified:** `infra/lib/infra-stack.ts`
**Commit:** f5e56ee
**Applied fix:** Replaced the `new ssm.StringParameter(...)` construct (which wrote a plaintext value on every deploy) with `ssm.StringParameter.fromSecureStringParameterAttributes(...)` — an import-only reference. CDK no longer writes the anon key value; the SecureString must be set manually in AWS SSM before first deploy.

### WR-01: Non-bot requests with a missing user-agent header are treated as bots

**Files modified:** `infra/lib/edge-handler/index.ts`
**Commit:** fb01c96
**Applied fix:** Replaced the 4-character substring `'bsky'` in `BOT_AGENTS` with `'bsky.social'` to avoid false-positive matches on unrelated user-agents containing that short substring. The `'bluesky'` entry already covers the Bluesky app name.

### WR-02: res.json() called without checking HTTP status

**Files modified:** `infra/lib/edge-handler/index.ts`
**Commit:** 966fd14
**Applied fix:** Added a `if (!res.ok)` guard immediately after the `fetch()` call. On non-2xx responses the handler returns the generic preview HTML rather than attempting to parse a potentially malformed error body as `Occurrence[]`.

### WR-03: observed_at parsed with new Date() — timezone handling produces wrong dates

**Files modified:** `infra/lib/edge-handler/index.ts`
**Commit:** eb556aa
**Applied fix:** Introduced a normalized `observedAt` variable that appends `'Z'` when `observed_at` contains no timezone indicator (no trailing `Z` and no `+` offset). Both the `date` and `time` `Intl.DateTimeFormat` calls now use `observedAt` instead of the raw `occ.observed_at`.

### WR-04: CDK stack uses this.account (dynamic) inconsistently with hard-coded certificate ARN

**Files modified:** `infra/lib/infra-stack.ts`
**Commit:** 57d1462
**Applied fix:** Extracted `const ACCOUNT_ID = '648183724555'` as a module-level constant in `infra-stack.ts` and replaced both the IAM policy ARN (`${this.account}` → `${ACCOUNT_ID}`) and the ACM certificate ARN (literal string → template literal with `${ACCOUNT_ID}`) to use a single source of truth.

---

_Fixed: 2026-04-17_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
