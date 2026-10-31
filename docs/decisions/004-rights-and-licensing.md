# 004 — Rights & licensing: policy-first gate, per-source licenses

**Status:** accepted · **Decided:** v1.2 Phase 4 (2026-06-10)

*Amended 2026-10-31 ([101](101-the-data-download-is-public.md)):* the hold on third-party records has ended; the archive is public with every source.

*Amended 2026-10-30 ([086](086-what-we-know-now-is-a-file-to-poll.md), #739):* native records are CC-BY 4.0, not CC-BY-NC, under a [terms of use](https://salishsea.io/terms.html) each contributor agrees to in the app, and the archive includes a contributor's records only once they have; every record in the archive is now CC-BY 4.0. The consent basis of D-08 (a platform policy and a form notice, neither of which ever existed) is replaced; the rights policy's §1.3 says how.

## Decision

All rights, licensing, and attribution questions were resolved in a single policy document **before any export SQL was written**. The full policy (decisions D-01…D-20) is preserved at [docs/rights-policy.md](../rights-policy.md) — it remains the source of truth.

## Key points

- **Per-source license, not one constant:** native records = CC-BY-NC 4.0 (*superseded 2026-10-30: CC-BY 4.0 under the terms of use, per the amendment above*); Maplify/Whale Alert = CC-BY 4.0 (contributors assert CC-BY at Acartia registration — the cooperative layer resolves redistribution rights upstream). Canonical `/legalcode` URIs (GBIF's parser requires them).
- **Whale Alert disambiguation (load-bearing):** the source is `whalealert.org` / Conserve.IO (marine mammal app, WASEAK API). `whale-alert.io` is an unrelated crypto service — its ToS are irrelevant. An earlier draft wrongly concluded "no redistribution license stated" by missing the Acartia layer.
- **Photo licensing:** per-photo license converter to canonical CC URIs; `none` (terminal: no license) and `NULL` (non-terminal: unclassified) are distinct CASE branches — both excluded today, but the split preserves a future "classify your photos" hook. Maplify photos excluded entirely (no license column).
- **`coordinateUncertaintyInMeters`: emit when known, omit when NULL, never 0** (invalid per TDWG).
- **Unvalidated whale IDs (e.g. T065S) are never emitted as `organismID`/`catalogNumber`** — at most listed in `dynamicProperties.unvalidatedIdentifiers`.
- **Publisher identity:** creator/metadataProvider = SalishSea.io; individual contact lives in `dwc.datasets`, deliberately not committed to docs.
- *Ended 2026-10-31 by [101](101-the-data-download-is-public.md): the check is done, and the courtesy notifications are no longer a condition.* ~~**Hosted-but-unlinked hold reframed** from a rights gate to a data-QA gate plus a 2–4 week courtesy-notification window to Conserve.IO/Orca Network/Cascadia.~~

## Why policy-first

A policy gate before SQL prevents silently fudging rights gaps in the encoding — every gap is either resolved or explicitly documented as a gap.
