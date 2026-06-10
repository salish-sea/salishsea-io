# Stack Research

**Domain:** Nightly DarwinCore Archive (DwC-A) export + hosting for an existing static-SPA whale-sighting platform
**Researched:** 2026-06-09
**Confidence:** HIGH

## TL;DR Recommendation

**Generate the DwC-A in a scheduled GitHub Actions workflow (Node/TypeScript), upload the zip to the existing S3 site bucket under a public path, and invalidate CloudFront — reusing the exact mechanisms the `deploy.yml` workflow already uses.**

This is **option (b)** from the question. It wins decisively because every integration point it needs already exists and is proven in production:

- The `deploy` job in `.github/workflows/deploy.yml` already assumes the AWS IAM role `arn:aws:iam::648183724555:role/salishsea-deploy-action` via OIDC and runs `aws s3 sync … s3://${S3_BUCKET}/site` + `aws cloudfront create-invalidation`. The export job does the same two AWS calls with zero new infra.
- `.github/workflows/smoke.yml` already demonstrates the exact scheduling pattern we need: `schedule: cron` + `workflow_dispatch` + a `production` environment binding. We copy it.
- The CloudFront distribution (`infra/lib/infra-stack.ts`) serves the `salishsea-io` bucket with `originPath: '/site'`. A file written to `s3://salishsea-io/site/dwca/occurrences.zip` is therefore publicly downloadable at **`https://salishsea.io/dwca/occurrences.zip`** with no behavior/origin changes.
- The frontend already holds a Supabase client and key; the workflow already has `VITE_SUPABASE_URL` + `VITE_SUPABASE_KEY` available in the `production` environment.

No new AWS infra, no new IAM role, no Edge Function runtime to learn, no Postgres-side file I/O. The build is plain Node/TS, which matches the entire codebase (TS 5.9, Node 24).

## Why NOT the other two options

**(a) pg_cron → Supabase Edge Function (Deno) building the zip:** Workable, but adds a whole second runtime (Deno) and deployment surface the project doesn't currently use (`supabase/functions/` does not exist yet). Edge Functions have CPU/memory/time limits (wall-clock and memory caps) that make assembling a multi-file zip with potentially large CSVs riskier than a 7-minute GitHub runner with gigabytes of RAM. Getting the zip to the public S3 site still requires AWS credentials inside the function (storing an AWS access key in Supabase secrets) OR a second hop through Supabase Storage with a different public URL/domain than `salishsea.io`. More moving parts, more secrets, a new runtime — for no benefit here.

**(c) Postgres-side generation (pg_cron + plpgsql/COPY + zip):** Postgres can `COPY` a query to CSV, but server-side `COPY TO '/file'` is **not available on Supabase's managed Postgres** (no superuser filesystem access), and Postgres has no native zip facility. You'd be bolting on `plpython`/external extensions that Supabase doesn't grant, then still need to get the bytes out to S3. This fights the platform. Reject.

The decisive factor: **the public download must live at `https://salishsea.io/…` (the existing CloudFront/S3 site), and the workflow that already writes to that exact bucket+CDN is GitHub Actions.** Option (b) is the path of least new infrastructure.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| GitHub Actions (scheduled workflow) | n/a | Nightly trigger + compute to build and publish the archive | Already the deploy/CI substrate; `smoke.yml` proves the `schedule`+`workflow_dispatch`+`production`-env pattern; has the AWS OIDC role and Supabase env vars already wired |
| Node.js | 24.x (per `.nvmrc` / `package.json`) | Runtime for the export script | Matches the codebase; `actions/setup-node` with `node-version-file` already used everywhere |
| TypeScript | 5.9.3 (repo current) | Author the export script type-safely against the DB schema | Whole codebase is strict TS; can reuse `database.types.ts` types for the `occurrences` view |
| AWS CLI (preinstalled on `ubuntu-latest`) | n/a | `aws s3 cp` the zip + `aws cloudfront create-invalidation` | Identical to the publish step already in `deploy.yml`; no SDK dependency needed |
| CloudFront + S3 (existing) | existing distribution | Hosts the zip at `https://salishsea.io/dwca/...` | `originPath: '/site'` means `/site/dwca/occurrences.zip` → public URL with no infra change |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `archiver` | **8.0.0** (published 2026-05-08) | Stream-write the `.zip` (meta.xml, eml.xml, occurrence.txt, multimedia.txt, …) | Primary zip builder. Streaming API keeps memory flat even for large cores; battle-tested, actively maintained |
| `postgres` (porsager) | **3.4.9** | Direct Postgres connection to run the occurrence query / read the `public.occurrences` view | Preferred over the JS REST client for a bulk export: streams rows, no 1000-row `max_rows` API cap, server-side filtering. Connect via the Supabase pooler connection string |
| `csv-stringify` (from `csv` package family) | **6.7.0** | Emit DwC tab/CSV files (`occurrence.txt`, `multimedia.txt`) with correct quoting/escaping | Stream transform that pairs cleanly with `archiver`; DwC text files are simple delimited text, this handles edge cases (embedded delimiters/newlines in free-text fields) |
| (XML: hand-written template strings) | n/a | `meta.xml` and `eml.xml` are small, fixed-shape XML documents | Generate with template literals + a tiny escape helper. Do **not** pull a heavy XML builder; these files are static-structure with a handful of interpolated values. `fast-xml-parser` (already a dep, 5.3.5) can be used for its builder if a dependency-free approach is preferred, but plain templates are clearest |

**Alternative to `postgres` + `csv-stringify`:** `@supabase/supabase-js` (2.108.1) is already a project dependency and could page through the `occurrences` view via PostgREST. Acceptable for small datasets, but the `[api] max_rows = 1000` cap in `supabase/config.toml` forces explicit pagination and the REST round-trips are slower for a full export. Use the direct `postgres` connection unless the dataset is trivially small.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| GBIF DwC-A validator (https://www.gbif.org/tools/data-validator) | Validate the produced archive end-to-end | Not in the nightly pipeline; run manually during development. Confirms `meta.xml` ↔ file/column alignment before shipping |
| `unzip -l` + a local run script | Smoke-check the zip locally | Add an `npm run` script that builds the archive against local Supabase (`http://127.0.0.1:54321`) for iteration |

## Installation

```bash
# Export-script runtime deps (add to root package.json, used only by the workflow script)
npm install archiver postgres csv-stringify

# Types for archiver (csv-stringify and postgres ship their own types)
npm install -D @types/archiver
```

No AWS SDK needed — the workflow shells out to the preinstalled `aws` CLI exactly as `deploy.yml` does.

## The Exact Data Path (DB query → public URL)

1. **Trigger:** `schedule: cron: '0 11 * * *'` (UTC) in a new `.github/workflows/export-dwca.yml`, plus `workflow_dispatch` for manual runs. (Note: the existing `nightly-vacuum` pg_cron job runs at `0 11 * * *` UTC = 4am PT; pick a non-conflicting hour for the export, e.g. `0 12 * * *`.)
2. **Auth to data:** Job binds to the `production` GitHub environment → gets `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` (and, if using a direct connection, a `SUPABASE_DB_URL`/`DB_PASSWORD` — `DB_PASSWORD` already exists as a secret in `deploy.yml`).
3. **Query:** Node script connects (porsager `postgres` via pooler, or `supabase-js`) and `SELECT`s from `public.occurrences`, filtered to native SalishSea.io + Maplify/Whale Alert sources (exclude iNaturalist & Happywhale). For the Multimedia extension, join occurrence photos. Walk the `taxa` hierarchy for DwC classification fields.
4. **Assemble:** `archiver` opens a zip stream; pipe `csv-stringify` output into `occurrence.txt` and `multimedia.txt` entries; append `meta.xml` and `eml.xml` (template strings). Finalize to a local file, e.g. `./out/occurrences.zip`.
5. **Auth to AWS:** `aws-actions/configure-aws-credentials@v6` assumes `role/salishsea-deploy-action` (same role/region `us-west-2` as `deploy.yml`). `id-token: write` permission required on the job.
6. **Publish:** `aws s3 cp ./out/occurrences.zip s3://${S3_BUCKET}/site/dwca/occurrences.zip --content-type application/zip` then `aws cloudfront create-invalidation --distribution-id ${CLOUDFRONT_DISTRIBUTION_ID} --paths '/dwca/*'`.
7. **Download:** Publicly available at `https://salishsea.io/dwca/occurrences.zip`. The frontend adds a static link/button to that URL.

## DwC-A file contract (what the script must emit)

A valid archive is a zip containing:
- `meta.xml` — descriptor mapping core + extension files to DwC term URIs, field indices, delimiters, and the core/extension relationship (star schema, one core → many extension rows linked by `coreid`/`id`).
- `eml.xml` — dataset metadata (title, creator, license, abstract, geographic/temporal coverage).
- `occurrence.txt` — **Occurrence core**, one row per occurrence record.
- `multimedia.txt` — **Simple Multimedia extension** (term URI `http://rs.gbif.org/terms/1.0/Multimedia`), zero-or-more rows per occurrence, linked by core id.
- (Optional, deferred) `resourcerelationship.txt` — ResourceRelationship extension for travel segments; kept reachable by design but not required this milestone.

Confidence HIGH on file set/structure (GBIF/TDWG/OBIS docs agree); exact term mappings are a requirements/data-modeling task for the roadmap, not a stack choice.

## Secrets & Credentials Handling

| Secret/Var | Where it lives now | Used by export for |
|------------|--------------------|--------------------|
| AWS access | OIDC role `salishsea-deploy-action` (no static keys) | S3 write + CloudFront invalidation — **already granted to this role** |
| `S3_BUCKET` | `production` env var (`vars.S3_BUCKET`) | Destination bucket (`salishsea-io`) |
| `CLOUDFRONT_DISTRIBUTION_ID` | `production` env var | Cache invalidation |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` | `production` env (var + secret) | Reading `occurrences` via PostgREST (if using `supabase-js`) |
| `DB_PASSWORD` (+ a `SUPABASE_DB_URL` to add) | `DB_PASSWORD` secret already exists in `production`; pooler host is public | Direct Postgres connection (if using `postgres`/porsager) |

**No new AWS credential or IAM role is required.** The only potential new secret is a Supabase DB connection string if you choose the direct-connection path; if you stick with `supabase-js`, **zero new secrets**. (Per project memory: any genuinely new env var must be confirmed with the user before pushing — flag the `SUPABASE_DB_URL` addition if the direct-connection path is chosen.)

## What NOT to Use / NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| A new Supabase Edge Function (Deno) for this | Adds a second runtime + deploy surface the repo doesn't use; Edge Function CPU/memory/time limits risk large-core builds; still needs AWS creds or a non-`salishsea.io` Storage URL | GitHub Actions Node script |
| Postgres-side `COPY TO file` / zipping in plpgsql | Managed Supabase Postgres has no superuser filesystem access and no native zip; needs ungranted extensions | Build the zip in the Node job |
| Storing the archive in Supabase Storage `media` bucket | Public URL would be on the Supabase domain, not `salishsea.io`; splits hosting across two systems; needs CORS/cache config separately | Write to existing S3 `/site/dwca/` → served by existing CloudFront |
| A new AWS Lambda / Step Function / EventBridge schedule | New infra + IAM + CDK changes for a once-nightly batch job that a cron workflow does trivially | GitHub Actions `schedule` |
| `adm-zip` | Loads entire archive in memory (not streaming); fine for tiny zips but worse for a growing occurrence core | `archiver` (streaming) |
| Heavy XML libraries for meta.xml/eml.xml | These are small fixed-shape documents | Template literals + an escape helper (or the already-present `fast-xml-parser` builder) |

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| GitHub Actions Node job (b) | Supabase Edge Function (a) | If you ever need on-demand/per-request generation, or want to drop the GitHub Actions dependency entirely and serve the zip from Supabase Storage on a Supabase domain |
| `postgres` (direct connection) | `@supabase/supabase-js` REST | If dataset stays small and you want zero new secrets / connection management; accept the `max_rows=1000` pagination |
| `archiver` (streaming zip) | `fflate` (0.8.3) / `yazl` (3.3.1) | `fflate` if you want a tiny zero-dep zipper and build everything in memory; `yazl` for low-level control. `archiver` is the most ergonomic for "stream several named entries into a zip" |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `archiver@8.0.0` | Node 24 | Requires Node ≥ 18; fine on the repo's Node 24 |
| `postgres@3.4.9` | Node 24, Supabase Postgres 17 | Connect via Supabase pooler; use SSL. Honors `major_version = 17` in config.toml |
| `csv-stringify@6.7.0` | Node 24, `archiver` streams | Stream API pipes directly into archiver entries |
| `aws-actions/configure-aws-credentials@v6` | `salishsea-deploy-action` role | Same action/role/region already used by `deploy.yml`; needs `permissions: id-token: write` |

## Sources

- Repo `.github/workflows/deploy.yml` — verified existing OIDC AWS role, `aws s3 sync s3://${S3_BUCKET}/site`, CloudFront invalidation, `production` env secrets/vars (HIGH)
- Repo `.github/workflows/smoke.yml` — verified existing `schedule` + `workflow_dispatch` nightly pattern (HIGH)
- Repo `infra/lib/infra-stack.ts` — verified `salishsea-io` bucket, `originPath: '/site'`, CloudFront distribution for `salishsea.io` (HIGH)
- Repo `supabase/config.toml` — verified `max_rows = 1000` API cap, Postgres `major_version = 17` (HIGH)
- Repo `supabase/migrations/20250914232212_cron.sql` — verified existing pg_cron jobs incl. `nightly-vacuum` at `0 11 * * *` UTC (HIGH)
- npm registry (`npm view`) — current versions verified 2026-06-09: archiver 8.0.0 (2026-05-08), postgres 3.4.9, csv-stringify 6.7.0, fflate 0.8.3, yazl 3.3.1, @supabase/supabase-js 2.108.1 (HIGH)
- [GBIF IPT DwC-A How-to Guide](https://ipt.gbif.org/manual/en/ipt/latest/dwca-guide) — meta.xml/eml.xml + core/extension star schema (HIGH)
- [OBIS Manual §7 Darwin Core Archive](https://manual.obis.org/data_format.html) — required files, occurrence core + multimedia extension (HIGH)
- [Darwin Core text guide (TDWG)](https://dwc.tdwg.org/text/) — meta.xml descriptor semantics (HIGH)
- [Supabase Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions) / [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net) — confirmed pg_cron+pg_net path for option (a) tradeoff analysis (MEDIUM)

---
*Stack research for: nightly DwC-A export + hosting on existing S3/CloudFront + Supabase + GitHub Actions stack*
*Researched: 2026-06-09*
