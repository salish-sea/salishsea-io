# Phase 13 — Verification & GBIF Re-validation

**Status:** PASSED (ATTR-05 satisfied)
**Date:** 2026-06-21
**Build verified:** fresh local build via `npm run build:dwca` (D-02), 4413 occurrence rows
**Requirement:** ATTR-05 — regenerated archive passes the GBIF DwC-A validator with no
blocking/structural errors and no attribution regressions.

> **Local ↔ nightly equivalence (D-02):** the artifact verified here is a fresh local
> build produced by the *same* `scripts/dwca/build.ts` pipeline the nightly GitHub
> Actions job runs, against the *same* prod DB. The local build is therefore
> representative of the published nightly artifact. The `eml.ts` contact enrichment
> committed in this phase will appear in the published `eml.xml` after the next
> deploy/nightly regeneration (push to `main`).

---

## Success Criteria

### SC#1 — GBIF validator: "can be indexed by GBIF", zero blocking/structural errors ✅

Submitted the freshly-built `dist/dwca/salishsea-occurrences-v1.zip` to the GBIF
validation REST API (`POST https://api.gbif.org/v1/validation`, Basic auth — D-01).

- Validation key (post-enrichment run): `865355dc-8da8-4df1-8ba9-662b9052ed67`
- Earlier run (pre-enrichment): `242af032-b1fc-4225-ba4b-ca85023d8786`
- Result: `status=FINISHED`, **`metrics.indexeable=true`**
- **Zero** `RESOURCE_INTEGRITY` / `RESOURCE_STRUCTURE` (blocking) issues → SC#1 PASS.

`scripts/dwca/validate-gbif.ts` `assertIndexeable` gate passed (PASS: "Archive passes
SC#1 (indexeable, no blocking issues)").

### SC#2 — `occurrence.txt` carries no iNat/HappyWhale rows (SRC-01 in the artifact) ✅

`scripts/dwca/verify-artifact.ts` against the built `occurrence.txt`:
`SC#2 OK: no occurrenceID prefixed 'inaturalist:' or 'happywhale:' (4413 rows)`.

### SC#3 — Maplify attribution spot-check (aggregator pattern) ✅

Against the built `occurrence.txt` (4413 rows):
- `institutionCode` = `{'SalishSea'}` only — uniform.
- `rightsHolder` = `{'SalishSea.io'}` only — uniform (no per-contributor rightsHolder).
- `datasetName` — all rows prefixed `'SalishSea.io — '`, **19 distinct** per-collection names.
- `recordedBy` — human names where a parenthetical observer exists (e.g. "Alli Montgomery",
  "Rachel Haight"); NULL/empty where none (Phase 12 D-02 regex), never an opaque source code.

### SC#4 — EML associatedParty + v1.3 title ✅

Against the built `eml.xml`:
- `<title>` = `SalishSea.io Cetacean Occurrences (v1.3)` — reflects the v1.3 archive version.
- **5** `<associatedParty>` elements crediting upstream organizations (contentProvider).
- No upstream org name appears in any `institutionCode` value (org credit stays in
  associatedParty; institutionCode stays `SalishSea`).

---

## "Looks Done But Isn't" checklist (PITFALLS.md) — 12/12 green

Recorded in `13-CHECKLIST.md` (plan 13-01), run read-only against prod via
`supabase db query --linked`:
- 5 active Phase-13 SC checks: SRC-01 row-count (4413 ≤ native+Maplify 4878), institutionCode
  uniformity, rightsHolder uniformity, datasetName per-collection, occurrenceID-prefix (0 excluded).
- 6 prior-phase confirmations (backfill completeness, trailing-attribution, "Submitted by" not
  parsed as contributor, comments immutability, RLS/grants, FK-ingest nullability) — all PASS
  with "verified by Phase N" evidence notes.
- fields.ts column-count parity (26 fields) — `npm test` green.

---

## Non-blocking GBIF warnings (knowingly accepted)

SC#1 requires zero *blocking/structural* errors; the following 4 warnings are non-blocking
and do not affect indexability:

| Category | Issue | Count | Disposition |
|----------|-------|-------|-------------|
| METADATA_CONTENT | RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE | 1 | **Accepted.** The resource `<contact>` was enriched (D-03) with `positionName`, a postal address (Seattle, WA, US), and `onlineUrl` — but GBIF's evaluator also weighs `<creator>`/`<metadataProvider>`, which remain org-only (`organizationName=SalishSea.io`) by deliberate modeling choice. Clearing fully would require mirroring a full individual into those parties (and possibly an ORCID `userId`). Decided not worth a further cycle for a non-blocking flag. |
| OCC_INTERPRETATION_BASED | COUNTRY_DERIVED_FROM_COORDINATES | 4412 | Informational — GBIF derived country from coordinates (records carry no `country` field). Normal for coordinate-only occurrence data. |
| OCC_INTERPRETATION_BASED | CONTINENT_DERIVED_FROM_COORDINATES | 3734 | Informational — same. |
| OCC_INTERPRETATION_BASED | COORDINATE_ROUNDED | 734 | Informational — GBIF rounded high-precision coordinates. Harmless. |

**`coordinateUncertaintyInMeters` (D-04):** the GBIF validator raised **no** warning for this
term, so the optional Maplify value-derivation was correctly **not** done (moot). The field
ships at index 14 (Phase 12); native emits `NULLIF(o.accuracy,0)` (NULL across prod),
Maplify emits NULL — the honest-NULL policy (D-04) holds.

---

## Deviations from plan (D-06 inline remediation)

1. **`build.ts` now emits `meta.xml` + `eml.xml` loose** (commit `3a8b41a`) — the build
   previously packaged them only inside the zip, so `verify-artifact.ts` (which reads loose
   files like `occurrence.txt`) failed on `dist/dwca/eml.xml` (ENOENT). Loose files are written
   from the same in-memory strings as the zip members → byte-identical. Not in the plan's
   `files_modified`; added under D-06 (fix inline, re-verify).
2. **`validate-gbif.ts` parser corrected to the real GBIF schema** (commit `f9f4d35`) — research
   assumed a top-level `indexeable` boolean and `results[]`; the live API nests `indexeable`
   under `metrics` and issues under `metrics.files[].issues[]`, with run state in top-level
   `status`. Verified against the real saved response (`242af032`). Without this fix the gate
   reported `indexeable=undefined → FAIL` on an archive GBIF actually accepts.
3. **EML contact enrichment (D-03)** applied (commit `c2efdcc`) but did not fully clear the
   RESOURCE_CONTACTS warning (see above) — accepted as non-blocking.

---

## Verdict

**ATTR-05 PASS.** The regenerated archive is indexable by GBIF with zero blocking/structural
errors; SC#1–SC#4 confirmed in the built artifact; the 12-item "Looks Done But Isn't" checklist
is fully green; field-contract parity (26 fields) intact and `npm test` green. Residual GBIF
warnings are non-blocking and documented/accepted.
