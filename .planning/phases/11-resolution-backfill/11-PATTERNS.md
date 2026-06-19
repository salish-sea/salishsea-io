# Phase 11: Resolution & Backfill — Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 5
**Analogs found:** 5 / 5

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/ingest/resolve-provider.ts` | utility (pure function) | transform | `scripts/dwca/fields.ts` | role-match (pure module, no I/O) |
| `scripts/ingest/resolve-provider.test.ts` | test | — | `scripts/dwca/fields.test.ts` | exact (pure-function vitest test) |
| `supabase/migrations/20260619XXXXXX_resolution_schema.sql` | migration | CRUD / DDL | `supabase/migrations/20260619203013_source_table_fk_columns.sql` | exact (same phase pattern: slug-resolved DEFAULT, schema additions) |
| `supabase/snippets/11_resolution_assertions.sql` | test / smoke-test | request-response | `supabase/snippets/10_fk_columns_assertions.sql` | exact |
| `.planning/phases/11-resolution-backfill/maplify_census.tsv` | artifact (data) | — | `.planning/` convention | n/a (committed output, no code analog) |

---

## Pattern Assignments

---

### `scripts/ingest/resolve-provider.ts` (utility, transform)

**Analog:** `scripts/dwca/fields.ts`

**File header / doc-comment pattern** (fields.ts lines 1–26):
```typescript
/**
 * [One-line purpose — Phase NN Plan NN].
 *
 * [Locked decisions this implements, cross-referenced by D-XX id.]
 *
 * Cross-reference:
 *   - NN-NN-PLAN.md Task N for the full behavior spec.
 *   - NN-CONTEXT.md D-XX for the locked decisions.
 */
```

**Module shape pattern** — pure exports, no side effects, no imports from external packages for a data-only module:
```typescript
// fields.ts pattern: named typed exports only; no default export; no I/O
export type OccurrenceField = {
    readonly name: string;
    readonly termUri: string;
};

export const OCCURRENCE_FIELDS = [ ... ];
```

**Adapted shape for `resolve-provider.ts`** — pure function with typed result:
```typescript
// Mirrors the fields.ts "typed named export" convention
export type ProviderResolution = {
    readonly provider: string;    // slug matching public.providers.slug
    readonly collection: string;  // slug matching public.collections.slug
} | null;

export function resolveProvider(sourceUrl: string): ProviderResolution {
    // URL-pattern matching; no external dependencies; no side effects
}
```

**No external imports needed** — the resolver uses only `URL` (built-in) or regex. RESEARCH confirms: "no new npm packages installed in this phase."

---

### `scripts/ingest/resolve-provider.test.ts` (test, vitest)

**Analog:** `scripts/dwca/fields.test.ts` (pure-function test, no mocks needed)

**Import pattern** (fields.test.ts lines 1–3):
```typescript
import { describe, test, expect } from 'vitest';
import { OCCURRENCE_FIELDS, MULTIMEDIA_FIELDS } from './fields.ts';
```

**Adapted for resolve-provider.test.ts:**
```typescript
import { describe, test, expect } from 'vitest';
import { resolveProvider } from './resolve-provider.ts';
```

**Test structure pattern** (fields.test.ts):
```typescript
describe('resolveProvider', () => {
    test('returns correct provider+collection for known iNat URL', () => {
        expect(resolveProvider('https://www.inaturalist.org/observations/12345'))
            .toEqual({ provider: 'inaturalist', collection: 'inaturalist' });
    });

    test('returns null for unrecognized URL pattern', () => {
        expect(resolveProvider('https://example.com/foo')).toBeNull();
    });

    // One test per known URL pattern; one null/unknown test
});
```

**No mocks required** — function is pure; follows fields.test.ts pattern of no `vi.mock()` calls.

**Run command:** `npm test -- resolve-provider` (per RESEARCH Validation Architecture).

---

### `supabase/migrations/20260619XXXXXX_resolution_schema.sql` (migration, DDL + DML)

This spans three logical migrations (RESEARCH recommendation: split into schema / backfill / ingest-edit). The patterns below apply to all three.

**Analog:** `supabase/migrations/20260619203013_source_table_fk_columns.sql`

**Migration file header comment pattern** (source_table_fk_columns.sql lines 1–28):
```sql
-- Phase NN: [Title]
-- Implements [REQ-XX, REQ-YY] from .planning/REQUIREMENTS.md.
--
-- [What this migration does, one paragraph]
--
-- Intentional deviations:
--   [D-XX]: [description of deviation]
--
-- [Pitfall notes referencing RESEARCH.md by pitfall number]
```

**Pattern A: migration-resolved column DEFAULT** (source_table_fk_columns.sql lines 56–61, 93–98, 128–133):
```sql
-- Migration-resolved DEFAULT: store a plain integer literal; no subquery in DEFAULT (Pitfall 3)
DO $$ BEGIN
  EXECUTE format(
    'ALTER TABLE inaturalist.observations ALTER COLUMN collection_id SET DEFAULT %s',
    (SELECT id FROM public.collections WHERE slug = 'inaturalist')
  );
END $$;
```
Apply same `DO $$ BEGIN EXECUTE format(...) END $$` pattern for `native` (slug `salishsea-direct`) and `happywhale` (slug `happywhale`).

**Pattern B: idempotent backfill UPDATE guarded by IS NULL** (D-07):
```sql
-- Backfill existing rows by slug join; guarded so re-run is a no-op
UPDATE inaturalist.observations
  SET collection_id = c.id
  FROM public.collections c
 WHERE c.slug = 'inaturalist'
   AND collection_id IS NULL;
```

**Pattern C: SECURITY DEFINER helper function** — use `create_contributor_on_sign_in` from `supabase/migrations/20260203234153_individuals.sql` (lines 26–49) as the exact template:
```sql
-- From 20260203234153_individuals.sql lines 26–49 — the canonical SECURITY DEFINER shape:
CREATE FUNCTION public.create_contributor_on_sign_in() RETURNS TRIGGER AS $$
DECLARE
  v_contributor_id INTEGER;
BEGIN
  -- ... body using PL/pgSQL ...
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path='';
```

Adapted for `inaturalist.mint_contributor`:
```sql
CREATE OR REPLACE FUNCTION inaturalist.mint_contributor(
  inat_login text
) RETURNS integer LANGUAGE SQL VOLATILE SECURITY DEFINER
SET search_path = '' AS $$
  INSERT INTO public.contributors (name, inat_login)
  VALUES (inat_login, inat_login)
  ON CONFLICT (inat_login) DO NOTHING;
  SELECT id FROM public.contributors WHERE inat_login = $1;
$$;
```

Key: `SECURITY DEFINER SET search_path = ''` is **mandatory** — mirrors the individuals.sql precedent exactly. The `SET search_path=''` form uses an empty string (not `SET search_path TO ''`).

**Pattern D: `maplify.collection_rule` table + resolver function** (D-03, from RESEARCH Pattern 2):
```sql
CREATE TABLE maplify.collection_rule (
  id            INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  match_kind    TEXT NOT NULL CHECK (match_kind IN ('bracket', 'attribution', 'source')),
  match_value   TEXT NOT NULL,
  collection_id INTEGER NOT NULL REFERENCES public.collections(id),
  UNIQUE (match_kind, match_value)
);

CREATE FUNCTION maplify.resolve_collection(
  comments text,
  source   text
) RETURNS integer LANGUAGE SQL STABLE AS $$
  SELECT collection_id FROM maplify.collection_rule
   WHERE (match_kind = 'bracket'
          AND comments ~ '^\[([^\]]+)\]'
          AND match_value = (regexp_match(comments, '^\[([^\]]+)\]'))[1])
  UNION ALL
  SELECT collection_id FROM maplify.collection_rule
   WHERE match_kind = 'attribution'
     AND comments ~ match_value
  UNION ALL
  SELECT collection_id FROM maplify.collection_rule
   WHERE match_kind = 'source'
     AND match_value = source
  LIMIT 1;
$$;
```

**Pattern E: edited `maplify.update_sightings`** — replace bare `SELECT sightings.*` wildcard with explicit column list (RESEARCH Critical SQL, lines 226–245):
```sql
CREATE OR REPLACE FUNCTION maplify.update_sightings (
  start_date date = current_date,
  end_date date = current_date
) RETURNS void LANGUAGE SQL VOLATILE
BEGIN ATOMIC;
  DELETE FROM maplify.sightings
    WHERE created_at BETWEEN start_date::timestamp AND (end_date + interval '1 day')::timestamp;
  INSERT INTO maplify.sightings
    (id, project_id, trip_id, scientific_name, location, number_sighted,
     created_at, photo_url, comments, in_ocean, moderated, trusted, is_test, source, usernm,
     collection_id)
    SELECT
      id, project_id, trip_id, scientific_name, location, number_sighted,
      created_at, photo_url, comments, in_ocean, moderated, trusted, is_test, source, usernm,
      maplify.resolve_collection(comments, source)
    FROM
      gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)) AS bbox,
      maplify.fetch_date_range(start_date, end_date, bbox) AS sightings;
END;
```
`provider_id` is absent from the column list → DEFAULT fires. `contributor_id` and `source_url` absent → NULL.

**Pattern F: iNat MERGE contributor_id wiring** — add `contributor_id` only to `WHEN NOT MATCHED BY TARGET THEN INSERT`, not to the `WHEN MATCHED THEN UPDATE` (RESEARCH Pitfall 6). Use `inaturalist.mint_contributor(v.username)` as a scalar call inside the INSERT VALUES:
```sql
-- In the MERGE INSERT clause only:
INSERT (id, description, location, observed_at, license_code, uri, username,
        taxon_id, fetched_at, public_positional_accuracy, updated_at, contributor_id)
VALUES (v.id, v.description, v.location, v.observed_at, v.license_code, v.uri, v.username,
        v.taxon_id, v.fetched_at, v.public_positional_accuracy, v.updated_at,
        inaturalist.mint_contributor(v.username))
-- collection_id intentionally absent → DEFAULT fires
```

**Pattern G: `public.contributors.inat_login` column addition** (D-15):
```sql
ALTER TABLE public.contributors ADD COLUMN inat_login TEXT UNIQUE;
-- Existing native rows leave inat_login NULL (not backfilled)
```

---

### `supabase/snippets/11_resolution_assertions.sql` (smoke-test, SQL)

**Analog:** `supabase/snippets/10_fk_columns_assertions.sql`

**File header pattern** (10_fk_columns_assertions.sql lines 1–27):
```sql
\set ON_ERROR_STOP on
\echo === Phase 10 source-table FK column verification ===
--
-- Validates the FK-column migration (Phase 10) against the local Supabase database.
-- Every block corresponds to a success criterion in [PLAN.md reference].
--
-- Run:
--   supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/snippets/10_fk_columns_assertions.sql
--
-- Exit code 0 = SC#1–SC#N all pass.
-- Non-zero = first failing block's RAISE EXCEPTION message names the criterion.
--
-- [Local row count notes for context]
```

**Assertion block pattern** (10_fk_columns_assertions.sql lines 37–89):
```sql
\echo SC#N: [description of what is checked]
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE ...;
  IF n <> expected THEN
    RAISE EXCEPTION 'SC#N FAIL: [description] (found %, expected ...)', n;
  END IF;
END $$;
```

**Closing line pattern:**
```sql
\echo === All Phase 11 assertions passed ===
```

**Local vs prod split** — the 10_fk_columns snippet uses `IS DISTINCT FROM / count-zero form` assertions that are correct on 0-row tables. Phase 11 assertions should:
1. Assert schema/function existence (local and prod)
2. Assert `resolve_collection` returns known values for synthetic fixtures (local)
3. Assert `resolve_collection` returns NULL for unknown input (local)
4. Comment clearly that the prod diff-gate (SC#1: zero uncovered bracket tags) must be run manually against prod data

**Example synthetic-fixture assertion for resolver** (adapted from RESEARCH Pattern 4):
```sql
\echo SC#1: resolve_collection function exists and returns NULL for unknown input
DO $$
DECLARE result INTEGER;
BEGIN
  SELECT maplify.resolve_collection('no bracket tag here', 'unknown_source') INTO result;
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'SC#1 FAIL: resolve_collection returned % for unrecognized input (expected NULL)', result;
  END IF;
END $$;
```

**Prod diff-gate assertion** (D-08 — run against prod manually before phase sign-off):
```sql
-- PROD ONLY: assert zero uncovered tags (run psql against prod, not local reset)
-- \echo Diff-gate: all bracket tags covered by collection_rule
-- DO $$ DECLARE n BIGINT; BEGIN
--   SELECT COUNT(*) INTO n
--     FROM maplify.sightings s
--    WHERE s.comments ~ '^\[([^\]]+)\]'
--      AND NOT EXISTS (
--        SELECT 1 FROM maplify.collection_rule r
--         WHERE r.match_kind = 'bracket'
--           AND r.match_value = (regexp_match(s.comments, '^\[([^\]]+)\]'))[1]
--      );
--   IF n > 0 THEN RAISE EXCEPTION 'DIFF-GATE FAIL: % rows with uncovered bracket tags', n; END IF;
-- END $$;
```

---

### `.planning/phases/11-resolution-backfill/maplify_census.tsv` (artifact)

No code analog — this is a committed TSV of raw `psql` output from the prod `SELECT DISTINCT` census query. The file should be stored under `.planning/phases/11-resolution-backfill/` (consistent with where context/research files live for this phase). The prod census query is in RESEARCH.md (Production Census: How to Run Safely section).

---

## Shared Patterns

### Migration-Resolved DEFAULT (for all three `collection_id` DEFAULTs)
**Source:** `supabase/migrations/20260619203013_source_table_fk_columns.sql` lines 56–61
**Apply to:** All three `collection_id` DEFAULT tasks (iNat, native/`salishsea-direct`, HappyWhale)
```sql
DO $$ BEGIN
  EXECUTE format(
    'ALTER TABLE <schema>.<table> ALTER COLUMN collection_id SET DEFAULT %s',
    (SELECT id FROM public.collections WHERE slug = '<slug>')
  );
END $$;
```
Never use a hardcoded integer literal. Slug is the Phase 9 natural-key contract.

### SECURITY DEFINER + SET search_path
**Source:** `supabase/migrations/20260203234153_individuals.sql` lines 26–49
**Apply to:** `inaturalist.mint_contributor()` helper function
```sql
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path='';
-- or for SQL functions:
LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path = ''
```
The `SET search_path=''` (empty string, not `public`) is the exact form used in the codebase — match it exactly.

### Idempotent Backfill Guard
**Source:** `supabase/migrations/20260619203013_source_table_fk_columns.sql` lines 46–50
**Apply to:** All one-time UPDATE statements in the backfill migration
```sql
UPDATE <schema>.<table>
  SET collection_id = c.id
  FROM public.collections c
 WHERE c.slug = '<slug>'
   AND collection_id IS NULL;
```
`WHERE collection_id IS NULL` is the idempotent guard. Without it, re-running the migration would overwrite already-resolved rows.

### Vitest Pure-Function Test
**Source:** `scripts/dwca/fields.test.ts` lines 1–3
**Apply to:** `scripts/ingest/resolve-provider.test.ts`
```typescript
import { describe, test, expect } from 'vitest';
import { resolveProvider } from './resolve-provider.ts';
```
No `vi.mock()` needed — resolver is pure. Test with known URL → expected result + unknown URL → null.

---

## No Analog Found

None — all five deliverables have strong analogs in the codebase.

---

## Metadata

**Analog search scope:** `scripts/dwca/`, `supabase/migrations/`, `supabase/snippets/`
**Files scanned:** 6 analog files (fields.ts, fields.test.ts, guard.ts, guard.test.ts, 20260619203013_source_table_fk_columns.sql, 20260203234153_individuals.sql, 10_fk_columns_assertions.sql)
**Pattern extraction date:** 2026-06-19
