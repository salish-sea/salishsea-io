# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

*Milestones v1.0–v1.3 ran under the GSD workflow, retired 2026-07 — tooling references below (gsd-tools, phase/plan structure) are historical.*

## Milestone: v1.0 — Link Shareability

**Shipped:** 2026-04-17
**Phases:** 2 | **Plans:** 7 | **Tasks:** 12

### What Was Built
- Copy-link button on occurrence summary cards producing clean `?o=<id>` URLs (no extra params), visible to all visitors regardless of login state
- Deep-link hydration on page load: sets date from occurrence's `observed_at` and centers map, with no browser history pollution
- Lambda@Edge viewer-request handler for bot detection and OG tag generation, fetching Supabase occurrence data with SSM-cached credentials
- CDK infrastructure stack: CloudFront + Lambda@Edge VIEWER_REQUEST, deployed to production replacing the previous static distribution
- Static branded fallback preview image for occurrences without openly-licensed photos

### What Worked
- TDD Wave 0 scaffold (plan 02-01 writing all tests in RED before implementation) caught multiple behavior specification issues early — license list, description format, missing OG fields
- GSD atomic commit discipline made the production deploy debugging (timeout, SSM key retention) straightforward to bisect
- Reusing the existing `VITE_SUPABASE_KEY` GitHub Actions secret rather than adding a new one kept the deploy workflow simple
- `fail-open` design for the Lambda@Edge handler (pass-through on any error) meant production never served 500s during rollout

### What Was Inefficient
- Infrastructure approach (Lambda@Edge vs CloudFront Functions) required research to resolve before Phase 2 could be planned — could have been investigated during Phase 1 in parallel
- Brief DNS outage during production cutover (had to delete old distribution before CDK could claim the alias) — a staged alias transfer would have been cleaner
- CDK upgrade required mid-phase (schema version mismatch) added unplanned friction to the deploy plan

### Patterns Established
- `buildShareUrl`: build share URLs from `origin + pathname` (not `href`) to strip existing query params
- History-safe hydration: bypass Lit property setters to avoid triggering `setQueryParams` side-effects during deep-link load
- `skipEvent: true` on `setView` prevents map-move handler from writing position to URL history
- Lambda@Edge SSM credential caching at module scope — one SSM call per cold start, verified by unit test
- Icon export pattern: `export const fooIcon = svg\`<path d='...'/>\`` from `icons.ts`, wrapped with `<svg>` at call site

### Key Lessons
1. CDK cannot create SSM SecureString values — use a placeholder at synth time and set the real value post-deploy via AWS Console or a separate `aws ssm put-parameter` command
2. `cloudfront.experimental.EdgeFunction` (not `lambda.Function`) is required for Lambda@Edge; regular Lambda functions can't be attached to CloudFront viewer-request events
3. AWS does not allow two CloudFront distributions to share a domain alias — plan for a brief outage or use a staged DNS handoff when replacing a distribution

### Cost Observations
- Model mix: ~100% sonnet (no opus or haiku sessions observed)
- Sessions: ~6 sessions across 44 days (most work clustered in two bursts: Phase 1 on 2026-03-04, Phase 2 on 2026-04-17)
- Notable: Phase 2 infra work required multiple fix commits post-deploy (timeout, SSM key retention, bot UA matching) — integration testing before deploy would have caught these

---

## Milestone: v1.1 — Partner Org Links

**Shipped:** 2026-04-18
**Phases:** 1 | **Plans:** 2 | **Tasks:** 4

### What Was Built
- `src/partners.csv` — plain CSV (name, url columns) editable by non-technical contributors; Vite `?raw` import bundles it at build time with no runtime fetch
- `src/partner-links.ts` — pure `injectPartnerLinks()` utility with case-insensitive matching, `[Org Name]` bracket handling, double-link prevention, longest-name-first ordering, and URL-safe regex (splits on existing links to avoid matching names inside URLs)
- `src/partner-links.test.ts` — 7 + 1 unit tests covering all behaviors including full marked + DOMPurify pipeline (PARTNER-04)
- `src/obs-summary.ts` integration — `injectPartnerLinks()` pre-processes body before `marked.parse`, custom link renderer adds `target="_blank" rel="noopener noreferrer"`, DOMPurify `ADD_ATTR` preserves attributes; also fixed pre-existing `target="_new"` bug and `onDelete` unhandled rejection

### What Worked
- TDD discipline (RED → GREEN) caught implementation gaps before integration — failing tests were a clear signal the module was ready to implement
- Planning a pure function with no DOM dependency made it fully testable in Node/jsdom without a browser
- Code review caught 3 pre-existing bugs (WR-01, WR-02) and one new edge case (WR-03, URL-safe regex) that automated tests hadn't caught

### What Was Inefficient
- REQUIREMENTS.md traceability table wasn't auto-updated by gsd-tools `phase complete` — required manual correction at milestone close
- `audit-open` gsd-tools command crashed with a ReferenceError — had to skip and verify artifacts manually

### Patterns Established
- `?raw` CSV import pattern: `import data from './file.csv?raw'` works without any Vite config changes; `vite-env.d.ts` provides TS types via `/// <reference types="vite/client" />`
- Single-pass combined regex for safe text injection: bracket + plain-name patterns in one regex avoids re-matching already-transformed text
- URL-safe substitution: split body on existing `[text](url)` patterns, only transform odd-indexed (non-link) segments
- Longest-name-first sort prevents short names (NOAA) matching inside longer names (NOAA Fisheries)

### Key Lessons
1. Pure functions with no DOM dependency are easy to test and compose — keep link injection pure, apply it at the call site in the component
2. Code review auto-fix is worth running after every phase — caught a pre-existing `target="_new"` bug unrelated to phase work that would have been a silent UX issue
3. Manual CSV editing as a non-technical interface works when the file is committed — no admin UI needed for a small, infrequently-updated lookup table

### Cost Observations
- Model mix: ~100% sonnet
- Sessions: 1 focused session (planning was done in prior sessions)
- Notable: Phase was planned across 2-3 prior context sessions (discuss → plan) and executed in one session end-to-end including code review fix and milestone close

---

## Milestone: v1.2 — Export to DarwinCore Archive

**Shipped:** 2026-06-18
**Phases:** 5 | **Plans:** 16 | **Tasks:** 31

### What Was Built
- `04-POLICY.md` — single authoritative rights & data-model policy gate: CC-BY-NC 4.0 URI, per-photo CC converter, native vs third-party attribution model, per-source gap resolutions, include-and-attribute hold rule with per-org conferral questions
- `dwc` Postgres schema (six views: `taxa_classification`, `_native_occurrences`, `_maplify_occurrences`, `occurrences`, `datasets`, `multimedia`) projecting source tables into DwC-aligned columns; 17-block psql assertion harness
- `scripts/dwca/` pipeline (`npm run build:dwca`): DuckDB ATTACH Postgres → field-alignment assert → deterministic DwC-A zip (`meta.xml` + `eml.xml` + Occurrence core + Multimedia) + GeoParquet 1.0.0 sidecar (WKB Point, CRS84)
- `.github/workflows/dwca-nightly.yml`: cron `0 9 * * *`, OIDC publish to existing S3 bucket, CloudFront `/dwca/*` invalidation, checksum-LAST upload order, dedup'd failure-issue creation
- L-01 Lambda@Edge carve-out (`if (request.uri.startsWith('/dwca/')) return request;`) so binary downloads bypass the OG-meta interceptor
- About-modal "Data download" section: HEAD-on-open fetches `.zip` + `.parquet` metadata once per session; renders sizes + "updated X ago"; sha256 verify links

### What Worked
- **Policy-first gate**: ratifying every rights/gap decision in Phase 4 before any SQL meant Phase 5's view definitions could cite POLICY sections inline — single source of truth, zero re-decision in encoding
- **View-as-contract**: defining `dwc.occurrences` as a bare `SELECT * UNION ALL` of two branch views lets Postgres enforce 25-column / type parity at `CREATE VIEW` time — branch drift fails the migration loudly instead of corrupting the export
- **Single ordered field list (`fields.ts`)** drives both `meta.xml` descriptor and CSV COPY column list; runtime `assertFieldAlignment()` against `DESCRIBE pgdb.dwc.*` proves DWCA-02 at every build
- **Hybrid TS + DuckDB split**: TS owns EML/meta.xml/zip (pure functions, fast unit tests); DuckDB owns CSV + GeoParquet COPYs (one engine, two outputs, geometry auto-emitted as GeoParquet 1.0.0 from typed `GEOMETRY` columns)
- **Checksum-LAST upload order** (parquet, zip, parquet.sha256, zip.sha256) is a tiny rule with big atomicity payoff: clients cannot fetch a sha256 newer than its artifact
- **Spike before commit**: the 2026-06-09 DuckDB ATTACH+GeoParquet spike resolved the T-01 hybrid orchestration before planning Phase 6, so the plan stayed thin
- **Cross-AI peer review** (per RETROSPECTIVE conventions established prior milestones) flagged the deprecated GHA action SHAs early — caught the v6→v7 / v6.0→v6.2 bumps before the first workflow run

### What Was Inefficient
- **Live-DB validation deferred mid-Phase 5** because Docker daemon was down — the assertion harness had to be carried as `nyquist_compliant: false` until the user ran it manually. A pre-execute environment check would have surfaced this before Plan 05-04 started.
- **GBIF validator was offline** on the day of Phase 6 closeout (DWCA-05); no automation could detect that. Accepted via override + retry queue. Out-of-our-control gap.
- **Two SHA-pin drifts** between 07-03-PLAN.md and the shipped workflow (`actions/checkout@de0fac2e` v6 → `@9c091bb2` v7.0; `aws-credentials@acca2b1b` v6.0 → `@e7f100cf` v6.2). Intentional improvements per ADR memory, but a plan-vs-shipped reconciliation step would have surfaced them as deliberate, not as drift.
- **Stale claim in 08-VERIFICATION.md** ("Phase 6 passed the GBIF validator") survived into the verification report — written before the DWCA-05 deferral was finalized in Phase 6. Lesson: cross-reference active deferrals from the milestone audit when writing late-phase verifications.
- **Session-pooler hostname switch** late in Phase 7 (`db.<ref>.supabase.co` → `aws-1-us-west-1.pooler.supabase.com:5432`) — would have been cheaper to land in 07-RESEARCH.md before planning.

### Patterns Established
- **Policy-first gate phase**: a documentation-only phase that ratifies every gap/decision the implementation phases will cite. Cheap to write, prevents silent fudging.
- **View-as-export-contract**: `SELECT * UNION ALL` over typed branch views lets Postgres enforce shape parity at migration time. No explicit projection list to maintain.
- **F-02 runtime alignment guard**: at build start, `DESCRIBE pgdb.<schema>.<view>` is compared to the TypeScript field array. Drift fails loudly, structured diff in the error message.
- **`FIXED_MTIME = 2000-01-01` on every zip entry**: deterministic bytes mean checksum reproducibility across runs is a property, not a hope.
- **L-01 path carve-out at edge handler line 1**: `if (request.uri.startsWith('/<prefix>/')) return request;` before any other branching keeps binary paths unconditionally raw.
- **Checksum-LAST upload order**: when multiple artifacts share a sidecar checksum, upload the artifact before its sidecar (parquet, zip, parquet.sha256, zip.sha256). Removes a class of race-on-publish bugs.
- **HEAD-on-open with per-session cache, no preflight on initial load**: shifts the metadata cost to the moment of user interest, not every page view.
- **`continue-on-error: true` on CloudFront `wait invalidation-completed`**: smoke verify runs even if the wait takes too long; flag for revisit if artifacts grow large enough that smoke could race the invalidation.
- **`add-mask::` before `printf >> $GITHUB_ENV`**: assemble secrets in a dedicated step, mask before write, never echo. T-7-01 DSN-no-leak in practice.

### Key Lessons
1. **Encoding a gap decision is cheaper than re-deciding it during implementation** — policy-first doc gate prevented at least three branch-point re-decisions in Phase 5
2. **One ordered list, two consumers** (TS descriptor + DB COPY) is the simplest way to eliminate "index drift" in a generated archive — runtime guard is the trust mechanism
3. **DuckDB auto-emits valid GeoParquet 1.0.0 metadata** when the source column is typed `GEOMETRY` — no manual `geo` key construction needed (R1 confirmed empirically; saved a Phase 6 task)
4. **Pre-execute environment check** (Docker / Supabase reachable, port open) belongs in Wave 0, not at the first task that needs it
5. **Stale claims propagate forward**: a Phase 6 deferral surfaced in a Phase 8 verification report. Late-phase reports should diff against the milestone audit, not against their own assumptions

### Cost Observations
- Model mix: opus-heavy planning + execution (this milestone exercised the policy/SQL/serializer/workflow chain end-to-end with significant ATTACH + GeoParquet research)
- Sessions: ~10–12 working sessions across 9 days (2026-06-09 → 2026-06-18); planning and discuss-phase clustered early, execution clustered late
- Notable: most expensive single task was the live-DB integration test run in Phase 6 (DuckDB ATTACH Postgres × 16,000 rows × parquet write) — fast in absolute terms but novel infra spend

---

## Milestone: v1.3 — Providers, Collections & Contributors

**Shipped:** 2026-06-24
**Phases:** 6 (9–14) | **Plans:** 14 | **Tasks:** 23

### What Was Built
- Provenance reference tables (`providers`, `organizations`, `collections` + `collection_kind` enum) seeded with RLS read policies, plus a nullable `contributors.orcid` column
- Nullable `provider_id`/`collection_id`/`contributor_id`/`source_url` FKs across all four source schemas (native / Maplify / iNaturalist / HappyWhale), `source_url` generated from existing `url`/`uri`
- Pure-TS URL-pattern resolver + human-curated exact-match dictionary (UNION ALL precedence) + idempotent backfill + MERGE-based ingest wiring (RESOLVE-01–04)
- `dwc.occurrences` rebuilt 25→26 cols to the aggregator pattern (constant `institutionCode`/`rightsHolder`, per-collection `datasetName`, regex `recordedBy`, EML `associatedParty`)
- Artifact-level + GBIF-REST verifiers; archive re-validated `indexeable=true`, zero structural errors
- Seeded local-DB CI gate turning `build.test.ts` into a true pre-merge gate

### What Worked
- **Resolve-first todo promotion:** the Phase 14 CI gate was promoted from a "Looks Done But Isn't" todo surfaced during Phase 12 (a bare-schema-ref bug that only failed in the nightly post-deploy) — turning a near-miss into a permanent gate
- **nullable → backfill → constrain** sequencing kept each migration additive and reversible
- Read-only validation of the rebuilt views against thousands of real prod rows before relying on them
- A single static SQL fixture engineered to exercise every trust/tag branch made the CI gate meaningful without fabricating bulk data

### What Was Inefficient
- A stale `database.types.ts` (schema drift from phases 9–10, never regenerated) blocked the gen-types step on the first real CI run of the new gate — caught at the worst time, on PR #278
- REQUIREMENTS.md traceability checkboxes for RESOLVE-01–04 were never flipped after Phase 11 shipped them; the drift only surfaced during this milestone-close requirements audit
- Recurring storage-api `500` noise on `supabase db reset` (pre-existing, unrelated) added friction to local verification

### Patterns Established
- **Aggregator attribution** for DwC export (institution = the platform; per-collection datasetName; upstream orgs as EML associatedParty)
- **Exact-match human-curated resolution dictionary** (no alias table, no fuzzy match; unmatched → NULL)
- **Seeded-local-stack CI gate** for any build that reads Postgres through a DuckDB `ATTACH` alias

### Key Lessons
- A build that reads Postgres via DuckDB `ATTACH ... AS pgdb` must qualify *every* relation; only a seeded-DB integration gate catches a bare ref — unit tests and static guards don't
- Regenerate committed derived artifacts (`database.types.ts`) at each schema migration, or CI will surface the drift later, off-context
- Flip REQUIREMENTS.md checkboxes at phase close, not milestone close — stale bookkeeping reads as a coverage gap during the close audit

### Cost Observations
- Model mix (config): planner=opus, executor=sonnet
- A backend/data-model milestone with no UI phases — heavier on SQL/migration review than on iteration

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~6 | 2 | First milestone — baseline established |
| v1.1 | ~1 execution + 2-3 planning | 1 | Tight pure-function scope; code review fixed pre-existing bugs |
| v1.2 | ~10-12 | 5 | First multi-phase milestone with strict dependency chain; policy-first gate + view-as-contract; first prod-touching scheduled workflow |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 15 unit + 2 E2E smoke | partial | 0 |
| v1.1 | 25 unit + 2 E2E smoke | partner-links fully covered | 0 |
| v1.2 | +75 vitest (scripts/dwca) + 17 psql assertions + 20 download-info + 4 salish-sea DOM tests + 21 edge-handler unit tests | dwca pipeline + dwc schema + download UI fully covered | 3 dev (`@duckdb/node-api`, `yazl`, `tsx`) |

### Top Lessons (Verified Across Milestones)

1. TDD (RED before implementation) surfaces behavior specification gaps before any code is written — confirmed in v1.0 and v1.1
2. Fail-open error handling in infrastructure handlers prevents production outages during rollout — v1.0
3. Pure functions with no DOM dependency are easy to compose and test — keep transformation logic separate from rendering — v1.1, v1.2 (TS-side EML/meta-xml/zip)
4. Code review auto-fix catches pre-existing bugs unrelated to phase scope — run it every phase — v1.1
5. **Encoding a gap decision is cheaper than re-deciding it during implementation** — v1.2 (policy-first gate phase) and v1.0 (deep-link hydration spec written down before code)
6. **One ordered list, two consumers** with a runtime alignment guard eliminates index-drift bugs in generated artifacts — v1.2
7. **Pre-execute environment checks belong in Wave 0** — v1.2 (Docker daemon down at Plan 05-04 execute time)
