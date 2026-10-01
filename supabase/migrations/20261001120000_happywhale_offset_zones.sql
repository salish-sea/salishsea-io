-- Happywhale encounters reported with a bare UTC offset are placed at the right time
-- (salish-tyse).
--
-- Happywhale gives an encounter's zone as an IANA name (America/Vancouver), as 'Z', or
-- as a bare ISO 8601 offset ('-07:00'). The view converted all three with
-- `AT TIME ZONE e.timezone`, and Postgres reads a bare offset given as TEXT as a POSIX
-- zone, whose sign is the reverse of ISO's: '-07:00' became seven hours EAST of
-- Greenwich. So encounter 533338, reported 2025-02-23 13:01:38 at -07:00 (20:01:38Z),
-- was stored at 06:01:38Z, 22:01 the previous evening in Pacific time. On 2026-10-01,
-- 945 encounters had an offset-form zone, and 582 of them showed on a different day than
-- the one reported. Given as an INTERVAL, AT TIME ZONE takes ISO's sign, which is what
-- Happywhale means.
--
-- The read-path build's DuckDB twin of this view changes in the same release
-- (scripts/read-path/derive/occurrences.sql, happywhale_instant), so the two keep
-- agreeing (decision 061).

CREATE FUNCTION derived.happywhale_instant(local_time timestamp, zone text)
  RETURNS timestamptz
  LANGUAGE sql
  STABLE STRICT PARALLEL SAFE
  SET search_path TO ''
AS $$
  SELECT CASE
    WHEN zone ~ '^[+-][0-9]{2}:[0-9]{2}$' THEN local_time AT TIME ZONE zone::interval
    ELSE local_time AT TIME ZONE zone
  END
$$;
COMMENT ON FUNCTION derived.happywhale_instant(timestamp, text) IS
  'A Happywhale encounter''s local date and time as an instant: its zone is an IANA name, ''Z'', or an ISO 8601 offset, which AT TIME ZONE reads with ISO''s sign only as an interval (salish-tyse).';

CREATE OR REPLACE VIEW derived.happywhale_occurrences AS
 SELECT ('happywhale:'::text || e.id) AS id,
    ((('https://happywhale.com/individual/'::text || e.individual_id) || ';enc='::text) || e.id) AS url,
    ((COALESCE(u.display_name, 'a user'::character varying))::text || ' on HappyWhale'::text) AS attribution,
    concat_ws('

'::text, (((((('['::text || (i.primary_id)::text) || ']('::text) || 'https://happywhale.com/individual/'::text) || e.individual_id) || ')'::text) ||
        CASE i.sex
            WHEN 'male'::sex THEN '♂'::text
            WHEN 'female'::sex THEN '♀'::text
            ELSE ''::text
        END), ('📍 '::text || (e.verbatim_location)::text), e.comments) AS body,
    e.min_count AS count,
    extract_travel_direction((e.comments)::text) AS direction,
    ROW(gis.st_x((e.location)::gis.geometry), gis.st_y((e.location)::gis.geometry))::lon_lat AS location,
        CASE e.accuracy
            WHEN 'GENERAL'::happywhale.accuracy THEN 161
            WHEN 'APPROX'::happywhale.accuracy THEN 16
            ELSE 2
        END AS accuracy,
    COALESCE(( SELECT array_agg(ROW((media_user.display_name)::character varying, (m.mimetype)::character varying, (m.url)::character varying, (m.thumb_url)::character varying, NULL::license)::occurrence_photo ORDER BY m.id) AS array_agg
           FROM (happywhale.media m
             LEFT JOIN happywhale.users media_user ON ((m.user_id = media_user.id)))
          WHERE (m.public AND (m.encounter_id = e.id) AND (((m.license_level)::text ~~ 'CC_%'::text) OR ((m.license_level)::text = 'PUBLIC_DOMAIN'::text)))), ARRAY[]::occurrence_photo[]) AS photos,
    derived.happywhale_instant(e.start_date + COALESCE(e.start_time, '12:00:00'::time without time zone), e.timezone) AS observed_at,
    NULL::lon_lat AS observed_from,
    ROW((COALESCE(t.scientific_name, s.scientific))::character varying, (COALESCE(reg.common_name, par.common_name, (t.vernacular_name)::text, (s.name)::text))::character varying, inaturalist.species_id(t.*), COALESCE(reg.entity_id, par.entity_id))::taxon AS taxon,
    COALESCE(extract_identifiers((e.comments)::text), ARRAY[]::character varying[]) AS identifiers,
    NULL::integer AS contributor_id,
    u.display_name AS observer,
    col.name AS collection,
    e.source_url,
    org.name AS organization,
    org.url AS organization_url,
    prov.name AS provider,
    prov.slug AS provider_slug,
        CASE
            WHEN (e.end_time > e.start_time) THEN derived.happywhale_instant(e.start_date + e.end_time, e.timezone)
            ELSE NULL::timestamp with time zone
        END AS observed_until,
    NULL::identification_certainty AS certainty,
    e.id AS source_key
   FROM ((((((((((happywhale.encounters e
     LEFT JOIN happywhale.users u ON ((e.user_id = u.id)))
     JOIN happywhale.individuals i ON ((e.individual_id = i.id)))
     JOIN happywhale.species s ON ((e.species_id = s.id)))
     LEFT JOIN inaturalist.taxa t_recorded ON (((s.scientific)::text = (t_recorded.scientific_name)::text)))
     LEFT JOIN inaturalist.taxa t ON ((t.id = COALESCE(t_recorded.current_taxon_id, t_recorded.id))))
     LEFT JOIN register.inaturalist_taxon_name reg ON ((reg.inat_taxon_id = t.id)))
     LEFT JOIN register.inaturalist_taxon_name par ON (((par.inat_taxon_id = t.parent_id) AND (t.rank = 'subspecies'::inaturalist.rank) AND ((t.scientific_name)::text !~~ 'Orcinus orca %'::text) AND ((t.scientific_name)::text !~~ 'Delphinus delphis %'::text))))
     LEFT JOIN providers prov ON ((prov.id = e.provider_id)))
     LEFT JOIN collections col ON ((col.id = e.collection_id)))
     LEFT JOIN organizations org ON ((org.id = col.organization_id)))
  WHERE e.public;

-- Decision 055: a migration that edits one of the five views ends with that source's
-- refresh, which rewrites only the rows whose answer changed.
SELECT derived.refresh_occurrences('happywhale');
