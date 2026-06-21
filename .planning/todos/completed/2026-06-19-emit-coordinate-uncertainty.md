---
created: 2026-06-19T00:00:00.000Z
title: Emit coordinateUncertaintyInMeters on DwC occurrence records
area: dwca
files:
  - supabase/migrations/20260617203900_dwc_schema.sql
  - scripts/dwca/fields.ts
---

## Why this is open

The GBIF DwC-A validator (run 2026-06-19 to close DWCA-05) reported the archive
as indexable with zero blocking errors, but flagged that **no occurrence records
carry `coordinateUncertaintyInMeters`**. The user wants to address this.

`coordinateUncertaintyInMeters` is a recommended DwC term: the horizontal
distance (in meters) from the stated lat/long describing the smallest circle
containing the whole location. GBIF uses it for fitness-for-use filtering;
records without it are harder for downstream consumers to trust spatially.

## What needs to happen (sketch — confirm during planning)

1. Decide the source of uncertainty per channel:
   - Native app submissions — is there a captured GPS accuracy, or a
     map-click vs. device-GPS distinction we can map to a value?
   - Maplify / aggregated sources — likely a coarse per-source default
     (these are often human-reported / rounded; GBIF already noted many
     coordinates were rounded).
2. Add `coordinateUncertaintyInMeters` to the `dwc.occurrences` projection
   (and the ordered field list in `scripts/dwca/fields.ts` — this changes
   `OCCURRENCE_FIELDS` count and meta.xml indices, so update the round-trip
   tests).
3. Rebuild + re-validate against GBIF; confirm the warning clears.

## Notes

- This is a v2 / future-milestone item, not load-bearing for any shipped
  requirement. Captured from the DWCA-05 closeout.
- Related v2 follow-up from the same validator run: enrich `eml.xml`
  resource contacts (`RESOURCE_CONTACTS_MISSING_OR_INCOMPLETE`).
- Touching `fields.ts` ordering ripples into the meta.xml descriptor and the
  GeoParquet column set — see the F-02 single-source-of-truth invariant in
  `scripts/dwca/build.test.ts`.
