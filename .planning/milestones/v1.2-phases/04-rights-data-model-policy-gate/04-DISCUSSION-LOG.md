# Phase 4: Rights & Data-Model Policy (gate) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 4-rights-data-model-policy-gate
**Areas discussed:** Redistribution gate, Native consent basis, Attribution model, Count / occurrenceStatus, Public exposure / hold policy

---

## Redistribution gate

| Option | Description | Selected |
|--------|-------------|----------|
| Include + attribute | Default to full Maplify/Whale Alert scope with attribution; retreat only on explicit prohibition | ✓ |
| Strict gate | Include only if researcher finds explicit redistribution permission; else native-only | |
| Native-only now | Ship native records only; defer Maplify/Whale Alert to a later milestone | |

**User's choice:** Include + attribute (as the technical build default).

| Option | Description | Selected |
|--------|-------------|----------|
| Per-source drop | Drop only the disallowed sub-source(s), keep the rest (filter by maplify `source`) | ✓ |
| All-or-nothing | Treat the whole Maplify/Whale Alert feed as a single rights unit | |

**User's choice:** Per-source drop.

**Notes:** Reframed mid-discussion — see "Public exposure / hold policy" below. Most sources have no clear redistribution policy, so the include-and-attribute default governs what's *built*, while public exposure of third-party records is gated on organizational conferral, not a ToS guess.

---

## Native consent basis

| Option | Description | Selected |
|--------|-------------|----------|
| Platform-policy assertion | SalishSea.io asserts CC-BY-NC 4.0 as operator/aggregator; record absence of explicit consent notice as a finding | |
| Contributor-retains + implied | Contributor keeps copyright; publish on implied-consent basis | |
| Add notice going forward | Platform-policy assertion for existing records + recommend a submission-form notice going forward | ✓ |

**User's choice:** Add notice going forward.

| Option | Description | Selected |
|--------|-------------|----------|
| Defer (note only) | Submission-form notice out of scope for v1.2; capture as recommendation | |
| In scope | Pull the submission-form notice into this milestone (touches app runtime) | ✓ |

**User's choice:** In scope.

**Notes:** Flagged that this widens v1.2 beyond the "app runtime untouched" framing and needs a roadmap home — captured as a roadmap ripple in CONTEXT.md.

---

## Attribution model

| Option | Description | Selected |
|--------|-------------|----------|
| Beam Reach / SalishSea.io | rightsHolder = publishing org; recordedBy = contributor | |
| Individual contributor | rightsHolder = individual contributor per-record; recordedBy = same | ✓ |

**User's choice:** Individual contributor (native rightsHolder).

| Option | Description | Selected |
|--------|-------------|----------|
| recordedBy + datasetName + dynProps | observer → recordedBy, sub-source → datasetName, chain → dynamicProperties | ✓ |
| institutionCode/collectionCode | aggregator → institutionCode, sub-source → collectionCode | |
| Minimal dynProps string | pack entire provenance chain into one dynamicProperties field | |

**User's choice:** recordedBy + datasetName + dynProps.

| Option | Description | Selected |
|--------|-------------|----------|
| Originating sub-source | Third-party rightsHolder = nested origin (Orca Network/Cascadia), fallback to aggregator | ✓ |
| Aggregator (Whale Alert) | Third-party rightsHolder = Whale Alert/Maplify; sub-source in provenance only | |

**User's choice:** Originating sub-source.

---

## Count / occurrenceStatus

| Option | Description | Selected |
|--------|-------------|----------|
| Always present + count-when-known | occurrenceStatus=present on every record; individualCount only when known | ✓ |
| Count-when-known, omit status | individualCount when known; no occurrenceStatus | |
| Status only when count absent | occurrenceStatus only where no individualCount | |

**User's choice:** Always present + count-when-known.

| Option | Description | Selected |
|--------|-------------|----------|
| Emit available, flag minimums | Emit count as individualCount; flag known min/lower-bound in dynamicProperties | ✓ |
| Emit as-is | Emit whatever count exists, no min/range distinction | |
| Omit imprecise counts | Only emit genuine exact counts; omit min/range sources | |

**User's choice:** Emit available, flag minimums.

---

## Public exposure / hold policy

(Introduced by the user's reframe: build the archive and use it to clarify/frame the open questions, but hide the public download link until conferring with the source organizations.)

| Option | Description | Selected |
|--------|-------------|----------|
| Hosted but unlinked | Publish to stable /dwca/ URL as designed; suppress only the frontend link ("unlisted") | ✓ |
| Private until conferral | Generate/validate only; do not publish to public path at all | |
| Hosted, access-gated | Publish behind token/basic-auth/signed URL (more infra than budgeted) | |

**User's choice:** Hosted but unlinked.

| Option | Description | Selected |
|--------|-------------|----------|
| Hold everything | Entire archive (native + third-party) unexposed until conferral | |
| Native can go public | Native-only archive may be exposed/linked now; third-party held until conferral | ✓ |

**User's choice:** Native can go public.

**Notes:** Implies a possible native-only public archive variant vs. the full held archive — left as an open implementation question for the planner (D-07).

---

## Claude's Discretion

- Exact `dynamicProperties` key/value structure (provenance chain, min-count flag).
- Document format/layout of the gaps-and-policy artifact, provided every audited gap has a resolution or an explicit conferral-question.

## Deferred Ideas

- Submission-form consent/license notice (in scope per user, but needs a roadmap home — touches app runtime).
- DOWNLOAD-01 shipping hidden + a native-only archive variant (Phase 8 nuance).
- Organizational conferral with Whale Alert / Orca Network / Cascadia — out-of-band non-engineering task that gates un-hiding third-party records.
