---
phase: 09-reference-table-foundation
reviewed: 2026-06-19T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - supabase/migrations/20260619184037_reference_tables.sql
  - supabase/snippets/09_reference_assertions.sql
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-19
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the Phase 9 reference-table migration and its psql assertions snippet. I applied the
migration state and the assertions against the live local Supabase DB
(`127.0.0.1:54322`) to verify claims empirically rather than by inspection alone.

**Security posture is sound.** All three reference tables (`providers`, `organizations`,
`collections`) have RLS enabled and expose exactly one permissive `FOR SELECT USING (true)`
policy for `anon, authenticated`. No write policy exists, so writes are closed. I confirmed
empirically that `anon` holds Supabase's default table-level `INSERT/UPDATE/DELETE/SELECT`
grants on these tables (inherited from `public`-schema default privileges, identical to the
existing `contributors`/`observations` tables), which means write-closedness rests **entirely**
on RLS having no write policy. That is the correct and intended design here and matches repo
convention — there is no GRANT or RLS misconfiguration. Anon `INSERT` is rejected
(`insufficient_privilege` via WITH CHECK), and anon `UPDATE`/`DELETE` silently affect 0 rows.

**Functional correctness verified:** the `collection_kind` enum has exactly the 5 locked values
with `aggregator_ingest` absent; 4 providers / 5 organizations / 21 collections seeded; 10 named
collections carry non-null kind and 11 acronym stubs carry NULL kind; FK subqueries resolve
organization ids correctly; `orcid` is a nullable `text` column. Idempotency via `ON CONFLICT
(slug) DO NOTHING` and `ADD COLUMN IF NOT EXISTS` is correct, and the lack of `IF NOT EXISTS`
on `CREATE TYPE`/`CREATE TABLE` matches established repo convention (migrations run once).

The findings below are all in the **assertions snippet** — gaps between what the assertions
claim to prove and what they actually prove. None block the migration itself.

## Warnings

### WR-01: Write-closed assertion proves only INSERT, not UPDATE/DELETE

**File:** `supabase/snippets/09_reference_assertions.sql:204-218`
**Issue:** The T-09-01 block is titled "RLS write-closed" and its passing NOTICE claims the
"RLS write-closed policy" is correct, but it only exercises `INSERT`. Because `anon` holds the
default table-level `UPDATE`/`DELETE` grants, write-closedness for those verbs depends solely on
the absence of `UPDATE`/`DELETE` RLS policies. I confirmed an anon `UPDATE` does **not** raise —
it silently affects 0 rows. A regression that added a permissive `FOR UPDATE USING (true)` policy
would pass this assertion while opening a write hole, because the test never checks UPDATE/DELETE.
A security-control assertion should cover every verb it claims to close, and should be checked on
all three tables (`organizations` and `collections` are not exercised at all).
**Fix:** Add UPDATE and DELETE probes that assert 0 rows affected (and INSERT rejection) on each
reference table. UPDATE/DELETE will not raise, so assert row count instead:
```sql
SET ROLE anon;
DO $$
DECLARE c int;
BEGIN
  UPDATE public.providers SET name = name;          -- USING filters all rows under RLS
  GET DIAGNOSTICS c = ROW_COUNT;
  IF c <> 0 THEN
    RAISE EXCEPTION 'T-09-01 FAIL: anon UPDATE on providers affected % rows (RLS write hole)', c;
  END IF;
  DELETE FROM public.providers;
  GET DIAGNOSTICS c = ROW_COUNT;
  IF c <> 0 THEN
    RAISE EXCEPTION 'T-09-01 FAIL: anon DELETE on providers affected % rows (RLS write hole)', c;
  END IF;
END $$;
RESET ROLE;
-- repeat for organizations and collections
```

### WR-02: No assertion that collection->organization FK subqueries resolved

**File:** `supabase/snippets/09_reference_assertions.sql:113-124` and migration lines 112-116
**Issue:** Named collections resolve `organization_id` via `(SELECT id FROM public.organizations
WHERE slug = '...')`. If an org slug were ever mistyped (e.g. organization seeded as `cascadia`
but collection subquery referenced `cascadia-research`), the subquery returns NULL and the row is
seeded with a NULL `organization_id` **silently** — there is no FK violation (the column is
nullable) and no assertion fails. SC-3 checks `kind IS NULL` for named collections but never
checks that their `organization_id` resolved. This defeats the stated purpose of the slug-subquery
pattern (Pitfall 3) by leaving the resolution unverified.
**Fix:** Assert that the org-backed named collections have non-null `organization_id`:
```sql
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM public.collections
   WHERE slug IN ('orca-network','cascadia','tmmc','orcasound','mbari')
     AND organization_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'SC-3 FAIL: % org-backed collection(s) have NULL organization_id (FK subquery failed to resolve)', n;
  END IF;
END $$;
```

### WR-03: Row-count assertion (`n < 10`) contradicts its own documented expectation

**File:** `supabase/snippets/09_reference_assertions.sql:86,95-96`
**Issue:** The SC-3 section header (line 86) says "~15+ rows" and the failure message (line 96)
says "expected at least 10", but the actual seed produces 21 collections. The guard `n < 10` is
loose enough that losing roughly half the seed (e.g. all 11 stubs failing to insert, or the entire
named block being dropped) would still pass. This is an assertion that does not meaningfully guard
the criterion it documents, and the header comment and message disagree with each other.
**Fix:** Tighten to the actual expected count and align the messages. Since the seed is fixed at
21, assert exact equality (or `n < 21`):
```sql
IF n <> 21 THEN
  RAISE EXCEPTION 'SC-3 FAIL: collections has % rows (expected exactly 21: 10 named + 11 stubs)', n;
END IF;
```

## Info

### IN-01: Stub NULL-kind invariant is asserted only in one direction

**File:** `supabase/snippets/09_reference_assertions.sql:113-124`
**Issue:** SC-3 asserts that named collections do NOT have NULL kind, but never asserts the
converse — that the 11 acronym stubs DO have NULL kind. A regression that accidentally assigned a
kind to a stub would pass. Low impact (stubs are decoded in Phase 11) but the invariant is stated
in the design (D-09) and left half-checked.
**Fix:** Add a complementary check that stub slugs (`psws`, `mcw`, ...) have `kind IS NULL`, or
assert exact partition counts (10 non-null kind, 11 null kind).

### IN-02: SC-2 does not verify expected organization count or rights_holder_text coverage

**File:** `supabase/snippets/09_reference_assertions.sql:56-72`
**Issue:** SC-2 only asserts `organizations` is non-empty and has no NULL `url`. It never checks
the expected count (5) nor that `rights_holder_text` (NOT NULL in the schema, used downstream for
EML associatedParty in Phase 12) is populated for every row. A partial seed of organizations would
pass SC-2 while later breaking collection FK resolution (see WR-02).
**Fix:** Assert `COUNT(*) = 5` for organizations and add a `WHERE rights_holder_text IS NULL OR
rights_holder_text = ''` zero-row check.

### IN-03: SC-5 contributor checks are structural-only and cannot fail on a fresh local DB

**File:** `supabase/snippets/09_reference_assertions.sql:174-198`
**Issue:** SC-5's row-count block only emits a NOTICE (`public.contributors has % rows`) and never
asserts anything — on a fresh `supabase db reset` it reports 0 rows, which the comment
acknowledges is acceptable. The only real assertion in SC-5 is the absence of a `provider_id`
column. This is fine for this phase, but the section title "per-provider contributor model intact"
overstates what is verified; the snippet proves only that `contributors` exists and lacks
`provider_id`. No fix required if intentional; consider renaming the echo to reflect the actual
structural check.

---

_Reviewed: 2026-06-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
