---
phase: 10
slug: source-table-fk-columns
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-19
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> This is a SQL-schema phase: the validation tool is a psql assertion snippet
> (`DO $$ … RAISE EXCEPTION … $$`) run against a freshly-reset local Supabase DB,
> mirroring `supabase/snippets/05_dwc_assertions.sql` and the Phase 9 precedent.
> Vitest exists for app TS but is **not** the tool for a schema migration.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | psql assertion snippet (self-contained `DO` blocks) |
| **Config file** | none — snippet is self-contained |
| **Quick run command** | `supabase db reset && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/snippets/10_fk_columns_assertions.sql` |
| **Full suite command** | same as above (exit 0 = all SC pass; non-zero = first failing block's RAISE message names the SC) |
| **Estimated runtime** | ~30 seconds (db reset dominates) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command (`supabase db reset` + snippet).
- **After every plan wave:** Same — full snippet green.
- **Before `/gsd-verify-work`:** Full snippet must exit 0.
- **Max feedback latency:** ~30 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | LINK-01/02/03 | — | New columns inherit table RLS; no new write surface | schema | `psql … -f supabase/snippets/10_fk_columns_assertions.sql` (SC#1) | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | LINK-02 | — | N/A | schema | snippet SC#2 (index on exported tables) | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | LINK-01 | — | provider_id default applies for new rows | data | snippet SC#3 (source_url) + provider_id backfill assertion | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | LINK-02 | — | NULL collection_id insert succeeds (no premature NOT NULL) | data | snippet SC#4 (synthetic Maplify insert + rollback + count) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs are indicative; planner sets the authoritative task breakdown. Sampling continuity holds — every task maps to an automated snippet assertion (no 3 consecutive tasks without automated verify).*

---

## Wave 0 Requirements

- [ ] `supabase/snippets/10_fk_columns_assertions.sql` — covers SC#1–SC#4 (new file; model on `05_dwc_assertions.sql` header/run-block style). Drop-in starting point provided in `10-RESEARCH.md` § Validation Architecture.
- [ ] No framework install needed (psql is bundled with the Supabase stack).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HappyWhale `source_url` resolves to a real viewable page | LINK-01 | Live HW page is an unverifiable SPA; repo-canonical form is `https://happywhale.com/individual/{individual_id};enc={id}` (NOT the `/encounter/{id}` guessed in CONTEXT D-09). Local HW table has 0 rows, so the snippet can only assert the *constructed string shape*, not that the URL loads. | After deploy, spot-check one prod HW row's `source_url` opens the correct encounter. If the planner gates the backfill on verification and it can't be confirmed, HW `source_url` stays NULL (HW is export-excluded — no archive impact). |

*All structural/data behaviors (SC#1–SC#4) have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (the assertion snippet) or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers the MISSING reference (the assertion snippet itself)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Note on local data:** Against a fresh `supabase db reset`, local row counts are native 0, iNat 201, HW 0, maplify 416. SC#3-native and any HW assertion are trivially satisfied locally but become load-bearing against prod data — the assertions are structurally correct regardless.

**Approval:** pending
