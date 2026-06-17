---
created: 2026-06-17T23:57:49.429Z
title: Model embedded dataset attributions as first-class sources
area: database
files:
  - supabase/migrations/20260617203900_dwc_schema.sql
  - supabase/migrations/20260204013006_sightings_uses_contributors.sql
---

## Problem

`maplify.sightings.comments` carries dataset/organization attribution as free
text — a leading `[Source]` tag and/or a trailing `Submitted by a … Trusted
Observer …` line — rather than a normalized reference. Today only the leading
bracket form ever gets surfaced (and even then, just as part of the comment
body). Identifiers and organizations worth modeling as their own datasets /
contributors:

Leading-bracket sources (counts from prod, 2026-06-17, n=2,323):

- `[Orca Network]` — 2,239 (plus typo variants: `Orca Networ`, `Orca Neteork`,
  `Orca Networks`, ` Orca Network`)
- `[PSWS]` — 31  (Puget Sound Whale Sightings? unconfirmed)
- `[MCW]` — 12
- `[CWW]` — 10
- `[WSSJI]` — 5
- `[Orcasound]` — 3
- `[HIWS]` — 3
- `[WA]` — 2
- `[MBARI]` — 2
- `[SSCH]`, `[SA]`, `[PSWW]`, `[Bremerton FB group]` — 1 each

Trailing `Submitted by …` attributions (counts from prod, n≈3,524):

- Cascadia Trusted Observer (Via Webmap / Via App) — 2,000
- Whale Alert Global Trusted Observer Via App — 801
- Whale Alert Alaska Trusted Observer (Via Webmap / Via App) — 620
- TMMC Trusted Observer (Via App) — 103

Inline / non-bracketed dataset mentions also seen:

- WhaleSpotter (thermal-imaging automated detections)
- Point Blue Lighthouse (Observer)

This matters now because Phase 6 (`dwc.occurrences`) is unifying occurrence
sources for Darwin Core export — these strings are currently invisible to the
`datasetName` / `institutionCode` / `rightsHolder` mapping and roll up under a
single "Maplify" bucket.

## Solution

TBD. Options to consider:

1. Add a `maplify.sources` (or `datasets`) lookup keyed by the canonical
   bracket tag / submitter phrase, with display name, org, and a URL. Parse
   `comments` once at ingest into `source_id` + cleaned body.
2. Extend the existing `public.contributors` model to cover these external
   datasets (they're contributor-like but not user accounts).
3. Surface in `dwc.occurrences` via `datasetName` / `institutionCode` columns
   keyed off the parsed tag, with a fallback to "Maplify" for the long tail.

Worth a `gsd-explore` pass before committing — the bracket-tag dictionary is
small and stable, but the trailing "Submitted by …" form is the higher-volume
channel and lives in the same column.
