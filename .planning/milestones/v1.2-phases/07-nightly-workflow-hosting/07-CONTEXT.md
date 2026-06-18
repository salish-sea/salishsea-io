# Phase 7: Nightly Workflow & Hosting - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers a **scheduled GitHub Actions workflow** that nightly runs Phase 6's existing `npm run build:dwca`, then publishes the produced artifacts — `salishsea-occurrences-v1.zip`, `salishsea-occurrences-v1.parquet`, and `.sha256` sidecars for each — to the **existing S3 bucket + CloudFront distribution** under `https://salishsea.io/dwca/…`, with an empty/under-threshold guard, CloudFront cache invalidation, and a post-publish smoke verification.

**Scope:**
- New workflow file `.github/workflows/dwca-nightly.yml` (cron + `workflow_dispatch`).
- A small carve-out in `infra/lib/edge-handler/index.ts` so the Lambda@Edge OG-meta interceptor passes `/dwca/*` through unmodified.
- Publication script(s) in `scripts/dwca/` for the guard, checksums, ordered upload, invalidation, and smoke verification (called by the workflow; not bundled into the SPA).

**Out of scope:**
- Phase 6's archive generation logic — frozen, wrapped only.
- Phase 8 — the user-facing download link/page.
- New AWS infrastructure: no new bucket, no new CloudFront distribution, no new IAM role.
- GBIF/OBIS registration; manifest/index.json for downstream consumers (deferred).

Requirements covered: EXPORT-01..EXPORT-05.

</domain>

<decisions>
## Implementation Decisions

### Schedule & trigger

- **S-01:** Cron fires at **`0 9 * * *`** (09:00 UTC = 02:00 PT / 01:00 PST). Late-night Pacific, lowest site activity, and well clear of typical morning deploys to `main`. GHA cron is UTC-only — no timezone conversion to do.
- **S-02:** Workflow supports `workflow_dispatch` as well — manual re-runs are explicitly required by ROADMAP §"Phase 7" success criterion 1.

### Atomic publish (EXPORT-03)

- **P-01: Single-file overwrite, no cross-file atomicity guarantee.** No staging prefix, no per-run dated dir, no manifest pointer. We accept that during the ~seconds of the upload, a downloader could in principle observe inconsistent state. Acceptable for v1.2 download-only artifact with no SLA and no concurrent consumers.
- **P-02: Upload order = `parquet`, `zip`, `parquet.sha256`, `zip.sha256` (checksums LAST).** A hash-verifying client either sees yesterday's complete pair or today's complete pair — never a zipNew/shaOld mismatch. Costs nothing; makes the inconsistency window mostly invisible to careful consumers.
- **P-03: Filenames are stable** — `salishsea-occurrences-v1.zip`, `salishsea-occurrences-v1.parquet`, and `<name>.sha256` for each. Slug matches Phase 6's local output and POLICY §6.3's `occurrences-v1`. No date stamping; today's archive overwrites yesterday's at the same key.

### Empty/under-threshold guard (EXPORT-03)

- **G-01: Hard floor only — no relative-to-last comparison.** Stateless guard; no need to fetch the prior published archive to evaluate. Easy to understand and tune; tightening from a hard floor is trivial later.
- **G-02: Initial floor values: `zip size > 50 KB` AND `dwc.occurrences row count > 1,000`.** Conservative starting values — won't trip on legitimate small dips, will catch obvious breakage (empty/near-empty result). Planner may add a parquet-size floor for symmetry.
- **G-03: Where the guard runs:** in the publish step, *between* Phase 6's `build:dwca` and the S3 upload. Phase 6's existing 0-row / 0-byte guard fires first inside `build.ts`; G-01/G-02 is the **stronger** check that refuses to overwrite a good archive with an under-threshold one.
- **G-04: On trip — fail loudly, no S3 touch.** Workflow exits non-zero. Yesterday's archive remains the published one (untouched). Failure message includes a **structured diff** (this-run row count vs. floor, this-run zip bytes vs. floor, which guard tripped) so triage doesn't require re-running locally.

### DB connection & AWS auth

- **C-01: New GH Actions secret `SUPABASE_DB_URL` in the `production` environment.** Full pre-formed Postgres URL with the service-role password: `postgres://postgres.<project_ref>:<service_role_password>@db.<project_ref>.supabase.co:5432/postgres` (port 5432, **not** the 6543 pooler — DuckDB ATTACH needs direct connection). Matches the env-var name already anticipated by Phase 6's `build.ts`.
- **C-02: USER ACTION required before first deploy.** Per project memory ("If a deploy requires a new env var, tell the user and wait for confirmation before pushing"), Phase 7's first push must wait until the user confirms `SUPABASE_DB_URL` is set in the GitHub `production` environment. Planner must surface this in the plan checklist; executor must not push without confirmation.
- **C-03: Reuse existing OIDC role `arn:aws:iam::648183724555:role/salishsea-deploy-action`.** Already permits S3 sync and `cloudfront:CreateInvalidation`; no new IAM, no CDK change for IAM. Slightly broader than strictly needed (it can also write `/site/*` for the SPA) but acceptable — the workflow only writes `/site/dwca/*`.
- **C-04: S3 destination key prefix = `s3://salishsea-io/site/dwca/`.** CloudFront's `originPath: /site` means public URLs at `salishsea.io/dwca/foo` map to S3 key `site/dwca/foo`. Confirmed from `infra/lib/infra-stack.ts:67-69`.

### CloudFront invalidation & smoke verification

- **I-01: Invalidate `/dwca/*` (single wildcard path).** One invalidation against the 1000/mo free tier. Ensures all newly-uploaded files served fresh.
- **V-01: Post-publish smoke check = HEAD/GET + sha verify.** After invalidation completes, the workflow GETs `https://salishsea.io/dwca/salishsea-occurrences-v1.zip` and confirms its sha256 matches the published `.zip.sha256` sidecar. Catches CDN cache weirdness, Lambda@Edge interception edge cases (see L-01), and partial uploads. Adds ~30s; declares success only when this check passes.

### Lambda@Edge bot-UA carve-out

- **L-01: Path-gate the OG-meta Lambda@Edge to skip `/dwca/*`.** Add an early return at the top of `infra/lib/edge-handler/index.ts` *before* the bot-UA check:
  ```ts
  if (request.uri.startsWith('/dwca/')) return request;
  ```
  Without this, a crawler UA (FB, Twitter, Slack, bluesky, google-snippet) hitting a `/dwca/*` URL would receive synthesized OG HTML instead of the binary archive. The carve-out also makes V-01's smoke check robust against future UA-list expansions.
- **L-02: Update + ship the Lambda edit through the normal CDK deploy flow (deploy.yml).** This is not done by the nightly workflow — it's a one-time CDK change committed to `main`, deployed via the existing deploy pipeline. Add a unit test for the carve-out in `infra/lib/edge-handler/index.test.ts`.

### Failure surfacing (observability)

- **O-01: Failed runs → default GHA email + auto-open GitHub issue.** Workflow uses a final `if: failure()` step to open (or reopen) a `dwca-nightly-failed` issue with the failing job's structured output and a link to the run. Easier to track consecutive failures and to keep history; tracks well alongside Phase 7's own commits. No Sentry integration for v1.2.
- **O-02: Successful runs are silent** beyond the smoke-check log line and the green GHA badge.

### Workflow file shape

- **W-01:** New file `.github/workflows/dwca-nightly.yml`, **separate from `deploy.yml`**. No coupling to push-to-`main`.
- **W-02:** Single job is sufficient (no build/deploy split needed — there's no artifact handoff between hosts). Job uses `environment: production` to access the `SUPABASE_DB_URL` secret and `vars.S3_BUCKET` / `vars.CLOUDFRONT_DISTRIBUTION_ID`.
- **W-03:** `concurrency: dwca-nightly` with `cancel-in-progress: false` — if a manual dispatch and the cron overlap, queue the second rather than cancel.

### Claude's Discretion

The planner picks the following without surfacing to the user:

- **Step-level details inside the workflow** — exact `actions/checkout@…`, `actions/setup-node@…` versions (match `deploy.yml`); `npm ci` caching; whether to pin `aws-actions/configure-aws-credentials` to the same SHA used elsewhere.
- **Smoke check tool** — `curl -sSf` + `sha256sum`, or a small TS script under `scripts/dwca/verify-publish.ts` that reuses the same field-list / hashing utilities as `build.ts`. Planner picks whichever is more legible.
- **GitHub issue title/body format** for O-01 — recommend "DwC-A nightly publish failed (YYYY-MM-DD)" with a link to the run and any captured guard-diff payload.
- **Whether `scripts/dwca/guard.ts` is its own module** or lives inline in the workflow as a small Node `-e` script. The TS module is preferred for testability; trivial enough that either works.
- **Exact assertion message format** for G-04 — JSON-ish single-line plus a human-readable line, or just the human-readable line. Planner picks.
- **CloudFront invalidation wait** — `aws cloudfront wait invalidation-completed` before the V-01 smoke check, or sleep + retry. The waiter is the textbook choice.
- **`workflow_dispatch` inputs** — none required; planner may add a `skip-publish` boolean for dry-run testing if it helps.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 6 — what we wrap

- `.planning/phases/06-archive-generation/06-CONTEXT.md` — Phase 6 decisions; especially the "Claude's Discretion" entries on local output paths (`dist/dwca/salishsea-occurrences-v1.{zip,parquet}`) and DB env-var consumption.
- `.planning/phases/06-archive-generation/06-VERIFICATION.md` — what Phase 6 already guarantees (0-row / 0-byte refusal, field-list assertion). G-01..G-04 layer the **stronger** under-threshold guard on top.
- `.planning/phases/06-archive-generation/06-RESEARCH.md` — DuckDB ATTACH transport details; informs the C-01 port-5432-not-6543 decision.
- `scripts/dwca/build.ts` — Phase 6's orchestrator. Phase 7's workflow runs `npm run build:dwca` which invokes this. **Do not modify** — Phase 7 is pure consumer code.
- `package.json` — confirm `build:dwca` script exists and `npm ci` works in CI.

### Phase 4 policy

- `.planning/phases/04-rights-data-model-policy-gate/04-POLICY.md` §6.3 — `dataset_id = 'occurrences-v1'` slug, the basis for the `salishsea-occurrences-v1.*` published filenames (P-03).

### Existing infra (DO read these)

- `infra/lib/infra-stack.ts` — CDK source. Read **lines 66-97** specifically:
  - L66-69: S3 bucket name `salishsea-io`, originPath `/site` (the basis for C-04's S3 key prefix).
  - L72-97: the single CloudFront `defaultBehavior` — confirms no SPA fallback, single behavior for all paths including `/dwca/*`. Resolves the ROADMAP "Research flag" affirmatively: no extra CloudFront behavior is needed.
  - L83-95: the `edgeLambdas` block — Lambda@Edge runs on **every** viewer-request, hence L-01.
- `infra/lib/edge-handler/index.ts` — the OG-meta Lambda. L-01 adds a `/dwca/*` early-return at the top of `handler`. Test file is `index.test.ts`.
- `.github/workflows/deploy.yml` — reference for: the OIDC role ARN (line 65, basis for C-03), `vars.S3_BUCKET` / `vars.CLOUDFRONT_DISTRIBUTION_ID` (lines 77-78), and `aws-actions/configure-aws-credentials` pinning convention. **Do not modify**.

### Milestone scope

- `.planning/REQUIREMENTS.md` — Phase 7 requirements EXPORT-01..EXPORT-05.
- `.planning/ROADMAP.md` §"Phase 7" — phase goal, five success criteria, the Research flag (resolved), and the Secret flag (driven by C-01/C-02).
- `.planning/PROJECT.md` — overall milestone scope.

### GitHub Actions docs (cron + concurrency + issue create)

- GitHub Actions cron syntax — https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule. UTC-only; supports 5-field cron.
- `actions/github-script` (or `peter-evans/create-issue-from-file`) — for the O-01 auto-issue. Planner picks.
- `aws-actions/configure-aws-credentials` OIDC — https://github.com/aws-actions/configure-aws-credentials. Already in use by `deploy.yml`.

### AWS CLI references (used in the workflow)

- `aws s3 sync` / `aws s3 cp` — standard CLI; the upload step.
- `aws cloudfront create-invalidation` — used by `deploy.yml` already.
- `aws cloudfront wait invalidation-completed` — gates the V-01 smoke check.

### Project memory (must respect)

- Production env vars live in the GitHub Actions `production` environment (Settings → Environments → production). **Existing**: `VITE_BASE_URL`, `VITE_SUPABASE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_WS_URL`. **New for Phase 7**: `SUPABASE_DB_URL`. Surface this and wait for user confirmation before the first push that requires it (C-02).
- AWS profile for local CLI work: `orcasound` (only relevant if planner/executor exercises an `aws s3 ls` locally; the workflow uses OIDC, not the local profile).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`deploy.yml` is a working OIDC-against-AWS template.** Lines 62-66 (configure-aws-credentials), 80-81 (`aws s3 sync` + `aws cloudfront create-invalidation`), 30-34 (`environment: production` + `vars.*`) — all directly mirrorable into `dwca-nightly.yml`. No new patterns to invent.
- **Phase 6's `build:dwca` is the whole "build" step.** The workflow does not need to know anything about CSV/Parquet/EML internals — just `npm ci && npm run build:dwca` and check exit code.
- **`@duckdb/node-api` is already a dep** (added in Phase 6). The nightly job's `npm ci` brings it along with no extra setup.
- **`infra/lib/edge-handler/index.ts` has a clean handler shape** with the bot-UA branch at the top of `handler`. The L-01 carve-out is a one-line prepend with an existing test file ready to extend.

### Established Patterns
- **OIDC, never long-lived AWS keys.** `deploy.yml` already uses `id-token: write` + `role-to-assume`. `dwca-nightly.yml` follows the same pattern.
- **Production secrets / vars live in the GH `production` environment**, not at repo level. C-01 follows this.
- **CloudFront invalidation after S3 sync.** `deploy.yml:81` invalidates `/` after a sync. Phase 7 does the same, scoped to `/dwca/*`.
- **CDK-managed edge handler ships via the existing deploy pipeline.** L-01's Lambda carve-out lands in a normal commit to `main`, deployed via `deploy.yml`, *before* the first nightly run.

### Integration Points
- **Upstream input:** Phase 6's `dist/dwca/salishsea-occurrences-v1.zip` and `.parquet`. Stable contract — Phase 6 owns these paths.
- **Downstream output:** Phase 8 reads the published URL `https://salishsea.io/dwca/salishsea-occurrences-v1.zip` (and the `.parquet`). Phase 7's contract with Phase 8: stable public URL, stable filename, always-fresh-after-cron content, sha256 sidecar available for integrity verification if Phase 8 wants to surface it.
- **No DB schema change.** Phase 7 is purely orchestration; the `dwc` schema, source tables, and Phase 6's code are untouched.
- **No app runtime touch.** The SPA, Lit components, and Vite build are unaffected — the only `src/` adjacent change is the Lambda@Edge carve-out in `infra/`, which only affects viewer-request routing for `/dwca/*`.

</code_context>

<specifics>
## Specific Ideas

- **Cron at `0 9 * * *` UTC** is the *literal* cron expression. Don't drift to `0 2 * * *` (PST) — GHA cron does not honor a timezone.
- **First-deploy gate.** The plan MUST include a step labeled "Confirm `SUPABASE_DB_URL` is set in GH Actions `production` environment" before the first push of `dwca-nightly.yml`. Executor will halt and ask the user; do not bypass this.
- **Lambda@Edge change must deploy BEFORE the first nightly run.** Otherwise V-01's smoke check could fail on a UA-classified-as-bot request from GHA. Order: (1) merge L-01 + L-02 to `main`, (2) wait for `deploy.yml` to ship the new Lambda version, (3) then trigger the first nightly via `workflow_dispatch` to validate end-to-end, (4) then leave the cron to run nightly.
- **G-02's floor values are deliberately loose.** Today's `dwc.occurrences` row count is in the hundreds of thousands (most are Maplify). Refusing at `> 1,000` rows just catches catastrophic failure modes. If a future scope decision intentionally narrows the dataset (e.g., native-only fallback per POLICY §4.1 D-07), revisit then.
- **The auto-opened failure issue (O-01) should be deduplicated.** If an existing open `dwca-nightly-failed` issue exists, comment on it rather than open a new one — so a 3-night failure streak doesn't spawn 3 separate issues.
- **The L-01 path-gate should use `startsWith('/dwca/')`** not a regex — the path is fully under our control, no ambiguity.

</specifics>

<deferred>
## Deferred Ideas

- **Per-run dated archive snapshots** (e.g., `dwca/runs/2026-06-18/…`). Useful for researchers tracking dataset drift over time; explicitly out of v1.2 (overwrite-in-place is enough for download-only). Could be added as a separate workflow that copies the stable file into a dated key — non-disruptive future addition.
- **manifest.json / index.json pointer file** listing canonical filenames + checksums + run timestamp. Adds robustness and an SLO-friendly indirection but requires Phase 8 buy-in. Defer until Phase 8 surfaces a real need.
- **Relative-to-last-successful guard** (e.g., refuse on > 20% row-count drop). Stronger than G-01 but requires reading the prior published archive's row count (or storing a separate counter object in S3). Defer until we see a real drift event the hard floor misses.
- **Tighter `salishsea-dwca-publish` IAM role.** Principle-of-least-privilege win, but reusing the existing role (C-03) is cheaper and acceptable. Revisit if security review flags the broad role.
- **Sentry integration for nightly failures.** GitHub-issue + email is enough for v1.2. Revisit when GBIF/OBIS registration introduces user-visible SLAs.
- **Automated GBIF online-validator hit on every nightly publish** — Phase 6 already deferred this; Phase 7 inherits the deferral. Manual validator upload only when the field-list / EML changes meaningfully.

</deferred>

---

*Phase: 07-nightly-workflow-hosting*
*Context gathered: 2026-06-18*
