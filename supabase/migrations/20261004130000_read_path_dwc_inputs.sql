-- The read-path build writes the Darwin Core archive itself (decision 061, salish-xv35.9),
-- from what it already holds plus three things only the archive reads: a contributor's
-- ORCID (recordedByID), a native sighting's stated accuracy
-- (coordinateUncertaintyInMeters), and the register's lineage for each taxon
-- (dwc.taxa_classification's phylum through genus). The archive publishes all three, so
-- granting them reaches nothing that isn't already public.
--
-- Pinned in supabase/read-path-grants.test.ts.

GRANT SELECT (orcid) ON public.contributors TO read_path;
GRANT SELECT (accuracy) ON public.observations TO read_path;
GRANT SELECT (entity_id, label, taxon_id, scientific_name, taxon_rank, kingdom, phylum, class,
              "order", family, genus)
  ON register.classification TO read_path;
