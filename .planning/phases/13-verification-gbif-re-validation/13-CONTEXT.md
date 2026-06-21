# Phase 13: Verification & GBIF Re-validation - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the deployed v1.3 DwC-A is correct end-to-end and pass the GBIF DwC-A
validator with **zero blocking/structural errors** (ATTR-05). Two strands:

1. **Verification (primary):** Walk the 12-item "Looks Done But Isn't" checklist
   (`.planning/research/PITFALLS.md` §"Looks Done But Isn't Checklist") green —
   SRC-01 invariant, `institutionCode`/`rightsHolder`/`datasetName` uniformity,
   `recordedBy` as human names, `fields.ts` ↔ view column parity, comments
   immutability, no false iNat/HappyWhale export. Run the GBIF validator on the
   built archive and confirm "can be indexed by GBIF." Confirm SC#1–SC#4
   **in the artifact** (occurrence.txt / eml.xml), not just in the views.

2. **Two non-blocking GBIF warnings pulled forward** from the deferred v2 list
   (user pulled these into scope this phase):
   - **EML resource contacts** (`RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`) —
     metadata-only fix in `scripts/dwca/eml.ts`.
   - **`coordinateUncertaintyInMeters`** — a **field-contract change** (the
     surface Phase 12 flagged as highest-risk), done as an isolated, gated
     sub-step (see D-04/D-05).

**In scope:**
- The 12-item checklist run against prod DB (read-only) + against a fresh local
  build's artifact files.
- GBIF validator run via its REST API on a fresh local build.
- EML single-contact completion.
- `coordinateUncertaintyInMeters` honest derivation (NULL where not derivable),
  added to the field contract, `npm test` green BEFORE the validation pass.
- Inline remediation of any defect the checklist/validator surfaces.

**Out of scope (deferred):**
- Per-channel constant / full coverage for `coordinateUncertaintyInMeters` (only
  honest derivation here — most rows may stay NULL; warning may only partially clear).
- Seeded-local-DB pre-prod build gate (its own follow-up).
- Cross-provider `contributor_links` unification.

**Requirements:** ATTR-05.

</domain>

<decisions>
## Implementation Decisions

### Validator mechanism
- **D-01:** Run the **GBIF validator via its REST API** — automate submission +
  poll for the result, treated as an automated gate (not a manual browser
  upload as in v1.2's DWCA-05 closeout). Research must pin down the actual API:
  endpoint (likely `POST api.gbif.org/v1/validation`), auth (GBIF account / basic
  auth + token), async job-status polling, and the result schema used to assert
  "zero blocking/structural errors." If the API proves unworkable/offline,
  manual upload is the documented fallback.

### Verification target
- **D-02:** Validate + spot-check a **fresh local build** produced by
  `scripts/dwca/build.ts` against the prod DB — not a wait-on-the-nightly cron.
  Rationale: the build is deterministic from prod DB + committed code, so a local
  build is representative of the nightly artifact. The SC's that say "in the
  artifact, not just the view" (SC#2 occurrenceID-prefix scan; SC#3
  datasetName/institutionCode/rightsHolder/recordedBy spot-check) run against the
  **built `occurrence.txt`/`eml.xml`**, satisfying the artifact-level intent.
  - *Planner note:* SC#1/SC#2 ROADMAP wording says "nightly-regenerated archive."
    A fresh local build uses the identical pipeline; capture that equivalence
    explicitly in VERIFICATION so the SC is provably met without blocking on cron.

### EML resource contacts (warning fix — low risk)
- **D-03:** Fill out the **existing single contact** (Peter Abrahamsen) fully —
  full name, email, role, plus whichever EML contact sub-elements GBIF's validator
  flags as incomplete (e.g. position/organization). Metadata-only edit in
  `scripts/dwca/eml.ts` + `eml.test.ts`. Do NOT add a separate org-level contact
  unless research shows GBIF requires it.

### coordinateUncertaintyInMeters (warning fix — field-contract change)
- **D-04 [value policy]:** **Derive honestly where possible, NULL elsewhere.**
  Neither exported channel records accuracy (`public.observations` has only
  `lat`/`lng`; Maplify coords are human-reported/rounded; iNat's
  `public_positional_accuracy` and HappyWhale's `accuracy` enum exist but are
  excluded by SRC-01). So derive a value ONLY where it's honestly knowable — e.g.
  from **detectable coordinate-rounding precision** (decimal places → a meters
  floor at ~48°N) — and emit **NULL** otherwise. **No fabricated constant.**
  Consequence accepted: the GBIF warning may only *partially* clear (NULL rows
  still lack the term); that is fine — SC#1 needs zero *blocking/structural*
  errors, not zero warnings.
  - *Research task:* propose the decimal-places→meters mapping (and confirm
    coordinate precision is reliably detectable per channel before committing).
- **D-05 [sequencing]:** Do it **inline as an isolated, gated field-contract PR**:
  add `coordinateUncertaintyInMeters` to `scripts/dwca/fields.ts` (→ next ordinal),
  the dwc views, `meta.xml` output, the GeoParquet column set, and the round-trip
  tests (`fields.test.ts`, `build.test.ts` F-02 invariant). **`npm test` green
  BEFORE** the GBIF validation run, so we validate the final field-contract
  archive exactly once. This contains the highest-risk surface Phase 12 just
  stabilized.

### Remediation policy
- **D-06:** If the checklist or validator surfaces a real defect in the deployed
  Phase 12 work, **fix it inline and re-verify** — Phase 13 absorbs the fix
  (re-open the relevant view/script, migrate, redeploy, re-run the affected
  checklist items) and closes only when everything is green. Not a kick-back to
  reopen Phase 12.

### Claude's Discretion
- Exact ordering/structure of the checklist run (which queries hit prod DB via
  `npx supabase db query --linked` vs. parse the built artifact) — planner's call,
  guided by PITFALLS.md.
- Whether to extend `scripts/dwca/verify-publish.ts` vs. add a new verification
  script for the artifact-level assertions.

### Folded Todos
- **`2026-06-19-emit-coordinate-uncertainty.md`** (dwca) — folded into scope via
  D-04/D-05 (honest-derivation variant, not the todo's "per-channel default").
- **`2026-06-18-retry-gbif-validator-for-dwca-05.md`** (verification) — folded;
  this phase runs the validator (now via API per D-01), closing the retry todo.
- **EML resource-contacts enrichment** (v1.2 follow-up, REQUIREMENTS "Active")
  — folded via D-03.
- **`2026-06-17-model-embedded-dataset-attributions-as-first-class-sources.md`**
  (database) — this is the overarching v1.3 milestone todo; per STATE.md it is
  **marked resolved when Phase 13 passes**. Folded as the closing condition.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Verification spec (load first)
- `.planning/research/PITFALLS.md` §"Looks Done But Isn't Checklist" — the 12
  canonical verification items; this IS the checklist Phase 13 must turn green.
- `.planning/ROADMAP.md` (Phase 13 block) — SC#1–SC#4.
- `.planning/REQUIREMENTS.md` — ATTR-05 definition + the v1.2 follow-up warnings.

### Build + projection
- `scripts/dwca/build.ts` — local archive build entry (fresh build target, D-02).
- `scripts/dwca/build-queries.ts` — DuckDB CSV/GeoParquet projection queries.
- `scripts/dwca/fields.ts` (+ `fields.test.ts`) — ordered field-contract single
  source of truth (26 cols post-Phase-12; +`coordinateUncertaintyInMeters` here).
- `scripts/dwca/meta-xml.ts` — meta.xml ordinal descriptor (must track fields.ts).
- `scripts/dwca/eml.ts` (+ `eml.test.ts`) — EML builder; contact + associatedParty.
  EML `<title>` already reads `SalishSea.io Cetacean Occurrences (v1.3)` (SC#4 ✓).
- `scripts/dwca/guard.ts` — nightly row-count guard / `ROW_FLOOR` (SRC-01 runtime gate).
- `scripts/dwca/verify-publish.ts` — existing publish-verification helper (extend?).
- `supabase/migrations/20260617203900_dwc_schema.sql` — dwc view definitions.

### Prior-phase decisions
- `.planning/phases/12-dwc-view-rebuild/12-CONTEXT.md` — 26-col view contract,
  view-time `recordedBy` regex (string, not FK), trusted-only Maplify filter,
  Whale Alert Global `datasetName` fallback.
- `.planning/v1.3-EXECUTIVE-SUMMARY.md` — prod counts, signal inventory, resolution order.

### Pulled-forward todos
- `.planning/todos/pending/2026-06-19-emit-coordinate-uncertainty.md`
- `.planning/todos/pending/2026-06-18-retry-gbif-validator-for-dwca-05.md`

### External
- GBIF DwC-A validator: https://www.gbif.org/tools/data-validator (+ REST API — research).
- GBIF occurrence issues/flags: https://techdocs.gbif.org/en/data-use/occurrence-issues-and-flags

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/dwca/build.ts` + `build-queries.ts`: produce the local archive to validate (D-02).
- `scripts/dwca/verify-publish.ts`: existing artifact/publish checks — candidate to
  extend for the SC#2/SC#3 artifact-level assertions.
- `scripts/dwca/guard.ts` (`ROW_FLOOR`): SRC-01 row-count runtime guard; the checklist's
  SRC-01 invariant mirrors this.
- `npx supabase db query --linked`: read-only prod SQL for the checklist's DB-side
  queries (JSON out → `jq`). No DB_PASSWORD needed.

### Established Patterns
- **Field-contract single source of truth** (F-02 invariant in `build.test.ts`):
  `fields.ts` order drives meta.xml indices AND the GeoParquet column set —
  adding `coordinateUncertaintyInMeters` ripples through all three + round-trip tests.
- **`npm test` gate before merge** for any field-contract change (Phase 12 discipline).
- Static guard test asserts `build.ts` PG refs are `pgdb`-qualified (recent commit f716d9a) —
  keep new queries pgdb-qualified.

### Integration Points
- Exported channels are native (`public.observations`) + Maplify (`maplify.sightings`)
  only; coordinate-precision derivation (D-04) reads `lat`/`lng` from these two.
- EML contact edit (D-03) is isolated to `scripts/dwca/eml.ts`.

</code_context>

<specifics>
## Specific Ideas

- Data integrity over warning-clearing: the user explicitly prefers NULL to a
  fabricated `coordinateUncertaintyInMeters` constant — derive only what's honestly
  knowable (D-04). This principle should guide any similar "fill a recommended term"
  pressure from the validator.
- Validate the **artifact**, not just the views: SC#2/SC#3 evidence must come from
  the built `occurrence.txt`/`eml.xml`, not a `SELECT` against the view.

</specifics>

<deferred>
## Deferred Ideas

- **`coordinateUncertaintyInMeters` full coverage** — per-channel constant /
  methodological floor to clear the warning fully. Deferred; this phase only does
  honest derivation (NULL where unknown).
- **Seeded-local-DB pre-prod build gate** — making the DwC-A build query a real
  pre-prod gate against a seeded local DB.

### Reviewed Todos (not folded)
- `2026-06-21-seeded-local-db-gate-for-dwca-build.md` (area `phase-13-followup`,
  score 0.4) — explicitly a *follow-up after* Phase 13; left deferred, not in scope.

</deferred>

---

*Phase: 13-verification-gbif-re-validation*
*Context gathered: 2026-06-21*
