---
phase: 12
slug: dwc-view-rebuild
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing `scripts/dwca/*.test.ts` suite) + Supabase SQL assertion snippets (`supabase/snippets/NN_*.sql`) |
| **Config file** | repo `package.json` test script; `supabase/config.toml` for local DB |
| **Quick run command** | `npm test -- scripts/dwca/fields.test.ts scripts/dwca/meta-xml.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30–60 seconds (TS suite); SQL assertion snippets run against local/prod DB separately |

---

## Sampling Rate

- **After every task commit:** Run `npm test` for the affected `scripts/dwca/*.test.ts` file(s)
- **After every plan wave:** Run full `npm test`
- **Before `/gsd-verify-work`:** Full `npm test` green AND the SC#1–SC#5 SQL assertion snippet green against the rebuilt views
- **Max feedback latency:** ~60 seconds (TS); SQL checks require a DB with data (local reset is a no-op for prod-only Maplify rows — see RESEARCH D-07 precedent)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | ATTR-01/02 | — | comments parenthetical-name census artifact committed (read-only); regex covers prod trusted rows without garbage | snapshot/SQL | `psql -f supabase/snippets/12_comments_census.sql` (read-only) | ❌ W1 | ⬜ pending |
| 12-02-01 | 02 | 2 | ATTR-01/02/03 | — | rebuilt views emit 26 cols; institutionCode='SalishSea', rightsHolder='SalishSea.io', per-collection datasetName; trusted-only Maplify; SRC-01 by 2-branch UNION | SQL | `psql -f supabase/snippets/12_dwc_assertions.sql` (SC#1/2/3/5) | ❌ W2 | ⬜ pending |
| 12-03-01 | 03 | 2 | ATTR-05-prep | — | `OCCURRENCE_FIELDS.length === 26`; `assertFieldAlignment` view↔array parity; meta.xml 26-field ordinal | unit | `npm test -- scripts/dwca/fields.test.ts scripts/dwca/meta-xml.test.ts` | ✅ | ⬜ pending |
| 12-04-01 | 04 | 3 | ATTR-04 | — | EML emits `<associatedParty role="contentProvider">` for represented orgs only; never institutionCode | unit | `npm test -- scripts/dwca/eml.test.ts` | ✅ | ⬜ pending |
| 12-05-01 | 05 | 3 | ATTR-03 | — | nightly row-count guard uses trusted-only Maplify baseline; fails if exported > baseline | unit | `npm test -- scripts/dwca/guard.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/snippets/12_comments_census.sql` — read-only prod census of `maplify.sightings.comments` parenthetical patterns (blocks recordedBy regex — RESEARCH D-03)
- [ ] `supabase/snippets/12_dwc_assertions.sql` — SC#1–SC#5 SQL assertions against the rebuilt `dwc.occurrences` (precedent: `05_dwc_assertions.sql`, `11_*`)
- Existing vitest infrastructure covers all TS-side phase requirements (fields/meta-xml/eml/guard test files already present).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC#1/2/3/5 distinct-value + row-count assertions against **prod** data | ATTR-01/02/03 | Local `supabase db reset` lacks prod-only Maplify rows (~6,800); the data assertions are only meaningful against prod via the IPv4 session pooler | Run `12_dwc_assertions.sql` against prod after deploy (Phase 13 re-validates the regenerated archive) |
| recordedBy regex correctness on the full prod comment corpus | ATTR-01 | Sample (169 rows) ≠ full corpus; edge cases (multi-person, ID-credit parens) need the full trusted-row census | Inspect `12_comments_census.sql` output before finalizing regex; spot-check extracted names |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0/1 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0/1 covers all MISSING references (the comments census)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (TS suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
