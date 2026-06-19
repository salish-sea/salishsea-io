---
created: 2026-06-18T15:45:00.000Z
title: Re-upload DwC-A zip to GBIF validator (DWCA-05 deferred)
area: phase-06-followup
files:
  - dist/dwca/salishsea-occurrences-v1.zip
  - .planning/REQUIREMENTS.md
  - .planning/phases/06-archive-generation/06-06-SUMMARY.md
---

## Why this is open

Phase 6 closed out 2026-06-18 with **DWCA-05** ("passes GBIF data validator")
explicitly deferred. The GBIF data validator service at
<https://www.gbif.org/tools/data-validator> was offline upstream on that date
and is expected to remain offline "for a while" (per project owner).

All other DwC-A requirements (DWCA-01..04, DWCA-06) are structurally verified
by `scripts/dwca/build.test.ts` and pass.

## What needs to happen

1. Check periodically whether <https://www.gbif.org/tools/data-validator>
   responds and accepts uploads. (No need to poll daily — monthly is fine.)
2. When back online:
   - Run a fresh local build:
     ```sh
     export SUPABASE_DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
     npm run build:dwca
     ```
   - Upload `dist/dwca/salishsea-occurrences-v1.zip` to the validator.
   - Capture the verdict (screenshot + verbatim text).
3. Update `.planning/REQUIREMENTS.md` — mark **DWCA-05** complete (or list
   blocking errors as a remediation plan).
4. Append a Verification Update section to
   `.planning/phases/06-archive-generation/06-06-SUMMARY.md` with the verdict
   and date.
5. Move this todo to `.planning/todos/completed/`.

## Acceptance criteria

GBIF validator reports the archive as valid (occurrence core recognized,
multimedia extension recognized) with zero blocking or structural errors.
Warnings are acceptable but should be recorded in the SUMMARY for v2 follow-up.

## Notes

- The integration test in `scripts/dwca/build.test.ts` is the regression net
  for the artifact shape; if it stays green, the archive should still pass
  whenever GBIF comes back. The GBIF check is corroborative, not load-bearing.
- Alternative tooling considered: GBIF's `dwca-validator` Java CLI and the
  Python `python-dwca-reader` library. These do structural checks but don't
  replicate the full server-side validator's biodiversity-specific rules
  (controlled vocab terms, taxonomy backbone checks). Use only as a fallback
  if GBIF stays down for >3 months.

---

## RESOLVED — 2026-06-19

GBIF validator came back online. User worked around a GBIF login issue, rebuilt
the archive locally (`npm run build:dwca`, 382-row local sample, identical
pipeline to nightly prod), and uploaded `dist/dwca/salishsea-occurrences-v1.zip`.

**Verdict: PASS — "can be indexed by GBIF", zero blocking/structural errors.**
Occurrence core recognized.

Updated:
- `.planning/milestones/v1.2-REQUIREMENTS.md` — DWCA-05 → Complete
- `.planning/milestones/v1.2-phases/06-archive-generation/06-06-SUMMARY.md` — Verification Update section + closeout table/footer
- `.planning/PROJECT.md` — 22/22 requirements; Active follow-ups updated

Warnings recorded as v2 follow-ups (non-blocking):
- `eml.xml`: `RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`
- occurrence: no `coordinateUncertaintyInMeters` (→ new todo 2026-06-19-emit-coordinate-uncertainty.md)
- occurrence: `country`/`continent` GBIF-derived from coords (informational)
- occurrence: many coordinates rounded by GBIF (informational)
