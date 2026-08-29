-- species_id has to read inaturalist.taxa, so it must run as its definer (production
-- incident, 2026-08-29).
--
-- Migration 20260829020000 taught the function to resolve a retired parent, which turned
-- a pure CASE over its argument into a function with a table read in it. That is the
-- whole difference. A VIEW checks the objects it references against the view's OWNER, so
-- public.occurrences reading inaturalist.taxa was always fine; a FUNCTION BODY is checked
-- against the CALLER, and anon has no USAGE on the inaturalist schema. Every anonymous
-- read of public.occurrences therefore failed with
--
--   42501: permission denied for schema inaturalist
--
-- which the post-deploy smoke test caught: the calendar's sighting-volume query 401ed on
-- production. Missed locally because psql connects as postgres, a superuser, where the
-- distinction does not exist. `SET ROLE anon` reproduces it in one line.
--
-- SECURITY DEFINER runs the body with the function owner's rights, which are the same
-- rights the view already reads that table with, so this grants the caller nothing the
-- occurrence did not already show them. The alternative, GRANT USAGE ON SCHEMA
-- inaturalist TO anon, is a wider change: it would make every already-granted object in
-- the mirror schema reachable, to fix one function.
--
-- Both branches resolve, so the answer does not depend on what the caller hands in. The
-- species branch cannot fire through public.occurrences, which resolves the leaf before
-- calling and so passes a live row whose current_taxon_id is NULL. It matters for the next
-- caller: a function that resolved the parent but trusted its argument would hand back a
-- mixed answer, and this is the shape of thing nobody re-reads before reusing.
--
-- SET search_path = '' because a SECURITY DEFINER function without one resolves unqualified
-- names through the caller's search_path, which the caller controls. Everything inside is
-- schema-qualified. The bare 'species' literal is not a name lookup; Postgres types it
-- from taxon.rank.
CREATE OR REPLACE FUNCTION inaturalist.species_id(taxon inaturalist.taxa)
RETURNS INTEGER LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT CASE
  WHEN taxon.rank < 'species'
    THEN (SELECT COALESCE(p.current_taxon_id, p.id) FROM inaturalist.taxa p
           WHERE p.id = taxon.parent_id)
  WHEN taxon.rank = 'species' THEN COALESCE(taxon.current_taxon_id, taxon.id)
  ELSE NULL
END;
$$;
