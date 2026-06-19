---
phase: 9
slug: reference-table-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-19
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | psql assertion snippet (project convention for DB migrations; mirrors `supabase/snippets/05_dwc_assertions.sql`). No vitest coverage for raw SQL migrations. |
| **Config file** | none — runs directly against local Supabase DB |
| **Quick run command** | `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/snippets/09_reference_assertions.sql` |
| **Full suite command** | Same — the snippet IS the test suite for this phase |
| **Estimated runtime** | ~30–60 seconds (dominated by `supabase db reset`) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the quick run command (it is the full suite)
- **Before `/gsd-verify-work`:** Full assertion suite must exit 0 (`ON_ERROR_STOP=1`)
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 9-01-xx | 01 | 1 | PROV-01 | — | anon role can SELECT; RLS write-closed | smoke | quick run → SC-1 block | ❌ W0 | ⬜ pending |
| 9-01-xx | 01 | 1 | ORG-01 | — | orgs have non-null url; anon-readable | smoke | quick run → SC-2 block | ❌ W0 | ⬜ pending |
| 9-01-xx | 01 | 1 | COLL-01 | — | ~15+ collections; `aggregator_ingest` absent from enum; anon-readable | smoke | quick run → SC-3 block | ❌ W0 | ⬜ pending |
| 9-01-xx | 01 | 1 | CONTRIB-02 | — | nullable `orcid` column exists on `public.contributors` | structural | quick run → SC-4 block | ❌ W0 | ⬜ pending |
| 9-01-xx | 01 | 1 | CONTRIB-01 | — | per-provider contributor model intact; no cross-provider merge column | structural | quick run → SC-5 block | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/snippets/09_reference_assertions.sql` — psql assertion snippet covering all five ROADMAP success criteria (SC-1..SC-5), including the `SET ROLE anon; SELECT COUNT(*)` smoke tests, the `PERFORM 'aggregator_ingest'::public.collection_kind` enum-absence check (must raise), and the `information_schema.columns` ORCID-nullable check. SQL content specified in 09-RESEARCH.md §"Verification Approach".

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seed completeness vs. live prod census | COLL-01 | Phase 9 seeds a point-in-time census (D-08); the authoritative re-census is Phase 11 | Spot-check seeded collection slugs against v1.3-EXECUTIVE-SUMMARY §3; accept Phase 11 may add rows |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the assertions snippet)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
