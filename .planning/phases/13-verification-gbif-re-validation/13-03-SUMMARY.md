# Plan 13-03 Summary — Fresh build + GBIF validator run + inline remediation

**Status:** Complete
**Requirement:** ATTR-05
**Mode:** human-action checkpoint (operator supplied GBIF + prod DB credentials, ran build/validator, chose remediation)

## What was done

1. **Fresh local build (D-02):** `npm run build:dwca` against prod DB → 4413 occurrence rows,
   `dist/dwca/{occurrence.txt, eml.xml, meta.xml, multimedia.txt, *.zip, *.parquet}`.
2. **Artifact verification:** `verify-artifact.ts` green against the build — SC#2 (0 iNat/HappyWhale
   occurrenceIDs), SC#3 (institutionCode/rightsHolder/datasetName uniform, recordedBy human names),
   SC#4a (≥1 associatedParty, no org in institutionCode), SC#4b (v1.3 title).
3. **GBIF validation (D-01):** submitted the zip to the GBIF validator REST API →
   `status=FINISHED, indexeable=true`, zero blocking issues. **SC#1 PASS.**
4. **Checkpoint decision:** operator chose to enrich the EML contact (D-03), then — after the
   warning persisted because GBIF also weighs the org-only creator/metadataProvider — chose to
   **accept** the residual non-blocking `RESOURCE_CONTACTS` warning and close.
5. **13-VERIFICATION.md** written with full SC#1–SC#4 evidence, the 12-item checklist roll-up,
   and the accepted non-blocking warnings.

## Inline remediation (D-06)

- `fix(13-03)` `3a8b41a` — `build.ts` emits `meta.xml` + `eml.xml` loose (byte-identical to zip
  members) so `verify-artifact.ts` can read `eml.xml` without unzipping.
- `fix(13-03)` `f9f4d35` — `validate-gbif.ts` parses the real GBIF schema
  (`metrics.indexeable` + `metrics.files[].issues[]`, top-level `status`); the prior top-level
  `indexeable`/`results[]` assumption returned `undefined → FAIL` on an indexable archive.
- `feat(13-03)` `c2efdcc` — EML resource `<contact>` enriched (positionName, address, onlineUrl).

## Decisions / notes

- **coordinateUncertaintyInMeters (D-04):** GBIF raised no warning → optional Maplify derivation
  not done (moot). Honest-NULL policy holds; field already at index 14 (Phase 12).
- **RESOURCE_CONTACTS warning:** non-blocking; accepted. Fully clearing it would need creator +
  metadataProvider individual enrichment (and possibly an ORCID) — out of proportion for a
  non-blocking flag once SC#1 passes.
- The `eml.ts` enrichment reaches the published archive on the next deploy/nightly (push to `main`).

## Key files

- created: `.planning/phases/13-verification-gbif-re-validation/13-VERIFICATION.md`
- modified: `scripts/dwca/build.ts`, `scripts/dwca/validate-gbif.ts`, `scripts/dwca/validate-gbif.test.ts`, `scripts/dwca/eml.ts`, `scripts/dwca/eml.test.ts`

## Verification

`npm test` (dwca suite) green: 128 passed / 11 skipped. SC#1–SC#4 confirmed in the built artifact.
ATTR-05 satisfied.

## Self-Check: PASSED
