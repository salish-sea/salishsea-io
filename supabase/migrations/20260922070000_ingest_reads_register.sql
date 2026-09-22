-- The ingest role reads the register (salish-53t.3, decision 049).
--
-- Since 20260922060000 the Maplify ingest identifies each record by matching its names
-- against the register's (scripts/ingest/persist.ts, fetchNameIndex). The Edge Function
-- connects as the least-privilege `ingest` role (20260706130000), which had no USAGE on
-- the `register` schema, so the first tick after that deploy failed with "permission
-- denied for schema register" (production, 2026-09-22 23:30 UTC). Every test had run as
-- postgres, which is why nothing caught it; scripts/ingest/persist.test.ts now runs
-- fetchNameIndex and persistMaplify as `ingest`.
--
-- Applied to production by hand at 23:32 to restore the ingest; this makes every other
-- database agree. GRANT is idempotent, so it is a no-op where it has already run.
--
-- Exactly the four tables fetchNameIndex reads, read-only.
GRANT USAGE ON SCHEMA register TO ingest;
GRANT SELECT ON register.entities, register.names, register.deprecations, register.ancestor TO ingest;
