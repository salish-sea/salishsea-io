# Phase 13: Verification & GBIF Re-validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-21
**Phase:** 13-verification-gbif-re-validation
**Areas discussed:** Validator mechanism, Verification target, Warning scope, Sequencing, coordinateUncertaintyInMeters value policy, EML contacts, Remediation policy

---

## Validator mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Manual browser upload | Upload zip to gbif.org/tools/data-validator, paste result; manual UAT gate (matches v1.2 DWCA-05) | |
| GBIF validator API | Automate submission via REST API + poll for result | ✓ |
| You decide | Let research recommend based on API support | |

**User's choice:** GBIF validator API
**Notes:** Replaces v1.2's manual upload. Research must pin down endpoint/auth/result schema; manual upload is documented fallback.

---

## Verification target

| Option | Description | Selected |
|--------|-------------|----------|
| Live published nightly artifact | Download actual zip from salishsea.io/dwca/; requires confirming nightly regenerated | |
| Fresh locally-built archive | Run scripts/dwca/build.ts against prod DB, validate that | ✓ |
| Both | Spot-check live artifact + local pre-check | |

**User's choice:** Fresh locally-built archive
**Notes:** Build is deterministic from prod DB + committed code, so representative of nightly. Artifact-level checks run on the built occurrence.txt/eml.xml. Planner to capture the local==nightly equivalence in VERIFICATION so SC#1/#2 wording is provably met.

---

## Warning scope (coordinateUncertaintyInMeters + EML contacts)

| Option | Description | Selected |
|--------|-------------|----------|
| Stay deferred (v2) | Phase 13 only needs zero blocking errors; warnings stay v2 todos | |
| Clear them now | Add coordinateUncertaintyInMeters + enrich EML contacts | ✓ |
| Clear EML contacts only | EML metadata-only; coord-uncertainty stays deferred | |

**User's choice:** Clear them now
**Notes:** Pulls both deferred v2 warnings into scope. Surfaced the field-contract risk of coordinateUncertaintyInMeters as a follow-up.

---

## Sequencing (coordinateUncertaintyInMeters field-contract change)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline, as a gated sub-step | Isolated field-contract PR, npm test green before verification pass | ✓ |
| Split to its own phase | Keep Phase 13 pure verification; do it as Phase 14 | |
| You decide | Planner chooses | |

**User's choice:** Inline, as a gated sub-step

---

## coordinateUncertaintyInMeters value policy

| Option | Description | Selected |
|--------|-------------|----------|
| Per-channel constants | native vs Maplify default values | |
| Single global constant | One conservative value on every row | |
| Research proposes values | Research recommends GBIF-typical defaults | |
| (free text) → Derive honestly where possible | Emit value only where derivable (coord-rounding precision), NULL elsewhere | ✓ |

**User's choice:** First answered "if we don't know, pass null"; on surfacing that NULL-everywhere won't clear the warning, refined to **"Derive honestly where possible"** (NULL where not derivable).
**Notes:** Data integrity over warning-clearing — no fabricated constant. Warning may only partially clear; acceptable since SC#1 needs zero *blocking/structural* errors only. Native has only lat/lng (no accuracy); iNat/HappyWhale accuracy fields exist but are SRC-01-excluded.

---

## EML resource contacts

| Option | Description | Selected |
|--------|-------------|----------|
| Fill out the existing contact fully | Complete the single contact (name/email/role + required sub-elements) | ✓ |
| Add organization-level contact | Add SalishSea.io as org point-of-contact | |
| Research what GBIF requires | Pin down exactly which sub-elements GBIF flags | |

**User's choice:** Fill out the existing contact fully
**Notes:** Metadata-only edit in scripts/dwca/eml.ts. No separate org contact unless GBIF requires it.

---

## Remediation policy

| Option | Description | Selected |
|--------|-------------|----------|
| Fix inline, then re-verify | Phase 13 absorbs the fix; closes when green | ✓ |
| Stop & kick back to Phase 12 | Treat defect as Phase 12 regression | |
| Depends on severity | Blocking → reopen Phase 12; cosmetic → inline | |

**User's choice:** Fix inline, then re-verify

---

## Claude's Discretion

- Exact structure of the checklist run (prod-DB queries via `supabase db query --linked` vs. parsing the built artifact).
- Extend `scripts/dwca/verify-publish.ts` vs. add a new artifact-verification script.

## Deferred Ideas

- `coordinateUncertaintyInMeters` full coverage (per-channel constant / methodological floor) — only honest derivation this phase.
- Seeded-local-DB pre-prod build gate (`2026-06-21-seeded-local-db-gate-for-dwca-build.md`) — explicit follow-up after Phase 13.
