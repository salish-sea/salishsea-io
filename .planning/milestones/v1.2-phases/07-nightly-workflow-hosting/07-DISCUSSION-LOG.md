# Phase 7: Nightly Workflow & Hosting - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 07-nightly-workflow-hosting
**Areas discussed:** Atomic publish mechanism, Empty/under-threshold guard, Schedule + DB secret + AWS role, Failure surfacing + bot UA edge case

---

## Atomic publish mechanism

### Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Staging prefix + S3 server-side copy | Sync to `.staging/`, then S3 CopyObject each into final name. Brief inconsistency window but simpler than per-run dirs. | |
| Per-run dated dir + pointer rewrite | Publish under `runs/YYYY-MM-DD/`, single-object pointer flip last. Adds indirection for Phase 8. | |
| Single-file overwrite, no atomicity guarantee | Just `aws s3 sync` final names; accept ~tens-of-seconds inconsistency. Lowest ceremony. | ✓ |
| Pointer file (manifest.json) | Dated artifacts + atomic flip on a single manifest object. Most robust, most ceremony. | |

**User's choice:** Single-file overwrite. Accept brief inconsistency window for a v1.2 download-only artifact with no SLA.

### Upload order

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, upload checksums last | parquet → zip → parquet.sha256 → zip.sha256. Costs nothing; hides the window from hash-verifying clients. | ✓ |
| Don't care, any order | Simpler script, default `aws s3 sync` ordering. | |

**User's choice:** Checksums last. (P-02 in CONTEXT.md.)

---

## Empty/under-threshold guard

### Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Hard floor only | Stateless, refuse if zip < N bytes or rows < M. | ✓ |
| Relative-to-last (% drop) | Fetch last published archive; refuse if new < X% of last. | |
| Both hard floor AND relative drop | Belt-and-braces. | |
| Hard floor only, conservative | Generous floor only. | |

**User's choice:** Hard floor only.

### Floor values

| Option | Description | Selected |
|--------|-------------|----------|
| Conservative: zip > 50 KB, rows > 1,000 | Wide safety margin; catches obvious breakage; easy to tighten later. | ✓ |
| Tight: zip > 1 MB, rows > 100,000 | Catches subtle thinning; risk of false positives if scope narrows. | |
| Let planner pick from current data | Empirical floor at ~20% of observed actuals. | |

**User's choice:** Conservative — `zip > 50 KB`, `rows > 1,000`. (G-02.)

### On trip behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Fail the GHA job, no S3 touch | Workflow exits non-zero; yesterday's archive untouched. | |
| Fail loudly with diff | Same as above plus structured details (row count vs. floor, sizes, which guard tripped). | ✓ |

**User's choice:** Fail loudly with structured diff. (G-04.)

---

## Schedule, DB secret & AWS role

### Schedule

| Option | Description | Selected |
|--------|-------------|----------|
| 09:00 UTC (02:00 PT / 01:00 PST) | Late night Pacific, avoids morning deploy overlap. | ✓ |
| 08:00 UTC (01:00 PT / 00:00 PST) | Midnight-PST clean mental model. | |
| 11:00 UTC (04:00 PT / 03:00 PST) | Pre-dawn Pacific; cron drift doesn't matter. | |

**User's choice:** 09:00 UTC. (S-01.)

### DB connection

| Option | Description | Selected |
|--------|-------------|----------|
| Direct DB URL via service-role pwd, secret `SUPABASE_DB_URL` | Port 5432 direct URL, service-role pwd. Matches Phase 6's expected env var. | ✓ |
| Pooler URL (pgbouncer transaction mode), `SUPABASE_DB_URL` | Port 6543 pooler. Lower confidence with DuckDB ATTACH. | |
| Two-part secret: read-only role + password | Dedicated `dwca_export` Postgres role. More plumbing. | |

**User's choice:** Direct DB URL, secret name `SUPABASE_DB_URL`. Confirmation gate before first push (C-02).

### AWS role

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `arn:aws:iam::648183724555:role/salishsea-deploy-action` | Already has S3 sync + invalidation perms. | ✓ |
| Add a tighter `salishsea-dwca-publish` role | Per-purpose IAM; small CDK change. | |

**User's choice:** Reuse existing role. (C-03.)

### CloudFront invalidation

| Option | Description | Selected |
|--------|-------------|----------|
| Invalidate `/dwca/*` (wildcard) | Single invalidation; covers all four artifacts. | ✓ |
| Invalidate exact filenames | Four-path invalidation. | |

**User's choice:** Wildcard. (I-01.)

---

## Failure surfacing + bot UA edge case

### Failure surfacing

| Option | Description | Selected |
|--------|-------------|----------|
| Default GHA email only | Lowest ceremony. | |
| GHA email + auto-open GitHub issue | Easier to track consecutive failures. | ✓ |
| GHA email + post to Sentry | Centralized with app errors. | |

**User's choice:** GHA email + auto-open GitHub issue (deduped against existing open issue). (O-01.)

### Post-publish verification

| Option | Description | Selected |
|--------|-------------|----------|
| Smoke fetch + sha verify | GET via CDN, recompute sha256, compare. Catches CDN + Lambda@Edge issues. | ✓ |
| Just HEAD the URL (200 check) | Fast but doesn't catch content mismatch. | |
| None — trust S3 sync + invalidation | Simplest. | |

**User's choice:** Smoke fetch + sha verify. (V-01.)

### Bot UA gate for /dwca/*

| Option | Description | Selected |
|--------|-------------|----------|
| Path-gate Lambda@Edge to skip `/dwca/*` | One-line carve-out at top of `edge-handler/index.ts`. | ✓ |
| Accept it; crawlers rarely fetch archive URLs | No code change, small residual risk. | |
| Path-gate + add `/dwca/` to robots.txt | Belt-and-braces SEO. | |

**User's choice:** Path-gate the Lambda. (L-01.) Lambda change must ship via `deploy.yml` BEFORE the first nightly run.

---

## Claude's Discretion

- Step-level details inside the workflow (action version pins to match `deploy.yml`, `npm ci` caching).
- Smoke-check tool choice (`curl` + `sha256sum` vs. a small `scripts/dwca/verify-publish.ts`).
- Auto-issue title/body format and the dedupe lookup mechanism (label or title match).
- Whether `scripts/dwca/guard.ts` is its own module or inlined in the workflow.
- Exact assertion message format for G-04.
- `aws cloudfront wait invalidation-completed` vs. sleep + retry before V-01.
- `workflow_dispatch` inputs (none required; planner may add a `skip-publish` dry-run input).

## Deferred Ideas

- Per-run dated archive snapshots (`runs/YYYY-MM-DD/`).
- `manifest.json` / `index.json` pointer file — defer until Phase 8 surfaces a real need.
- Relative-to-last-successful guard (% drop check).
- Tighter `salishsea-dwca-publish` IAM role.
- Sentry integration for nightly failures.
- Automated GBIF online-validator hit on every nightly publish.
