# Phase 7: Nightly Workflow & Hosting - Research

**Researched:** 2026-06-18
**Domain:** GitHub Actions scheduled workflow + S3 publish + CloudFront invalidation (CI/CD)
**Confidence:** HIGH

## Summary

Phase 7 wraps Phase 6's working `npm run build:dwca` in a scheduled GitHub Actions workflow
that publishes the DwC-A archive + GeoParquet sidecar (plus `.sha256` sidecars) to the
existing S3 bucket `salishsea-io` under key prefix `site/dwca/`, served by the existing
CloudFront distribution at `https://salishsea.io/dwca/…`. All required infrastructure
(bucket, distribution, OIDC role) already exists and is in use by `deploy.yml`. The
CONTEXT.md authored 2026-06-18 has already resolved every meaningful architectural choice
— this research's job is to **verify** those decisions against the codebase + AWS/GH docs,
fill in the small handful of mechanical specifics the planner needs (action SHAs, CLI
flags, cron caveats, dedupe pattern for failure issues), and document the integration
contract for the planner.

The single biggest finding is affirmative: **CloudFront has exactly one behavior**
(`defaultBehavior`) attached to a single S3 origin with `originPath: /site`, no path-based
rewrites, no SPA fallback function. `/dwca/*` URLs map to S3 key `site/dwca/*` and pass
straight through — **except** that a Lambda@Edge OG-meta interceptor runs on every
viewer-request and would return synthesized HTML for any bot-UA hit (Facebook, Twitter,
Slack, Discord, WhatsApp, Telegram, Baiduspider, Bluesky, google-snippet). The CONTEXT
L-01 carve-out (`if (request.uri.startsWith('/dwca/')) return request;` at the top of
`handler`) is necessary and must ship via the existing CDK deploy pipeline **before** the
first nightly run.

**Primary recommendation:** Mirror `deploy.yml`'s OIDC-then-`aws s3 cp` pattern verbatim
into a new standalone `.github/workflows/dwca-nightly.yml` with cron `0 9 * * *` UTC and
`workflow_dispatch`. Use the **AWS CLI directly** (not a third-party action) for `s3 cp`,
`s3 sync`, `cloudfront create-invalidation`, and `cloudfront wait invalidation-completed`
— `deploy.yml` already establishes the pattern and the role allows it. For the failure
issue (O-01) use `peter-evans/create-issue-from-file@v6.0.0` with an explicit dedupe step
via `actions/github-script` that searches open issues by title before deciding
create-vs-comment.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Schedule & trigger:**
- **S-01:** Cron `0 9 * * *` UTC (= 02:00 PT / 01:00 PST). UTC literal, no timezone conversion.
- **S-02:** `workflow_dispatch` enabled for manual re-runs.

**Atomic publish (EXPORT-03):**
- **P-01:** Single-file overwrite, no staging prefix, no per-run dated dir, no manifest pointer. Accept ~seconds of inconsistency window during upload.
- **P-02:** Upload order = `parquet`, `zip`, `parquet.sha256`, `zip.sha256` (checksums LAST).
- **P-03:** Stable filenames — `salishsea-occurrences-v1.zip`, `salishsea-occurrences-v1.parquet`, and `<name>.sha256` for each. No date stamping.

**Empty/under-threshold guard (EXPORT-03):**
- **G-01:** Hard floor only — no relative-to-last comparison. Stateless.
- **G-02:** Initial floor values: `zip size > 50 KB` AND `dwc.occurrences row count > 1,000`.
- **G-03:** Guard runs in the publish step, *between* `build:dwca` and the S3 upload (Phase 6's own 0-row/0-byte guard fires first inside `build.ts`).
- **G-04:** On trip — fail loudly, no S3 touch. Workflow exits non-zero. Failure message includes a structured diff (row count vs. floor, zip bytes vs. floor, which guard tripped).

**DB connection & AWS auth:**
- **C-01:** New GH Actions secret `SUPABASE_DB_URL` in the `production` environment. Format: `postgres://postgres.<project_ref>:<service_role_password>@db.<project_ref>.supabase.co:5432/postgres` (port 5432 direct, not 6543 pooler — DuckDB ATTACH needs direct).
- **C-02:** USER ACTION required before first deploy. Planner must surface this in the checklist; executor must not push without confirmation.
- **C-03:** Reuse existing OIDC role `arn:aws:iam::648183724555:role/salishsea-deploy-action`. No new IAM, no CDK change for IAM.
- **C-04:** S3 destination key prefix = `s3://salishsea-io/site/dwca/`. CloudFront `originPath: /site` strips the prefix so public URLs are `salishsea.io/dwca/…`.

**CloudFront invalidation & smoke verification:**
- **I-01:** Invalidate `/dwca/*` (single wildcard path). One invalidation against the 1000/mo free tier.
- **V-01:** Post-publish smoke check = HEAD/GET + sha verify. GET `https://salishsea.io/dwca/salishsea-occurrences-v1.zip` and confirm sha256 matches the published `.zip.sha256`.

**Lambda@Edge bot-UA carve-out:**
- **L-01:** Path-gate the OG-meta Lambda@Edge to skip `/dwca/*`. Add `if (request.uri.startsWith('/dwca/')) return request;` at top of `handler` in `infra/lib/edge-handler/index.ts` **before** the bot-UA check.
- **L-02:** Lambda edit ships through the normal CDK deploy flow (`deploy.yml`). One-time commit to `main`, not done by the nightly workflow. Add a unit test in `infra/lib/edge-handler/index.test.ts`.

**Failure surfacing (observability):**
- **O-01:** Failed runs → default GHA email + auto-open (or reopen / comment on existing) GitHub issue with title `dwca-nightly-failed`. Workflow uses `if: failure()` step.
- **O-02:** Successful runs are silent beyond the smoke-check log line and the green GHA badge.

**Workflow file shape:**
- **W-01:** New file `.github/workflows/dwca-nightly.yml`, **separate from `deploy.yml`**. No coupling to push-to-`main`.
- **W-02:** Single job. Uses `environment: production` to access `SUPABASE_DB_URL` secret and `vars.S3_BUCKET` / `vars.CLOUDFRONT_DISTRIBUTION_ID`.
- **W-03:** `concurrency: dwca-nightly` with `cancel-in-progress: false` — if manual dispatch and cron overlap, queue the second.

### Claude's Discretion

The planner picks the following without surfacing to the user:

- **Step-level action versions** — match `deploy.yml`'s pinned SHAs.
- **Smoke check tool** — `curl -sSf` + `sha256sum`, or a small TS script `scripts/dwca/verify-publish.ts`. Planner picks whichever is more legible.
- **GitHub issue title/body format** for O-01 — recommend "DwC-A nightly publish failed (YYYY-MM-DD)" with run link and guard-diff payload.
- **Whether `scripts/dwca/guard.ts` is its own module** or lives inline in the workflow as a small Node `-e` script. The TS module is preferred for testability.
- **Exact assertion message format** for G-04 — JSON-ish single-line plus a human-readable line, or just the human-readable line.
- **CloudFront invalidation wait** — `aws cloudfront wait invalidation-completed` is the textbook choice.
- **`workflow_dispatch` inputs** — none required; planner may add a `skip-publish` boolean for dry-run testing.

### Deferred Ideas (OUT OF SCOPE)

- Per-run dated archive snapshots (`dwca/runs/2026-06-18/…`).
- `manifest.json` / `index.json` pointer file with checksums + run timestamp.
- Relative-to-last-successful guard (e.g., refuse on > 20% row-count drop).
- Tighter `salishsea-dwca-publish` IAM role (principle of least privilege).
- Sentry integration for nightly failures.
- Automated GBIF online-validator hit on every nightly publish (Phase 6 deferred this; Phase 7 inherits).

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXPORT-01 | A scheduled job regenerates the archive automatically every night at a defined time/timezone. | Resolved by S-01 + S-02 (`0 9 * * *` UTC + `workflow_dispatch`). GHA cron caveats documented below (recognition delay, inactive-repo skip — not concerns here since repo is active). |
| EXPORT-02 | Archive published to existing S3/CloudFront, reachable at stable public URL `/dwca/…`, no new AWS infra. | Affirmatively resolved: `infra/lib/infra-stack.ts:67-69` confirms `originPath: /site`, L83-95 confirms single default behavior with no path rewrite. C-03/C-04 reuses bucket + OIDC role. L-01 closes the Lambda@Edge interception edge case. |
| EXPORT-03 | Publication is atomic (write-then-swap), refuses to overwrite a good archive with an empty/under-threshold result, invalidates the CloudFront cache. | P-01..P-03 + G-01..G-04 + I-01. "Atomic" interpreted as "checksum-LAST upload order" — see Architecture Patterns §Pattern 1. |
| EXPORT-04 | A sha256 checksum is published alongside the archive and verifies against the downloaded file. | Sidecar `.sha256` files for both `.zip` and `.parquet`. V-01 smoke check verifies. See Architecture Patterns §Pattern 2 for the bundled `<sha-hex>  <filename>` GNU coreutils format. |
| EXPORT-05 | GeoParquet sidecar regenerated and published with same atomic-publish + guard + invalidation + checksum treatment. | Single workflow handles both artifacts symmetrically. P-02 upload order interleaves parquet + zip. G-02 guard applies to zip; planner may add a parquet-size floor (mentioned in CONTEXT). |

</phase_requirements>

## Project Constraints (from CLAUDE.md / project memory)

CLAUDE.md does not exist at the project root. The following constraints come from
the user's global CLAUDE.md and from `MEMORY.md`:

- **Pushes to `main` auto-deploy to production** via `.github/workflows/deploy.yml`. The new `dwca-nightly.yml` is *not* a push-triggered workflow but lives in the same `.github/workflows/` tree — committing it will not trigger a deploy; the L-01 Lambda change *will*.
- **Before adding env vars / secrets, tell the user and wait for confirmation before pushing.** This is the C-02 gate. The planner MUST include a `checkpoint:human-verify` task "Confirm `SUPABASE_DB_URL` is set in GitHub Actions production environment" before the first push of the workflow that requires it.
- **AWS profile for local CLI work: `orcasound`.** The workflow itself uses OIDC, not the local profile; this only matters if the executor exercises a local `aws s3 ls` during validation.
- **Node version is project-controlled via `.nvmrc` + `package.json#engines.node`.** Current values: `.nvmrc` = `24.13`, `engines.node` = `^24.10`. The workflow uses `actions/setup-node` with `node-version-file: package.json` (mirrors `deploy.yml:21-22`).
- **GSD workflow preference: skip pattern-mapper in `--auto --chain`.** Not directly relevant to Phase 7 plan structure, but confirms the planner should consume RESEARCH directly.
- **Maintain READMEs separately** — Phase 7 may want to add a brief operator note for the workflow but does NOT need to write project-level docs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schedule trigger (cron + manual) | GitHub Actions (CI) | — | GHA `on.schedule` / `on.workflow_dispatch` — no need for an external scheduler at v1.2 SLA. |
| DB read + archive build | GitHub Actions runner (compute) | Supabase (PostgreSQL) | Existing `build.ts` runs in-process via DuckDB ATTACH; runner is a stateless compute box. |
| Threshold guard (G-01..G-04) | GitHub Actions step (Node CLI) | — | Stateless check between local files and config thresholds — no S3 round-trip needed. |
| Object publish | S3 | — | Single bucket already exists; `aws s3 cp` from runner. |
| Edge serving | CloudFront | Lambda@Edge | Distribution exists; L-01 carve-out ensures the Lambda passes `/dwca/*` through. |
| Cache invalidation | CloudFront API | — | `aws cloudfront create-invalidation` + `wait invalidation-completed`. |
| Smoke verification | GitHub Actions step (HTTP + sha256) | CloudFront | After invalidation, runner fetches the public URL and verifies checksum. |
| Failure notification | GitHub Issues + email | — | GHA default email + auto-issue via `peter-evans/create-issue-from-file` with dedupe via `actions/github-script`. |

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| `actions/checkout` | `de0fac2e4500dabe0009e67214ff5f5447ce83dd` (v6) | Source checkout. | Match `deploy.yml:15`. [VERIFIED: codebase grep] |
| `actions/setup-node` | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` (v6) | Pin Node from `package.json`. | Match `deploy.yml:20`. [VERIFIED: codebase grep] |
| `aws-actions/configure-aws-credentials` | `acca2b1b2070338fb9fd1ca27ecee81d687e58e5` (v6) | OIDC role assumption. | Match `deploy.yml:63`. [VERIFIED: codebase grep] |
| AWS CLI v2 | preinstalled on `ubuntu-latest` | S3 upload + CloudFront invalidation/wait. | `deploy.yml:80-81` uses it directly. [VERIFIED: codebase grep] |
| `peter-evans/create-issue-from-file` | `fca9117c27cdc29c6c4db3b86c48e4115a786710` (v6.0.0) | Open failure issue (O-01). | Standard GH ecosystem action. [VERIFIED: github tag, web confirmed] |
| `actions/github-script` | match `deploy.yml` if present, else pin v7+ latest | Dedupe step (search open issues by title). | First-party action; lets us avoid a second third-party dep. [CITED: github-script v8 changelog] |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| Phase 6's `npm run build:dwca` | already in `package.json` | Produce `dist/dwca/salishsea-occurrences-v1.{zip,parquet}` + CSVs. | Always — the wrapped operation. [VERIFIED: codebase] |
| `sha256sum` (coreutils) | preinstalled on `ubuntu-latest` | Generate `<name>.sha256` sidecar in standard `<hex>  <filename>` format. | The smoke check uses `sha256sum -c` for round-trip verify. [CITED: GNU coreutils manual] |
| `curl -sSf` | preinstalled on `ubuntu-latest` | V-01 smoke check fetch. | `-sSf` = silent + show-errors + fail-on-HTTP-4xx/5xx. [CITED: curl manual] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `aws s3 cp` for each file | `aws s3 sync dist/dwca/ s3://…/site/dwca/` | `sync` would upload everything at once and would surface the inconsistency window the CONTEXT P-02 explicitly addresses by ordering. Use `cp` per file in the documented order. [VERIFIED: P-02 decision] |
| `peter-evans/create-issue-from-file` | `actions/github-script` alone (REST `issues.create`) | github-script alone works but the file-content + label ergonomics of peter-evans is cleaner for the multi-line guard-diff body. Pin both. [ASSUMED — ergonomics judgment] |
| `aws cloudfront wait invalidation-completed` | Sleep + retry loop | Waiter is the AWS-blessed pattern; ~10 min max wait, 20s poll, exit 255 on timeout. [CITED: AWS CLI docs] |
| External scheduler (k8s CronJob, EventBridge) | — | Overkill at v1.2 SLA. GHA cron has known delay/skip caveats but they don't matter for a nightly export with no hard time-window. [CITED: GitHub community discussions] |

**Installation:** No `npm install` step needed for the workflow itself. The workflow runs
`npm ci` to pull in Phase 6's already-locked deps (`@duckdb/node-api`, `yazl`, `tsx`).
GitHub Actions used by the workflow are referenced by SHA, not installed.

**Version verification:**
```bash
# Already verified — pinned SHAs match deploy.yml lines 15, 20, 63:
grep -n "@de0fac2e4500dabe0009e67214ff5f5447ce83dd" .github/workflows/deploy.yml   # checkout v6
grep -n "@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e" .github/workflows/deploy.yml   # setup-node v6
grep -n "@acca2b1b2070338fb9fd1ca27ecee81d687e58e5" .github/workflows/deploy.yml   # configure-aws-credentials v6
# peter-evans/create-issue-from-file v6.0.0 SHA verified via GitHub release page 2026-06-18:
# fca9117c27cdc29c6c4db3b86c48e4115a786710
```

## Package Legitimacy Audit

> No npm packages installed by this phase. The wrapped Phase 6 build already includes
> `@duckdb/node-api@1.5.4-r.1`, `yazl@3.3.1`, `tsx@^4.22.4` — all audited at Phase 6
> closeout. The only "external supply chain" surface in Phase 7 is the set of GitHub
> Actions referenced by SHA.

| Action | Source | SHA pinned | slopcheck | Disposition |
|--------|--------|-----------|-----------|-------------|
| `actions/checkout@v6` | github.com/actions (official) | de0fac2e… | n/a (first-party) | Approved — already in deploy.yml [VERIFIED: codebase grep] |
| `actions/setup-node@v6` | github.com/actions (official) | 48b55a01… | n/a (first-party) | Approved — already in deploy.yml [VERIFIED: codebase grep] |
| `aws-actions/configure-aws-credentials@v6` | github.com/aws-actions (official) | acca2b1b… | n/a (first-party) | Approved — already in deploy.yml [VERIFIED: codebase grep] |
| `peter-evans/create-issue-from-file@v6.0.0` | github.com/peter-evans | fca9117c… | unavailable (slopcheck CLI not installed) | **Approved with caveat** — widely-used (peter-evans maintains the create-pull-request standard set; v6.0.0 published 2025-10-01); SHA pin makes a supply-chain swap visible in PR review. Planner MUST gate the install behind a `checkpoint:human-verify` task referencing the SHA. [ASSUMED — author reputation, not slopcheck-confirmed] |
| `actions/github-script@vN` | github.com/actions (official) | TBD (planner picks v8 or v7) | n/a (first-party) | Approved [VERIFIED: github.com/actions] |

**Packages removed due to slopcheck [SLOP] verdict:** none — slopcheck was not available.
**Packages flagged as suspicious [SUS]:** none observed by manual inspection. peter-evans/
create-issue-from-file is a well-known action (5k+ stars; the same author publishes
create-pull-request and create-or-update-comment, both ubiquitous in GH ecosystem).

> **slopcheck was unavailable at research time (no `pip` on this Mac). Per the package
> legitimacy protocol, peter-evans/create-issue-from-file is tagged `[ASSUMED]` and the
> planner must gate its first use behind a `checkpoint:human-verify` task confirming the
> v6.0.0 SHA `fca9117c27cdc29c6c4db3b86c48e4115a786710` resolves on github.com.**

## Architecture Patterns

### System Architecture Diagram

```
                  ┌─────────────────────────────┐
                  │ GitHub Actions cron         │
                  │ schedule: '0 9 * * *' UTC   │
                  │ workflow_dispatch (manual)  │
                  └────────────┬────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────────────┐
        │ dwca-nightly.yml  (environment: production)      │
        │                                                  │
        │  1. checkout repo                                │
        │  2. setup-node from package.json                 │
        │  3. npm ci                                       │
        │  4. configure-aws-credentials (OIDC)             │
        │  5. npm run build:dwca                           │
        │     env: SUPABASE_DB_URL  (secret)               │
        │     reads: db.<ref>.supabase.co:5432 (direct)    │
        │     writes: dist/dwca/{*.zip, *.parquet, *.txt}  │
        │  6. compute sha256 sidecars                      │
        │     dist/dwca/salishsea-occurrences-v1.zip.sha256│
        │     dist/dwca/...-v1.parquet.sha256              │
        │  7. THRESHOLD GUARD (G-01..G-04)                 │
        │     fail-loudly if zip<50KB OR rows<1000         │
        │     (else continue)                              │
        │  8. upload to S3 in order (P-02):                │
        │     a. parquet                                   │
        │     b. zip                                       │
        │     c. parquet.sha256                            │
        │     d. zip.sha256                                │
        │  9. create-invalidation /dwca/*                  │
        │ 10. wait invalidation-completed (≤10min)         │
        │ 11. smoke verify (V-01):                         │
        │     curl + sha256sum -c                          │
        │                                                  │
        │ if: failure() ⇒ open/comment dwca-nightly-failed │
        └────────────────────┬─────────────────────────────┘
                             │ (OIDC, role-to-assume)
                             ▼
                   ┌────────────────────────┐
                   │ AWS arn:…role/         │
                   │ salishsea-deploy-action│
                   └──┬─────────────────┬──┘
                      │                 │
                      ▼                 ▼
              ┌──────────────┐  ┌────────────────────────┐
              │ S3           │  │ CloudFront             │
              │ salishsea-io │  │ {DISTRIBUTION_ID}      │
              │ /site/dwca/  │  │ originPath=/site       │
              └──────┬───────┘  │ Lambda@Edge OG-meta    │
                     │          │ (passes /dwca/* thru)  │
                     │◄─────────┤                        │
                     │          └────────────┬───────────┘
                     │                       │
                     │                       ▼
                     │            ┌────────────────────────┐
                     └───────────►│ https://salishsea.io/  │
                                  │ dwca/...               │
                                  └────────────────────────┘
                                           ▲
                                           │ smoke check (step 11)
                                           │ + downstream Phase 8 link
```

### Recommended Project Structure

```
.github/workflows/
└── dwca-nightly.yml          # new — single-job workflow, ~80 lines
infra/lib/edge-handler/
├── index.ts                  # MODIFIED — add L-01 path gate at top of handler
└── index.test.ts             # MODIFIED — add /dwca/* pass-through test cases
scripts/dwca/
├── build.ts                  # FROZEN (Phase 6) — workflow calls via npm script
├── guard.ts                  # NEW — under-threshold check; importable from workflow
├── verify-publish.ts         # NEW (optional) — smoke check; or inline curl+sha256sum
└── *.test.ts                 # NEW — guard + verify-publish unit tests
.planning/phases/07-nightly-workflow-hosting/
└── (this RESEARCH.md and the plan files the planner will create)
```

### Pattern 1: Checksum-LAST atomic publish (interpretation of "atomic write-then-swap" on S3)

**What:** S3 has no rename. The CONTEXT P-01/P-02 interpretation of "atomic" is: do the
**upload order** such that any consumer that fetches `(artifact, sidecar)` and verifies
sees a consistent pair, even mid-publish.

**Why checksum-LAST works:**
- A naive consumer that grabs only the artifact may briefly see today's zip while
  yesterday's sha256 is still live (briefly inconsistent). They'd get a mismatch on
  verification — annoying but the correct safety failure.
- A naive consumer that fetches the sha256 first then the artifact (the typical pattern
  for `sha256sum -c`) will always see one of two valid states: yesterday's pair or
  today's pair. Never mismatched.
- The window is ~seconds, not minutes, because the parquet (largest) ships first and the
  two small sha256 files (tens of bytes each) ship last.

**When to use:** Whenever you need "good-enough atomicity" on an object store without a
manifest layer. Acceptable for v1.2; the deferred manifest.json pattern is the future
upgrade if a real consumer SLA emerges.

**Example:**
```bash
# Source: synthesized from CONTEXT P-02; mirrors deploy.yml:80 patterns
aws s3 cp dist/dwca/salishsea-occurrences-v1.parquet        s3://salishsea-io/site/dwca/salishsea-occurrences-v1.parquet
aws s3 cp dist/dwca/salishsea-occurrences-v1.zip            s3://salishsea-io/site/dwca/salishsea-occurrences-v1.zip
aws s3 cp dist/dwca/salishsea-occurrences-v1.parquet.sha256 s3://salishsea-io/site/dwca/salishsea-occurrences-v1.parquet.sha256
aws s3 cp dist/dwca/salishsea-occurrences-v1.zip.sha256     s3://salishsea-io/site/dwca/salishsea-occurrences-v1.zip.sha256
```

### Pattern 2: GNU coreutils sha256 sidecar format

**What:** Produce a sidecar file with one line per artifact in the standard format
`<64-hex>␣␣<filename>` (two spaces; binary mode `*` separator would write the asterisk).

**Why standard:** `sha256sum -c <name>.sha256` (preinstalled everywhere) verifies the
artifact in-place if the listed filename is in the current directory. Downstream
consumers (DataCite, GBIF, manual verifiers, future Phase 8 frontend) recognize the
format without any custom parsing. The SRI `.sri` format (`sha256-<base64>`) is for
inline HTML/JS use, not file integrity — the wrong tool for a download artifact.

**Example:**
```bash
# Source: GNU coreutils sha256sum manual
# Produces e.g.:  3a7bd3e2360a3d6e...  salishsea-occurrences-v1.zip
cd dist/dwca/
sha256sum salishsea-occurrences-v1.zip     > salishsea-occurrences-v1.zip.sha256
sha256sum salishsea-occurrences-v1.parquet > salishsea-occurrences-v1.parquet.sha256

# Smoke check after publish (round-trip):
curl -sSfO https://salishsea.io/dwca/salishsea-occurrences-v1.zip
curl -sSfO https://salishsea.io/dwca/salishsea-occurrences-v1.zip.sha256
sha256sum -c salishsea-occurrences-v1.zip.sha256  # exits 0 on match, non-0 on mismatch
```

### Pattern 3: OIDC role assumption (verbatim mirror of deploy.yml)

**What:** Use a short-lived OIDC token to assume the existing IAM role; no long-lived AWS
access keys in GH secrets.

**Why:** `deploy.yml:62-66` already does this; the role already permits `s3:PutObject` on
`salishsea-io` and `cloudfront:CreateInvalidation`. No new IAM needed.

**Example:**
```yaml
# Source: .github/workflows/deploy.yml:52-66
permissions:
  id-token: write       # required for OIDC
  contents: read
# ...
- name: Configure AWS Credentials
  uses: aws-actions/configure-aws-credentials@acca2b1b2070338fb9fd1ca27ecee81d687e58e5  # v6
  with:
    role-to-assume: arn:aws:iam::648183724555:role/salishsea-deploy-action
    aws-region: us-west-2
```

### Pattern 4: CloudFront invalidation + waiter

**What:** Create the invalidation, capture the `Id`, then block until it propagates.

**Why use the waiter:** `aws cloudfront wait invalidation-completed` polls every 20s and
exits 255 after ~10 min if the invalidation hasn't completed. This is the textbook
pattern; without the wait, V-01's smoke check could race against a still-cached edge
location.

**Example:**
```bash
# Source: AWS CLI v2 docs (cloudfront wait invalidation-completed)
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "${DISTRIBUTION_ID}" \
  --paths '/dwca/*' \
  --query 'Invalidation.Id' --output text)

aws cloudfront wait invalidation-completed \
  --distribution-id "${DISTRIBUTION_ID}" \
  --id "${INVALIDATION_ID}"
# At this point all edge locations have either purged or are about to (eventual consistency)
```

### Pattern 5: Failure-issue dedupe via github-script

**What:** Before opening a new issue with title `dwca-nightly-failed`, search for an open
issue with the same title; if it exists, comment on it instead of opening a new one.

**Why:** Without dedupe, a 3-night failure streak spawns 3 separate issues. CONTEXT
specifies (in Specific Ideas) that the auto-opened failure issue should be deduplicated.

**Example:**
```yaml
# Source: actions/github-script docs + REST issues.listForRepo + create-issue-from-file v6.0.0
# Note: prefer a single-step approach via search-issues; structured as two steps for clarity.

- name: Find existing failure issue
  id: find-issue
  if: failure()
  uses: actions/github-script@<pin-sha>
  with:
    script: |
      const issues = await github.rest.issues.listForRepo({
        owner: context.repo.owner,
        repo: context.repo.repo,
        state: 'open',
        labels: 'dwca-nightly-failed',
        per_page: 1,
      });
      core.setOutput('issue-number', issues.data[0]?.number ?? '');

- name: Open or comment failure issue
  if: failure()
  uses: peter-evans/create-issue-from-file@fca9117c27cdc29c6c4db3b86c48e4115a786710  # v6.0.0
  with:
    title: "DwC-A nightly publish failed (${{ github.run_id }})"
    content-filepath: ./guard-diff.txt
    labels: dwca-nightly-failed
    issue-number: ${{ steps.find-issue.outputs.issue-number }}  # updates if set, creates if empty
```

### Anti-Patterns to Avoid

- **Naive `aws s3 sync dist/dwca/ s3://…/site/dwca/`.** Defeats the P-02 checksum-LAST
  ordering; sync uploads in an unspecified order. Use per-file `aws s3 cp` in the
  documented order.
- **Computing sha256 *after* upload by GET-ing the object back.** Round-trips the LAN and
  introduces a window where the object exists but the sidecar doesn't. Compute locally
  *before* upload; that's the value the sidecar must match.
- **Skipping the L-01 carve-out and trusting GH Actions' runner UA.** The runner UA does
  not match any of the BOT_AGENTS list (none of `facebookexternalhit`, `twitterbot`,
  etc.), so the smoke check would coincidentally succeed today. **But** the V-01 smoke
  check would silently break the day a downstream consumer with a flagged UA tried to
  fetch the archive (or the BOT_AGENTS list expands). The carve-out is the correct fix.
- **Cron `0 2 * * *` "for PST".** GHA cron is UTC-only; this would run at 10:00 UTC =
  03:00 PT during PST and 02:00 PT during PDT (DST drift). Use `0 9 * * *` UTC literal
  per S-01.
- **`workflow_dispatch` inputs that default to "skip guard"** or anything that would let
  a manual run sidestep G-01..G-04. Guards exist precisely so a sleepy operator can't
  publish an empty archive. Stay parameter-free or limit to a `dry-run` boolean that
  skips S3 writes entirely.
- **Pinning third-party actions by tag (`@v6`) instead of SHA.** Pinning by SHA is the
  CONTEXT convention (every action in deploy.yml is SHA-pinned). Tag pins allow silent
  upstream code changes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schedule trigger | Custom cron daemon | GHA `on.schedule` | Built-in; respects `workflow_dispatch` overlay. [CITED: GH Actions docs] |
| AWS credentials in CI | Long-lived access keys in `secrets.AWS_ACCESS_KEY_ID` | OIDC via `aws-actions/configure-aws-credentials@v6` | Already implemented in `deploy.yml`; short-lived tokens; no key rotation. [VERIFIED: codebase] |
| S3 multi-file upload | Custom Python `boto3` script | `aws s3 cp` per file in documented order | Already CLI-installed on `ubuntu-latest`; mirrors `deploy.yml`. |
| CloudFront invalidation wait | Sleep + retry + curl loop | `aws cloudfront wait invalidation-completed` | AWS-blessed waiter; correct exit codes; documented timeout behavior. [CITED: AWS CLI docs] |
| sha256 generation | Custom Node hash loop | `sha256sum` (coreutils) | Output format is the universal convention; downstream `sha256sum -c` is one line. [CITED: GNU coreutils] |
| Failure issue | Hand-rolled GH REST call | `peter-evans/create-issue-from-file` + `actions/github-script` dedupe | Battle-tested action set from the same author as `create-pull-request`. [ASSUMED — reputation] |
| Issue dedupe | Custom comment search | `actions/github-script` (first-party) + REST `issues.listForRepo` filtered by label | First-party action; no extra third-party dependency. [CITED: actions/github-script docs] |

**Key insight:** Phase 7 has zero novel automation problems. Every operation is something
the existing `deploy.yml` already does or something that has a one-liner CLI / official
GitHub Action. The phase's value is **wiring**, not invention; the planner should
relentlessly prefer copying patterns from `deploy.yml` over inventing new ones.

## Runtime State Inventory

Phase 7 introduces production-touching configuration. The inventory is *forward-looking*
(what we will create), not a rename audit, but the categories still apply.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | None — Phase 7 writes to S3 only, no DB schema or row changes. The wrapped `build.ts` only READs from `dwc.*` views. | None. |
| **Live service config** | (a) New GH Actions secret `SUPABASE_DB_URL` in the `production` environment (not in git). (b) The L-01 Lambda@Edge change ships via CDK to a live CloudFront distribution. | (a) C-02 USER ACTION — user sets secret in GitHub UI before first push; planner must include `checkpoint:human-verify`. (b) L-02 — landed via normal `deploy.yml` flow on commit to `main`. |
| **OS-registered state** | None — workflow is fully ephemeral GHA runners. No Task Scheduler, no systemd, no pm2. | None. |
| **Secrets/env vars** | `SUPABASE_DB_URL` is new and **must be added by hand before the first push that uses it.** Existing prod env has `VITE_BASE_URL`, `VITE_SUPABASE_KEY` (secret, anon — public, not service-role), `VITE_SUPABASE_URL`, `VITE_SUPABASE_WS_URL`, `SENTRY_AUTH_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `DB_PASSWORD`, plus prod env `vars` `S3_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID`, `SUPABASE_PROJECT_ID`. None of these is the service-role direct-connection DSN that Phase 6's `build.ts` needs. | Confirm with user; planner adds `checkpoint:human-verify` before any push of `dwca-nightly.yml`. |
| **Build artifacts** | None for Phase 7 itself. Phase 6's `dist/dwca/` is gitignored and rebuilt per-run. The L-01 Lambda change produces a new `EdgeFunction` version in CDK output (`infra/cdk.out/`) — this is normal CDK behavior, no special handling. | None — CDK manages Lambda versioning. |

**Nothing found in category:** Stored data, OS-registered state, build artifacts — all
explicitly verified above; Phase 7 is purely orchestration.

## Common Pitfalls

### Pitfall 1: GHA cron silently skipping or delaying

**What goes wrong:** GitHub may skip scheduled runs entirely on repositories with no
recent push activity (60-day rule), and even on active repos cron runs are routinely
delayed by minutes (sometimes hours under platform load). New cron schedules can take
15-60+ minutes to be recognized after the first push.

**Why it happens:** GHA cron is a best-effort scheduler over a shared platform; it is
documented as such. There is no SLA.

**How to avoid:**
- The CONTEXT acknowledges this by setting V-01 to be a smoke check on the *run that
  completes*, not on wall-clock time-of-publish. The 09:00 UTC time is well-clear of any
  consumer expectation.
- `workflow_dispatch` is the recovery path: if cron silently no-ops, manual dispatch
  triggers an out-of-cycle run.
- O-01's auto-issue catches *failures*, but not *no-shows*. v1.2 accepts this; a future
  hardening would add a "no run in last 48h" guard via an external pinger.
- Repo is active (recent commits weekly) so the 60-day skip rule does not bite.

**Warning signs:** Issue O-01 not opening when you think it should; check GHA UI for
"workflow run skipped" / "cron not triggered yet" messages, not assume failure.

### Pitfall 2: Lambda@Edge intercepting `/dwca/*` for bot user-agents

**What goes wrong:** Without L-01, any consumer of the published archive whose UA
contains one of `facebookexternalhit`, `twitterbot`, `linkedinbot`, `slackbot`,
`discordbot`, `whatsapp`, `telegrambot`, `baiduspider`, `bsky.social`, `bluesky`,
`google-snippet` (case-insensitive substring match — see `index.ts:3-15`) will receive
synthesized HTML instead of the binary archive. The Slackbot case is the most likely
real-world trigger (someone pastes the link in Slack).

**Why it happens:** The Lambda@Edge runs on every viewer-request as a `VIEWER_REQUEST`
event type (`infra-stack.ts:92-94`), and `isBot()` (`index.ts:17-20`) only checks the UA,
not the path. The current behavior is correct for the SPA root but wrong for `/dwca/*`.

**How to avoid:** L-01 — single-line early return at the top of `handler` (before
`isBot()` check). L-02 unit tests verify both `/dwca/*` bot-UA pass-through and the
existing non-bot pass-through remains. The carve-out must ship via `deploy.yml` BEFORE
the first `dwca-nightly.yml` run.

**Warning signs:** V-01 smoke check fails with HTML in the response body instead of
binary; `curl -sI` shows `Content-Type: text/html; charset=utf-8` instead of
`application/zip` or `application/octet-stream`.

### Pitfall 3: CloudFront caching the old object after publish

**What goes wrong:** Without invalidation, edge locations can serve the previous day's
archive for up to the CachePolicy's default TTL. SalishSea uses `CachingOptimized`
(policy id `658327ea-f89d-4fab-a63d-7e88639e58f6`, `infra-stack.ts:87-89`) which has a
default TTL of 24h. A consumer could fetch yesterday's zip + today's sha256 and get a
verify failure.

**Why it happens:** S3 PUT doesn't propagate to CloudFront edges; CloudFront fetches on
miss / respects TTL on hit.

**How to avoid:** I-01 invalidates `/dwca/*` after every publish. Pattern 4 uses the
waiter to gate V-01 on completion. One invalidation per night = 365/year, well under the
1000/month free tier.

**Warning signs:** V-01 fails immediately after publish; intermittent verify failures
from external consumers in the hour after a run. If observed, check the CloudFront
console for the invalidation status and the `Cache-Control` headers on the S3 object.

### Pitfall 4: DuckDB ATTACH fails on the Supabase pooler port

**What goes wrong:** If `SUPABASE_DB_URL` is built with port 6543 (the Supabase
transaction pooler) instead of 5432 (direct), the DuckDB `ATTACH '${DSN}' AS pgdb (TYPE
postgres, READ_ONLY)` call fails or returns wrong results. Phase 6's RESEARCH addressed
this; Phase 7 inherits the constraint.

**Why it happens:** DuckDB's `postgres` extension expects a direct Postgres connection,
not a transaction-pooled one. The Supabase pooler does not implement the wire-protocol
features the extension relies on.

**How to avoid:** C-01 specifies port 5432 explicitly. The planner should document the
exact DSN format in the C-02 user-action checkpoint so the user pastes the right URL on
the first try.

**Warning signs:** Build step fails with a Postgres protocol error; or with weirdly small
row counts that aren't the expected hundreds of thousands.

### Pitfall 5: Threshold guard tripped by legitimate small-dip dataset

**What goes wrong:** Future scope narrowing (e.g., POLICY §4.1 D-07 native-only fallback)
could drop the `dwc.occurrences` row count from "hundreds of thousands" to under 1000;
G-02 trips and refuses to publish a perfectly correct, intentionally smaller archive.

**Why it happens:** G-02's floor (1000 rows) was chosen assuming the current scope. A
scope change is a legitimate, planned event — but the guard doesn't know that.

**How to avoid:** When a scope change is intentional, lower the G-02 floor in the same
PR. Document the floor in the workflow file inline so it's review-discoverable. CONTEXT
explicitly calls this out ("If a future scope decision intentionally narrows the
dataset, revisit then.")

**Warning signs:** G-04 failure issue opens immediately after a scope-change PR merges.
First-line debug is "did we just narrow the dataset and forget to bump the floor?"

### Pitfall 6: `aws cloudfront wait` timeout

**What goes wrong:** The waiter exits 255 after ~10 minutes (30 × 20s polls). CloudFront
invalidations *usually* complete in 1-2 min but can take longer under platform load.

**Why it happens:** CloudFront propagation is best-effort across hundreds of edge
locations.

**How to avoid:**
- Treat waiter timeout as a *non-fatal* condition for the smoke check: log a warning,
  attempt V-01 with a longer retry budget, fail the workflow only if V-01 itself fails.
  (Planner's discretion — `continue-on-error: true` on the wait step + an explicit smoke
  step with retries.)
- Alternative: accept the failure and let O-01 open an issue; the publish itself
  succeeded, so manual re-invalidation is a 5-second fix.

**Warning signs:** Run takes >10 min; check CloudFront console for the invalidation Id
and observe its actual completion time.

## Code Examples

### Workflow skeleton (mirrors deploy.yml conventions)

```yaml
# Source: synthesized from .github/workflows/deploy.yml + CONTEXT decisions S-01..W-03
name: DwC-A Nightly
on:
  schedule:
    - cron: '0 9 * * *'  # 09:00 UTC = 02:00 PT (PDT) / 01:00 PT (PST)
  workflow_dispatch:

concurrency:
  group: dwca-nightly
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
      contents: read
      issues: write  # for O-01 failure issue
    env:
      ZIP_FLOOR_BYTES: '51200'      # G-02: 50 KB
      ROW_FLOOR: '1000'             # G-02
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6
        with:
          persist-credentials: false
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e  # v6
        with:
          node-version-file: package.json
      - run: npm ci
      - uses: aws-actions/configure-aws-credentials@acca2b1b2070338fb9fd1ca27ecee81d687e58e5  # v6
        with:
          role-to-assume: arn:aws:iam::648183724555:role/salishsea-deploy-action
          aws-region: us-west-2

      - name: Build DwC-A
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: npm run build:dwca

      - name: Compute checksums
        working-directory: dist/dwca
        run: |
          sha256sum salishsea-occurrences-v1.zip     > salishsea-occurrences-v1.zip.sha256
          sha256sum salishsea-occurrences-v1.parquet > salishsea-occurrences-v1.parquet.sha256

      - name: Threshold guard (G-01..G-04)
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: npx tsx scripts/dwca/guard.ts
        # exits non-zero with structured diff if zip<50KB or row count<1000

      - name: Publish to S3 (checksum-LAST order, P-02)
        env:
          DEST: s3://${{ vars.S3_BUCKET }}/site/dwca
        working-directory: dist/dwca
        run: |
          aws s3 cp salishsea-occurrences-v1.parquet        "${DEST}/salishsea-occurrences-v1.parquet"
          aws s3 cp salishsea-occurrences-v1.zip            "${DEST}/salishsea-occurrences-v1.zip"
          aws s3 cp salishsea-occurrences-v1.parquet.sha256 "${DEST}/salishsea-occurrences-v1.parquet.sha256"
          aws s3 cp salishsea-occurrences-v1.zip.sha256     "${DEST}/salishsea-occurrences-v1.zip.sha256"

      - name: Invalidate CloudFront /dwca/*
        id: invalidate
        env:
          DISTRIBUTION_ID: ${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}
        run: |
          INVALIDATION_ID=$(aws cloudfront create-invalidation \
            --distribution-id "${DISTRIBUTION_ID}" \
            --paths '/dwca/*' \
            --query 'Invalidation.Id' --output text)
          echo "id=${INVALIDATION_ID}" >> "$GITHUB_OUTPUT"

      - name: Wait for invalidation
        env:
          DISTRIBUTION_ID: ${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}
        run: |
          aws cloudfront wait invalidation-completed \
            --distribution-id "${DISTRIBUTION_ID}" \
            --id "${{ steps.invalidate.outputs.id }}"

      - name: Smoke verify (V-01)
        run: npx tsx scripts/dwca/verify-publish.ts
        # GETs the public URL + sha256 sidecar; runs sha256sum -c; non-zero on mismatch

      - name: Find existing failure issue
        id: find-issue
        if: failure()
        uses: actions/github-script@<pin-latest-sha>
        with:
          script: |
            const issues = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
              labels: 'dwca-nightly-failed',
              per_page: 1,
            });
            core.setOutput('issue-number', issues.data[0]?.number ?? '');

      - name: Open or update failure issue
        if: failure()
        uses: peter-evans/create-issue-from-file@fca9117c27cdc29c6c4db3b86c48e4115a786710  # v6.0.0
        with:
          title: "DwC-A nightly publish failed (${{ github.run_id }})"
          content-filepath: ./dist/dwca/guard-diff.txt  # guard.ts writes this; smoke step writes its own diff
          labels: dwca-nightly-failed
          issue-number: ${{ steps.find-issue.outputs.issue-number }}
```

### Lambda@Edge L-01 carve-out

```typescript
// Source: CONTEXT L-01 — infra/lib/edge-handler/index.ts, top of handler
export const handler = async (event: any): Promise<any> => {
  const request = event.Records[0].cf.request;

  // L-01: pass /dwca/* through unmodified — these are binary archive downloads,
  // not pages we want to inject OG meta into.
  if (request.uri.startsWith('/dwca/')) {
    return request;
  }

  const ua = request.headers['user-agent']?.[0]?.value ?? '';
  if (!isBot(ua)) {
    return request;
  }
  // ... existing bot-UA branch unchanged
};
```

### Threshold guard module (G-01..G-04)

```typescript
// Source: synthesized from CONTEXT G-01..G-04 + Phase 6 build.ts patterns
// scripts/dwca/guard.ts
import { stat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

const ZIP_PATH = 'dist/dwca/salishsea-occurrences-v1.zip';
const ZIP_FLOOR_BYTES = Number(process.env.ZIP_FLOOR_BYTES ?? 51200);
const ROW_FLOOR = BigInt(process.env.ROW_FLOOR ?? 1000);
const DSN = process.env.SUPABASE_DB_URL;
if (!DSN) throw new Error('SUPABASE_DB_URL required');

async function main() {
  const { size: zipBytes } = await stat(ZIP_PATH);
  const db = await DuckDBInstance.create(':memory:');
  const conn = await db.connect();
  await conn.run(`LOAD postgres`);
  await conn.run(`ATTACH '${DSN}' AS pgdb (TYPE postgres, READ_ONLY)`);
  const result = await conn.runAndReadAll(`SELECT COUNT(*) FROM pgdb.dwc.occurrences`);
  const rowCount = result.getRows()[0][0] as bigint;

  const zipOk = zipBytes > ZIP_FLOOR_BYTES;
  const rowOk = rowCount > ROW_FLOOR;
  if (zipOk && rowOk) {
    console.log(`guard ok: zip=${zipBytes} bytes (>${ZIP_FLOOR_BYTES}), rows=${rowCount} (>${ROW_FLOOR})`);
    return;
  }

  const diff = {
    zip_bytes: Number(zipBytes),
    zip_floor: ZIP_FLOOR_BYTES,
    zip_ok: zipOk,
    row_count: Number(rowCount),
    row_floor: Number(ROW_FLOOR),
    row_ok: rowOk,
  };
  writeFileSync('dist/dwca/guard-diff.txt',
    `DwC-A nightly guard tripped\n\n` +
    `zip bytes:  ${diff.zip_bytes} (floor ${diff.zip_floor}) ${zipOk ? 'OK' : 'FAIL'}\n` +
    `row count:  ${diff.row_count} (floor ${diff.row_floor}) ${rowOk ? 'OK' : 'FAIL'}\n\n` +
    `Yesterday's archive remains the published version.\n` +
    `Raw: ${JSON.stringify(diff)}\n`);

  console.error(`guard tripped: ${JSON.stringify(diff)}`);
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

### Smoke verifier (V-01)

```typescript
// Source: CONTEXT V-01 — scripts/dwca/verify-publish.ts
// Minimal: GET artifact + sha sidecar, hash artifact, compare.
import { createHash } from 'node:crypto';

const BASE = 'https://salishsea.io/dwca';
const NAMES = ['salishsea-occurrences-v1.zip', 'salishsea-occurrences-v1.parquet'];

async function verify(name: string) {
  const [art, sha] = await Promise.all([
    fetch(`${BASE}/${name}`).then(r => { if (!r.ok) throw new Error(`${name} HTTP ${r.status}`); return r.arrayBuffer(); }),
    fetch(`${BASE}/${name}.sha256`).then(r => { if (!r.ok) throw new Error(`${name}.sha256 HTTP ${r.status}`); return r.text(); }),
  ]);
  const expected = sha.trim().split(/\s+/)[0];  // "<hex>  <filename>"
  const actual = createHash('sha256').update(new Uint8Array(art)).digest('hex');
  if (expected !== actual) throw new Error(`${name}: sha mismatch expected=${expected} actual=${actual}`);
  console.log(`${name}: ok (${actual})`);
}

await Promise.all(NAMES.map(verify));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Long-lived AWS access keys in CI | OIDC role assumption via `aws-actions/configure-aws-credentials@v6` | Standard since 2022 | Project already on it; no migration needed. |
| `aws cloudfront create-invalidation` then assume-and-hope | `create-invalidation` + `wait invalidation-completed` waiter | AWS CLI v2.x | Use the waiter for any post-invalidation smoke check. |
| Tag-pinned third-party actions (`@v6`) | SHA-pinned (`@<40-hex>`) | Standard since the tj-actions/changed-files supply-chain incident (March 2025) | Project already on SHA pins in `deploy.yml`. Phase 7 must continue the convention. |

**Deprecated/outdated:**
- `actions/setup-node` versions < v4 (the `engines.node: ^24.10` constraint needs setup-node v4+ to honor `node-version-file: package.json` reliably).
- Hand-rolled "wait for invalidation" curl-loops — superseded by the waiter.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `peter-evans/create-issue-from-file` is a legitimate, well-maintained action with no known supply-chain issues. | Package Legitimacy Audit, Standard Stack | Low — SHA pin makes any future swap visible in PR review. Mitigated by planner checkpoint. |
| A2 | Smoke verifier ergonomics (TS module preferred over inline curl+sha256sum) | Code Examples §V-01 | Trivial — planner picks; both work. |
| A3 | `actions/github-script` v8 is available and recommended for the dedupe step (could be v7 if v8 not yet released) | Pattern 5 | Trivial — planner pins whichever is current at plan time. |
| A4 | The 60-day inactive-repo cron-skip rule does NOT bite this project. | Pitfall 1 | Low — repo has weekly commits; if a long quiet period happens, manual `workflow_dispatch` recovers. |
| A5 | CloudFront `CachingOptimized` policy default TTL is 24h. | Pitfall 3 | Low — even if it's longer, invalidation forces immediate purge; the pitfall arc doesn't change. |

## Open Questions

1. **Should the workflow fail-hard on `aws cloudfront wait` timeout, or continue to V-01 with retries?**
   - What we know: The waiter is documented to exit 255 after ~10 min.
   - What's unclear: Operational preference — fail loud vs. degrade gracefully.
   - Recommendation: `continue-on-error: true` on the wait step; V-01 has an internal retry budget of e.g. 3 attempts with 30s sleep. If V-01 still fails, the workflow fails and O-01 opens an issue.

2. **Should G-02 add an explicit parquet-size floor for symmetry?**
   - What we know: CONTEXT says "Planner may add a parquet-size floor for symmetry."
   - What's unclear: Is the parquet-zip ratio (4.3× smaller per Phase 6 spike) stable enough to make a separate floor worthwhile, or does the row-count floor cover both?
   - Recommendation: Add a parquet-size floor of `>10 KB` for trivial-defense symmetry; document the ratio assumption inline.

3. **Should the failure issue body be the guard diff alone, or include the workflow run URL + last 50 lines of the failing step?**
   - What we know: CONTEXT specifies "link to the run and any captured guard-diff payload."
   - What's unclear: Whether to capture step logs (requires an extra `actions/github-script` call to fetch logs via the API).
   - Recommendation: For v1.2, just the run URL + guard diff. The GHA web UI is one click from the URL; log-scraping is overengineering.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| GitHub Actions runner (`ubuntu-latest`) | Workflow execution | ✓ | runner image (rolling) | — |
| Node.js 24.x | `npm ci` + `tsx` invocations | ✓ | 24.13 (from `.nvmrc` / `package.json#engines`) | — |
| AWS CLI v2 | S3 + CloudFront ops | ✓ (preinstalled on `ubuntu-latest`) | platform-rolling | — |
| `sha256sum` (coreutils) | Checksum sidecars | ✓ (preinstalled on `ubuntu-latest`) | platform-rolling | — |
| `curl` | Smoke check | ✓ (preinstalled on `ubuntu-latest`) | platform-rolling | — |
| `unzip` | Not used in workflow; used by Phase 6's integration test | ✓ (preinstalled on `ubuntu-latest`) | platform-rolling | — |
| AWS IAM role `salishsea-deploy-action` | OIDC assumption | ✓ | already deployed | — |
| S3 bucket `salishsea-io` | Object destination | ✓ | already exists in production (imported by CDK) | — |
| CloudFront distribution (id in `vars.CLOUDFRONT_DISTRIBUTION_ID`) | Cache layer | ✓ | already exists in production | — |
| Supabase prod DB at `db.<ref>.supabase.co:5432` direct | DuckDB ATTACH for build | ✓ (live service) | rolling | — |
| `SUPABASE_DB_URL` secret in GH `production` env | DSN delivery to workflow | ✗ | — | **No fallback** — user MUST set before first push (C-02). Planner inserts a `checkpoint:human-verify`. |
| GBIF DwC-A validator service | DWCA-05 follow-up (NOT Phase 7) | ✗ (offline 2026-06-18) | — | Not needed by Phase 7. Inherited Phase 6 deferral. |

**Missing dependencies with no fallback:**
- `SUPABASE_DB_URL` secret — must be set by user before the first push of `dwca-nightly.yml`.

**Missing dependencies with fallback:** None.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json` — Validation Architecture section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (matches Phase 6's existing `scripts/dwca/*.test.ts` suite); jest for `infra/lib/edge-handler/index.test.ts` (existing) |
| Config file | repo root vitest config (implicit); `infra/jest.config.*` or `infra/package.json` Jest config (existing for the Lambda tests) |
| Quick run command | `npx vitest run scripts/dwca/` (skips DSN-gated integration; runs unit tests for guard + verifier + L-01-affected Lambda tests) |
| Full suite command | `npx vitest run scripts/dwca/` + `cd infra && npm test` |
| Phase gate | both green before `/gsd-verify-work`; plus a one-time `workflow_dispatch` of the deployed workflow as smoke |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXPORT-01 | Cron schedule + workflow_dispatch present and parseable | static check | `node scripts/dwca/lint-workflow.ts` (or yamllint-equivalent) on `.github/workflows/dwca-nightly.yml` | ❌ Wave 0 — workflow file doesn't exist yet |
| EXPORT-01 | First end-to-end run completes (manual `workflow_dispatch`) | smoke (human-verify) | `gh workflow run dwca-nightly.yml && gh run watch` | ❌ Wave 0 — requires C-02 secret set |
| EXPORT-02 | Public URL serves the archive with `Content-Type: application/zip`-ish | integration | `curl -sI https://salishsea.io/dwca/salishsea-occurrences-v1.zip` post-publish | ❌ Wave 0 — gated on first successful run |
| EXPORT-02 | Lambda@Edge passes `/dwca/*` through for bot UAs | unit | `cd infra && npx jest --testPathPattern edge-handler` | ✅ exists; extend with new test cases |
| EXPORT-03 atomic | Upload order is parquet→zip→parquet.sha256→zip.sha256 | static lint | `grep -n 'aws s3 cp' .github/workflows/dwca-nightly.yml` matches expected ordered list | ❌ Wave 0 |
| EXPORT-03 guard | Guard exits non-zero on under-threshold | unit | `npx vitest run scripts/dwca/guard.test.ts` | ❌ Wave 0 |
| EXPORT-03 guard | Guard writes structured diff to guard-diff.txt on fail | unit | same as above; assert file content | ❌ Wave 0 |
| EXPORT-03 invalidation | Invalidation step uses `/dwca/*` | static lint | grep the workflow | ❌ Wave 0 |
| EXPORT-04 | `.sha256` sidecar in coreutils `<hex>  <name>` format | unit | `npx vitest run scripts/dwca/verify-publish.test.ts` — round-trip test | ❌ Wave 0 |
| EXPORT-04 | sha256sum -c on the published artifact succeeds | smoke (post-publish) | V-01 in workflow | ❌ Wave 0 |
| EXPORT-05 | Same atomic+guard+invalidation+checksum treatment for `.parquet` | static lint + unit | grep workflow for both filenames; verifier covers both | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run scripts/dwca/` + (if infra/ touched) `cd infra && npm test`
- **Per wave merge:** Full suite above + `npx tsc -p . --noEmit`
- **Phase gate:** All of the above green + one successful `workflow_dispatch` run against production (this is the `/gsd-verify-work` evidence)

### Wave 0 Gaps

- [ ] `.github/workflows/dwca-nightly.yml` — covers EXPORT-01, EXPORT-02 (workflow plumbing), EXPORT-03 (orchestration), EXPORT-05 (parallel treatment)
- [ ] `scripts/dwca/guard.ts` — covers EXPORT-03 (under-threshold refusal)
- [ ] `scripts/dwca/guard.test.ts` — unit tests for guard
- [ ] `scripts/dwca/verify-publish.ts` — covers EXPORT-04 (post-publish checksum verify); optional inline curl+sha256sum
- [ ] `scripts/dwca/verify-publish.test.ts` — unit tests for verifier sha parsing
- [ ] `infra/lib/edge-handler/index.ts` — MODIFIED for L-01 carve-out
- [ ] `infra/lib/edge-handler/index.test.ts` — extended with `/dwca/*` pass-through assertions (bot UA + non-bot UA both)
- [ ] No new test framework install needed — vitest and jest both already in use.

## Security Domain

`security_enforcement` defaults to enabled (no explicit `false` in config).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | OIDC role assumption (no long-lived credentials); GH `id-token: write` permission scoped to the publish job only. |
| V3 Session Management | no | No user session; workflow is a one-shot job. |
| V4 Access Control | yes | (a) `environment: production` gates secret access; (b) IAM role policy limits to `salishsea-io` bucket + this distribution's invalidation; (c) `permissions:` block in workflow grants only `id-token: write`, `contents: read`, `issues: write` — no `actions: write`, no `packages: *`. |
| V5 Input Validation | partial | Workflow consumes `vars.S3_BUCKET` / `vars.CLOUDFRONT_DISTRIBUTION_ID` from the production environment — trusted source. `SUPABASE_DB_URL` is a secret, never echoed; planner must avoid `run: echo "$SUPABASE_DB_URL"`-style debug. No user input to the workflow. |
| V6 Cryptography | yes | sha256 via GNU coreutils (FIPS-acceptable). Never hand-roll; never use MD5/SHA-1 for new sidecars. |
| V14 Configuration | yes | All third-party actions SHA-pinned (not tag-pinned). `permissions:` block explicitly enumerated. `environment: production` ties secret access to the protected environment. |

### Known Threat Patterns for the Phase 7 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised third-party Action (e.g., tj-actions/changed-files March 2025) | Tampering / Elevation | SHA pin every external action; review the SHA at plan time; planner adds `checkpoint:human-verify` for `peter-evans/create-issue-from-file` first install. |
| DSN leak to logs | Information Disclosure | Never `echo` the secret; pass via `env:` to child processes. Phase 6's `build.ts` already implements `maskDsn()` for any error path. Guard module follows the same pattern (no DSN in error messages). |
| Over-broad OIDC role permissions | Elevation of Privilege | Documented (D-04 in CONTEXT) — `salishsea-deploy-action` permits `/site/*` writes including SPA, slightly broader than needed. Accepted for v1.2. Deferred tightening to a `salishsea-dwca-publish` role. |
| Replay of OIDC token | Spoofing | Tokens are short-lived; the role's trust policy is scoped to this GitHub org/repo. AWS-side responsibility. |
| Workflow-injection via `workflow_dispatch` input | Tampering | Workflow has no `workflow_dispatch.inputs` (or only a `dry-run` boolean validated as boolean by GHA). No string interpolation into shell commands from user input. |
| S3 public bucket misconfiguration exposing other site content | Information Disclosure | Bucket already exists in production with the SPA assets; `/site/dwca/` is just a sub-prefix. No bucket policy change needed. |
| CloudFront serving stale archive after publish | Information Disclosure (downstream wrong-data) | I-01 invalidation + V-01 smoke check + sha verification close the loop. |
| Lambda@Edge intercepting binary download (L-01 missing) | Tampering (response substitution) | L-01 path gate is **mandatory** before first nightly run. Without it, any bot-UA crawler gets HTML instead of binary — silent data substitution. |

## Sources

### Primary (HIGH confidence)

- **Codebase grep** (all line citations independently verifiable):
  - `.github/workflows/deploy.yml` — OIDC role ARN (L65), env-and-secret pattern (L30-34), aws-actions/configure-aws-credentials@v6 SHA (L63), `aws s3 sync` + `create-invalidation` (L80-81), action SHA pins (L15, 20, 37, 57, 61, 68, 83).
  - `.github/workflows/build.yml` — verifies repo's vitest test posture (L40 `npm test`).
  - `.github/workflows/smoke.yml` — verifies existing cron pattern + container usage (model for failure-issue dedupe step).
  - `infra/lib/infra-stack.ts:66-69` — S3 bucket name + `originPath: /site` (basis for C-04).
  - `infra/lib/infra-stack.ts:72-97` — single CloudFront `defaultBehavior`, no path-based rewrites, single edge Lambda — resolves the ROADMAP Research flag affirmatively.
  - `infra/lib/edge-handler/index.ts:3-15, 17-20, 94-100` — BOT_AGENTS list + `isBot()` + handler entry — basis for L-01.
  - `infra/lib/edge-handler/index.test.ts` — existing Jest test posture; basis for L-02 carve-out tests.
  - `package.json` — `build:dwca` script + `engines.node: ^24.10` + Phase 6 deps.
  - `.nvmrc` — `24.13`.
  - `.planning/phases/06-archive-generation/06-VERIFICATION.md` — what Phase 6 guarantees (DWCA-01..04/06 satisfied; DWCA-05 deferred independent of Phase 7).
  - `.planning/phases/06-archive-generation/06-06-SUMMARY.md` — `dist/dwca/` artifact paths and sizes; DSN-gating pattern Phase 7 inherits.

- **AWS CLI v2 docs** — `aws cloudfront wait invalidation-completed` polling and exit-code behavior. https://docs.aws.amazon.com/cli/latest/reference/cloudfront/wait/invalidation-completed.html

- **GitHub Actions docs** — `on.schedule` cron syntax (5-field, UTC-only); `on.workflow_dispatch`; `concurrency`; `permissions:` semantics; `environment:` gating of secrets. (Standard ref; not relinked per-claim.)

### Secondary (MEDIUM confidence)

- **peter-evans/create-issue-from-file v6.0.0** — release page on GitHub confirms tag SHA `fca9117c27cdc29c6c4db3b86c48e4115a786710`, published 2025-10-01. Standard inputs (`title`, `content-filepath`, `labels`, `issue-number`) verified via README. https://github.com/peter-evans/create-issue-from-file/releases/tag/v6.0.0
- **GHA cron reliability** — multiple community discussions confirm best-effort scheduling, occasional delays/skips, and the 60-day inactive-repo rule. https://github.com/orgs/community/discussions/156282 ; https://github.com/orgs/community/discussions/185355
- **GNU coreutils sha256sum format** — universal `<hex>  <name>` two-space convention; `-c` flag verifies in place.

### Tertiary (LOW confidence)

- None used. All architectural claims trace to either the codebase or first-party docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every pinned SHA verified in `deploy.yml`; peter-evans tag SHA verified via release page.
- Architecture (CloudFront layout / Lambda@Edge behavior): HIGH — read directly from `infra-stack.ts` + `index.ts`; no inference needed.
- Pitfalls: HIGH — derived from Phase 6 RESEARCH (DuckDB port), Phase 7 CONTEXT (Lambda interception, guard semantics), AWS CLI docs (waiter timeout), GH community (cron reliability).
- Pattern recommendations: HIGH — every pattern either copied verbatim from `deploy.yml` or directly documented in AWS/GH docs.
- Package legitimacy (peter-evans/create-issue-from-file): MEDIUM-HIGH — well-known author, SHA pinned, but slopcheck not available to formally rate; planner inserts a checkpoint.

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (30 days — stable AWS APIs, stable repo, no fast-moving deps; the only thing that could invalidate this faster is a CloudFront / IAM policy change in production).
