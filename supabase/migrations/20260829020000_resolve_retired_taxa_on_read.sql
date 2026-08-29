-- A retirement is resolved when a taxon is READ, not by rewriting what was recorded
-- (salish-4hq, decision 032).
--
-- iNaturalist retires a taxon by marking it inactive and naming a replacement. Until now
-- the only thing that acted on that was scripts/backfill/inat-taxa-status.ts, which
-- UPDATEs the id out of every column that references it. Two problems with repairing it
-- that way, and they point in opposite directions:
--
--   * inaturalist.observations.taxon_id and maplify.sightings.taxon_id are UPSTREAM's.
--     Decision 008 makes the source schemas verbatim mirrors, and the ingest can undo a
--     repoint on the next run: the observation upsert writes taxon_id whenever
--     updated_at advances, and Maplify's taxon_id is re-derived from the sighting's name
--     on every re-fetch. A repair the writer reverts is not a repair.
--   * public.observations.taxon_id is a CONTRIBUTOR's determination — a person said what
--     they saw. Rewriting it is a silent edit of someone's claim, which is worse than
--     leaving it alone, not better.
--
-- Both stored ids record what was CLAIMED, by upstream or by a person. Resolution is a
-- reading concern, and this is the boundary decision 008 asks us to translate at. So the
-- id stays as claimed and every read hops through current_taxon_id.
--
-- WHAT CHANGES, CONCRETELY
--
-- `t_recorded` is the taxon as the record names it; `t` is the taxon it currently is.
-- Everything the occurrence shows — scientific_name, species_id (which chains sightings
-- of one species into a track, so a retirement otherwise splits one animal into two
-- colours on the map), the vernacular fallback — now reads off `t`.
--
-- The register join keeps working unchanged, and drops its own COALESCE: it carried the
-- only hop we had (migration 20260828110000), and now the hop happens once at the leaf
-- and serves every column instead of just that lookup. One hop is the right number:
-- iNaturalist's current_synonymous_taxon_ids names the CURRENT taxon rather than an
-- intermediate, so a chain in the mirror is a stale row for the weekly refresh to fix,
-- not a depth for this view to walk.
--
-- inaturalist.species_id() gets the same treatment, one level up. For a subspecies it
-- returns the PARENT's id, read straight off the row, so a live subspecies under a
-- retired species would keep chaining onto the dead id and split the track this view
-- resolves the leaf to prevent. The hop belongs in the function rather than in four
-- copies of a CASE expression in the view.
--
-- The `par` join (a subspecies displaying its species' NAME) is deliberately NOT hopped.
-- It looks into register.inaturalist_taxon_name, which is ours and curated: a live
-- subspecies under a retired species would need a register edit regardless, and that is
-- where the fix belongs.
--
-- dwc.taxa_classification hops at the leaf AND at every ancestor step. That is not
-- symmetry for its own sake — parent_id is the one link the backfill deliberately
-- refuses to repoint ("ancestry, not an observation"), so read time is the only place a
-- retired genus can be resolved. The mirror holds four taxa under a retired genus today.
--
-- SCOPE. Both views keep their exact column lists, so CREATE OR REPLACE preserves the
-- dependency chain above public.occurrences (occurrence_index,
-- occurrence_identifier_candidates, group_occurrences/ecotype_occurrences) and the two
-- dwc leaf views. Verified read-only against production before shipping: no occurrence
-- and no exported row changes — nothing currently references a retired taxon, the #397
-- backfill having repointed the 38 records that did. Two dwc.taxa_classification LEAF
-- rows do change (the two retired taxa that name a mirrored replacement); they are the
-- keys nobody joins on today, and answering for them is the whole point. This ships as a
-- safety net, not a correction.

-- species_id chains sightings of one species into a track. For a subspecies it reports
-- the parent species, so the parent needs resolving too; for a species it reports itself,
-- and the view has already resolved that row. One hop, as everywhere else here.
CREATE OR REPLACE FUNCTION inaturalist.species_id(taxon inaturalist.taxa)
RETURNS INTEGER LANGUAGE SQL STABLE AS $$
SELECT CASE
  WHEN taxon.rank < 'species'
    THEN (SELECT COALESCE(p.current_taxon_id, p.id) FROM inaturalist.taxa p
           WHERE p.id = taxon.parent_id)
  WHEN taxon.rank = 'species' THEN taxon.id
  ELSE NULL
END;
$$;

CREATE OR REPLACE VIEW public.occurrences AS
 SELECT 'maplify:'::text || s.id AS id,
    NULL::character varying AS url,
    (s.usernm::text || ' on '::text) || s.source::text AS attribution,
    s.comments AS body,
        CASE
            WHEN s.number_sighted >= 1 AND s.number_sighted <= 1000 THEN s.number_sighted
            ELSE NULL::integer
        END AS count,
    extract_travel_direction(s.comments::text) AS direction,
    ROW(gis.st_x(s.location::gis.geometry), gis.st_y(s.location::gis.geometry))::lon_lat AS location,
    NULL::integer AS accuracy,
        CASE
            WHEN s.photo_url IS NOT NULL THEN ARRAY[ROW(NULL::character varying, NULL::character varying, s.photo_url::character varying, NULL::character varying, NULL::license)::occurrence_photo]
            ELSE '{}'::occurrence_photo[]
        END AS photos,
    (s.created_at AT TIME ZONE 'GMT'::text) AS observed_at,
    NULL::lon_lat AS observed_from,
    ROW(COALESCE(t.scientific_name, s.scientific_name), COALESCE(reg.common_name, par.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
    COALESCE(extract_identifiers(s.comments::text), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    NULL::text AS observer,
    col.name AS collection,
    s.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM maplify.sightings s
     JOIN inaturalist.taxa t_recorded ON s.taxon_id = t_recorded.id
     JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
     LEFT JOIN providers prov ON prov.id = s.provider_id
     LEFT JOIN collections col ON col.id = s.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id
  WHERE NOT s.is_test
UNION ALL
 SELECT 'inaturalist:'::text || observations.id AS id,
    observations.uri AS url,
    observations.username::text || ' on iNaturalist'::text AS attribution,
    observations.description AS body,
    NULL::integer AS count,
    extract_travel_direction(observations.description) AS direction,
    ROW(gis.st_x(observations.location::gis.geometry), gis.st_y(observations.location::gis.geometry))::lon_lat AS location,
    observations.public_positional_accuracy AS accuracy,
    COALESCE(( SELECT array_agg(ROW(observation_photos.attribution::character varying, NULL::character varying, observation_photos.url::character varying, NULL::character varying, observation_photos.license)::occurrence_photo ORDER BY observation_photos.seq) AS array_agg
           FROM inaturalist.observation_photos
          WHERE observation_photos.observation_id = observations.id AND NOT observation_photos.hidden AND observation_photos.license IS NOT NULL), ARRAY[]::occurrence_photo[]) AS photos,
    observations.observed_at,
    NULL::lon_lat AS observed_from,
    ROW(t.scientific_name::character varying, COALESCE(reg.common_name, par.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
    COALESCE(extract_identifiers(observations.description), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    observations.username AS observer,
    col.name AS collection,
    observations.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM inaturalist.observations
     JOIN inaturalist.taxa t_recorded ON observations.taxon_id = t_recorded.id
     JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
     LEFT JOIN providers prov ON prov.id = observations.provider_id
     LEFT JOIN collections col ON col.id = observations.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id
UNION ALL
 SELECT 'happywhale:'::text || e.id AS id,
    (('https://happywhale.com/individual/'::text || e.individual_id) || ';enc='::text) || e.id AS url,
    COALESCE(u.display_name, 'a user'::character varying)::text || ' on HappyWhale'::text AS attribution,
    concat_ws('

'::text, ((((('['::text || i.primary_id::text) || ']('::text) || 'https://happywhale.com/individual/'::text) || e.individual_id) || ')'::text) ||
        CASE i.sex
            WHEN 'male'::sex THEN '♂'::text
            WHEN 'female'::sex THEN '♀'::text
            ELSE ''::text
        END, '📍 '::text || e.verbatim_location::text, e.comments) AS body,
    e.min_count AS count,
    extract_travel_direction(e.comments::text) AS direction,
    ROW(gis.st_x(e.location::gis.geometry), gis.st_y(e.location::gis.geometry))::lon_lat AS location,
        CASE e.accuracy
            WHEN 'GENERAL'::happywhale.accuracy THEN 161
            WHEN 'APPROX'::happywhale.accuracy THEN 16
            ELSE 2
        END AS accuracy,
    COALESCE(( SELECT array_agg(ROW(media_user.display_name::character varying, m.mimetype::character varying, m.url::character varying, m.thumb_url::character varying, NULL::license)::occurrence_photo ORDER BY m.id) AS array_agg
           FROM happywhale.media m
             LEFT JOIN happywhale.users media_user ON m.user_id = media_user.id
          WHERE m.public AND m.encounter_id = e.id AND (m.license_level::text ~~ 'CC_%'::text OR m.license_level::text = 'PUBLIC_DOMAIN'::text)), ARRAY[]::occurrence_photo[]) AS photos,
    ((e.start_date + COALESCE(e.start_time, '12:00:00'::time without time zone)) AT TIME ZONE e.timezone) AS observed_at,
    NULL::lon_lat AS observed_from,
    ROW(COALESCE(t.scientific_name, s.scientific)::character varying, COALESCE(reg.common_name, par.common_name, t.vernacular_name::text, s.name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
    COALESCE(extract_identifiers(e.comments::text), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    u.display_name AS observer,
    col.name AS collection,
    e.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM happywhale.encounters e
     LEFT JOIN happywhale.users u ON e.user_id = u.id
     JOIN happywhale.individuals i ON e.individual_id = i.id
     JOIN happywhale.species s ON e.species_id = s.id
     LEFT JOIN inaturalist.taxa t_recorded ON s.scientific::text = t_recorded.scientific_name::text
     LEFT JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
     LEFT JOIN providers prov ON prov.id = e.provider_id
     LEFT JOIN collections col ON col.id = e.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id
  WHERE e.public
UNION ALL
 SELECT o.id::text AS id,
    o.url,
    con.name::text || ' on SalishSea.io'::text AS attribution,
    o.body,
    o.count,
    o.direction,
    ROW(gis.st_x(o.subject_location::gis.geometry), gis.st_y(o.subject_location::gis.geometry))::lon_lat AS location,
    NULL::integer AS accuracy,
    COALESCE(( SELECT array_agg(ROW('someone'::character varying, NULL::character varying, observation_photos.href::character varying, NULL::character varying, observation_photos.license_code::license)::occurrence_photo ORDER BY observation_photos.seq) AS array_agg
           FROM observation_photos
          WHERE observation_photos.observation_id = o.id), ARRAY[]::occurrence_photo[]) AS photos,
    o.observed_at,
        CASE
            WHEN o.observer_location IS NOT NULL THEN ROW(gis.st_x(o.observer_location::gis.geometry), gis.st_y(o.observer_location::gis.geometry))::lon_lat
            ELSE NULL::lon_lat
        END AS observed_from,
    ROW(t.scientific_name::character varying, COALESCE(reg.common_name, par.common_name, t.vernacular_name::text)::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
    COALESCE(extract_identifiers(o.body::text), ARRAY[]::character varying[]) AS identifiers,
    o.contributor_id,
    con.name AS observer,
    col.name AS collection,
    o.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug
   FROM observations o
     JOIN contributors con ON con.id = o.contributor_id
     JOIN inaturalist.taxa t_recorded ON t_recorded.id = o.taxon_id
     JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     LEFT JOIN register.inaturalist_taxon_name reg ON reg.inat_taxon_id = t.id
     LEFT JOIN register.inaturalist_taxon_name par ON par.inat_taxon_id = t.parent_id
       AND t.rank = 'subspecies'::inaturalist.rank
       AND t.scientific_name::text !~~ 'Orcinus orca %'::text
       AND t.scientific_name::text !~~ 'Delphinus delphis %'::text
     LEFT JOIN providers prov ON prov.id = o.provider_id
     LEFT JOIN collections col ON col.id = o.collection_id
     LEFT JOIN organizations org ON org.id = col.organization_id;
;

GRANT SELECT ON public.occurrences TO anon, authenticated;


CREATE OR REPLACE VIEW dwc.taxa_classification AS
 WITH RECURSIVE ancestors AS (
         SELECT t_recorded.id AS leaf_id,
            t_1.id AS ancestor_id,
            t_1.parent_id,
            t_1.rank,
            t_1.scientific_name,
            0 AS depth
           FROM inaturalist.taxa t_recorded
             JOIN inaturalist.taxa t_1 ON t_1.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
        UNION ALL
         SELECT a.leaf_id,
            p_1.id,
            p_1.parent_id,
            p_1.rank,
            p_1.scientific_name,
            a.depth + 1
           FROM ancestors a
             JOIN inaturalist.taxa p_recorded ON p_recorded.id = a.parent_id
             JOIN inaturalist.taxa p_1 ON p_1.id = COALESCE(p_recorded.current_taxon_id, p_recorded.id)
          WHERE a.depth < 50
        ), pivoted AS (
         SELECT ancestors.leaf_id AS taxon_id,
            max(
                CASE
                    WHEN ancestors.rank = 'kingdom'::inaturalist.rank THEN ancestors.scientific_name
                    ELSE NULL::character varying
                END::text) AS kingdom,
            max(
                CASE
                    WHEN ancestors.rank = 'phylum'::inaturalist.rank THEN ancestors.scientific_name
                    ELSE NULL::character varying
                END::text) AS phylum,
            max(
                CASE
                    WHEN ancestors.rank = 'class'::inaturalist.rank THEN ancestors.scientific_name
                    ELSE NULL::character varying
                END::text) AS class,
            max(
                CASE
                    WHEN ancestors.rank = 'order'::inaturalist.rank THEN ancestors.scientific_name
                    ELSE NULL::character varying
                END::text) AS order_,
            max(
                CASE
                    WHEN ancestors.rank = 'family'::inaturalist.rank THEN ancestors.scientific_name
                    ELSE NULL::character varying
                END::text) AS family,
            max(
                CASE
                    WHEN ancestors.rank = 'genus'::inaturalist.rank THEN ancestors.scientific_name
                    ELSE NULL::character varying
                END::text) AS genus
           FROM ancestors
          GROUP BY ancestors.leaf_id
        )
 SELECT t_recorded.id AS taxon_id,
    t.rank::text AS taxon_rank,
    t.scientific_name,
    p.kingdom,
    p.phylum,
    p.class,
    p.order_,
    p.family,
        CASE
            WHEN t.rank = ANY (ARRAY['genus'::inaturalist.rank, 'genushybrid'::inaturalist.rank, 'subgenus'::inaturalist.rank, 'species'::inaturalist.rank, 'complex'::inaturalist.rank, 'section'::inaturalist.rank, 'subsection'::inaturalist.rank, 'hybrid'::inaturalist.rank, 'subspecies'::inaturalist.rank, 'variety'::inaturalist.rank, 'form'::inaturalist.rank, 'infrahybrid'::inaturalist.rank]) THEN p.genus
            ELSE NULL::text
        END AS genus
   FROM inaturalist.taxa t_recorded
     JOIN inaturalist.taxa t ON t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id)
     JOIN pivoted p ON p.taxon_id = t_recorded.id;

-- CREATE OR REPLACE preserves the grants both views already carry; restated as a no-op
-- guard so the privilege never depends on a replace having happened (CLAUDE.md).
GRANT SELECT ON dwc.taxa_classification TO anon, authenticated;
