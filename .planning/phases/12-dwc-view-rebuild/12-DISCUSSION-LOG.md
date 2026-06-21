# Phase 12: DwC View Rebuild - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 12-dwc-view-rebuild
**Areas discussed:** Maplify recordedBy, NULL-collection datasetName, EML associatedParty
**Area deselected:** datasetName/ID shape (resolved via defaults in CONTEXT.md Claude's Discretion)

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Maplify recordedBy | SC#3 wants a human name "not opaque codes"; Phase 11 locked Maplify contributor_id = NULL | ✓ |
| NULL-collection datasetName | Some Maplify rows permanently NULL collection_id vs SC#3 "all prefixed SalishSea.io —" | ✓ |
| EML associatedParty | ATTR-04: which orgs, what role, org-less collections | ✓ |
| datasetName/ID shape | format string, version bump, datasetID per-collection?, dwc.datasets expansion | (not selected) |

---

## Maplify recordedBy

| Option | Description | Selected |
|--------|-------------|----------|
| Pass usernm, NULL the codes | Keep usernm where a real name, NULL known opaque machine codes | |
| Pass usernm unchanged | Leave recordedBy = s.usernm (codes leak); SC#3 unmet | |
| NULL all Maplify recordedBy | Uniform NULL | (initial answer) |
| **Extract now (final)** | View-time regex pulls parenthetical observer name `(Michelle Goll)` from comments, else NULL | ✓ |

**User's choice:** Initially "NULL is correct for now + backlog extraction"; after clarifying the
`comments` data model (usernm = submission UI, not observer; the name lives in parens in the
comment body), upgraded to **extract the parenthetical name at view-time now** (string, not FK).

**Notes:** User supplied the canonical parse model — `[Collection] subject (Observer Name)<br><br>
Submitted by a {Provider} Trusted Observer Via {Channel}`. Collection ← bracket tag; recordedBy ←
parens; provider/"via" ← trailing line. usernm is the submitting UI and is not useful for recordedBy.
A prod census of parenthetical contents must precede the regex (parens also hold non-names).

---

## NULL-collection datasetName

| Option | Description | Selected |
|--------|-------------|----------|
| Generic fallback bucket | Constant like "SalishSea.io — Maplify" | |
| NULL datasetName | Leave NULL when unresolved | |
| Exclude from export | Drop NULL-collection rows entirely | |
| **trusted filter + Whale Alert Global fallback (final)** | Don't export untrusted (no-comments) rows; trusted-but-no-comments fall back to Whale Alert Global | ✓ |

**User's choice:** First typed "Cascadia Whale Alert" (later corrected — that is the provider/"via"
path, not a collection). Final model: untrusted rows (no comments, `trusted=FALSE`) are **not
exported**; the only residual NULL-collection case (a trusted row lacking comments) falls back to
**Whale Alert Global**.

**Notes:** Trusted filter placement decided as **export view only** (`AND s.trusted` in
`dwc._maplify_occurrences`) over an ingest-level purge — keeps untrusted rows available to the app
and avoids reopening deployed Phase 11 ingest functions. Fallback implemented as a view-time COALESCE
(no data change). SC#5 row-count baseline + nightly guard tighten to trusted-only Maplify.

---

## EML associatedParty

| Option (which orgs) | Description | Selected |
|--------|-------------|----------|
| **Only those represented** | Data-driven: distinct organization_id across exported collections | ✓ |
| All seeded orgs | Static list of all 5 seeded organizations | |

| Option (role) | Description | Selected |
|--------|-------------|----------|
| **contentProvider** | Standard GBIF/EML role for orgs feeding an aggregated dataset | ✓ |
| originator | Connotes dataset author; blurs aggregator/source distinction | |
| custodianSteward | Connotes ongoing custody; mixed fit across orgs | |

**User's choice:** Credit **only organizations actually represented** in the exported archive, with
role **`contentProvider`**.

**Notes:** Today upstream orgs appear only as hardcoded prose in `eml.ts:140`; ATTR-04 makes them
structured `<associatedParty>` elements. Data-driven list implies a query/view at gen time.

---

## Claude's Discretion

- `datasetID` stays a single constant URI (not per-collection); only `datasetName` is per-collection.
- Archive version string bump v1.2 → v1.3 across datasetName/datasetID/EML `<title>` (Phase 13 verifies).
- `datasetName` uses `collection.name` verbatim (seeded "Whale Alert (Global)" parens may be normalized later).
- Migration split, exact regex form, and in-migration vs `supabase/snippets/12_*` row-count gate — follow Phase 9/10/11 precedent.

## Deferred Ideas

- Harder recordedBy extraction beyond the `(Name)`-after-bracket-tag pattern; eventual Maplify
  `contributor_id` FK + cross-provider unification (`contributor_links`).
- Ingest-level purge of untrusted Maplify rows (export-only exclusion this phase).
- Normalizing public collection display names (e.g. "Whale Alert (Global)" → "Whale Alert Global").
- GBIF DwC-A re-validation + "Looks Done But Isn't" checklist — Phase 13 (ATTR-05).
