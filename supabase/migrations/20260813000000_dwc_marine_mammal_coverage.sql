-- Marine-mammal taxonomic coverage in the export metadata (decision 027).
--
-- POLICY §6.5 previously stated coverage as "Cetacea (Order)". Decision 027
-- widens the *intentional* scope to the PSEMP marine-mammal remit, and requires
-- the prose to state the SRC-01 gap: iNaturalist and HappyWhale are excluded
-- from the export, and they carry nearly every pinniped and otter record we
-- hold, so the realized archive stays overwhelmingly cetacean. Coverage is
-- stated, not derived — a small realized count is not an argument against the
-- wider statement (§6.5).
--
-- Published metadata says Pinnipedia, not iNaturalist's Phocoidea: strictly,
-- Phocoidea excludes sea lions, but iNat taxon 372843 is labeled "Pinnipeds"
-- and returns Otariidae. The ingest query keeps the iNat id; only the published
-- clade name is corrected (027).
--
-- Title and abstract widen with the coverage: a dataset titled "Cetacean
-- Occurrences" that declares Pinnipedia coverage contradicts itself. The
-- datasetID slug and the v1.3 version string are unchanged — the export
-- contract (columns, types, semantics) has not moved, only its description.
--
-- CREATE OR REPLACE VIEW works here: column count and types are unchanged; only
-- VALUES literals change (RESEARCH Pattern 7 / Pitfall 4).
CREATE OR REPLACE VIEW dwc.datasets AS
SELECT * FROM (
  VALUES (
    'https://salishsea.io/datasets/occurrences-v1'::text,           -- dataset_id (D-17)
    NULL::text,                                                     -- parent_dataset_id (D-16)
    'SalishSea.io Marine Mammal Occurrences (v1.3)'::text,          -- title (027: cetacean → marine mammal)
    'Native and Maplify/Whale Alert marine mammal sighting records from the Salish Sea region. Authored from observation tables in the SalishSea.io database, expressed as DarwinCore-aligned columns. In practice the archive is overwhelmingly cetacean; see the taxonomic coverage statement for why.'::text,  -- abstract
    CURRENT_DATE::text,                                             -- pub_date
    'en'::text,                                                     -- language
    'https://creativecommons.org/licenses/by-nc/4.0/legalcode'::text, -- intellectual_rights
    'SalishSea.io'::text,                                           -- creator_name
    'rainhead@gmail.com'::text,                                     -- creator_email
    'originator'::text,                                             -- creator_role
    'SalishSea.io'::text,                                           -- metadata_provider_name
    'rainhead@gmail.com'::text,                                     -- metadata_provider_email
    'Peter Abrahamsen'::text,                                       -- contact_name
    'rainhead@gmail.com'::text,                                     -- contact_email
    'pointOfContact'::text,                                         -- contact_role
    NULL::text,                                                     -- geographic_coverage
    NULL::text,                                                     -- temporal_coverage
    -- taxonomic_coverage (POLICY §6.5 stated; decision 027)
    'Salish Sea marine mammals, following the remit of the PSEMP Marine Mammal Working Group: Cetacea (whales, dolphins, porpoises), Pinnipedia (seals and sea lions), and Lutrinae (otters). The realized archive is overwhelmingly cetacean. Records sourced from iNaturalist and HappyWhale are excluded from this export because those platforms publish to GBIF themselves and re-export would duplicate them; they carry nearly all of the pinniped and otter observations SalishSea.io holds. Consumers seeking Salish Sea pinniped or otter records should consult those publishers directly.'::text,
    NULL::text                                                      -- methods
  )
) AS d (
  dataset_id,
  parent_dataset_id,
  title,
  abstract,
  pub_date,
  language,
  intellectual_rights,
  creator_name,
  creator_email,
  creator_role,
  metadata_provider_name,
  metadata_provider_email,
  contact_name,
  contact_email,
  contact_role,
  geographic_coverage,
  temporal_coverage,
  taxonomic_coverage,
  methods
);

COMMENT ON VIEW dwc.datasets IS 'Decision 027: taxonomic coverage widened to the PSEMP marine-mammal remit (Cetacea/Pinnipedia/Lutrinae) with the SRC-01 gap stated; title and abstract follow. M-03 single-row dataset reification (D-15..D-18). Phase 6 reads this for EML.';
