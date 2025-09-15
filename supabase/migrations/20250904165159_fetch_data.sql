CREATE FUNCTION happywhale.fetch_species_config () RETURNS TABLE (
  code varchar,
  name varchar,
  plural varchar,
  scientific varchar
) AS $$
  SELECT species.*
  FROM
    http.http_get('https://happywhale.com/app/cs/encounter/config'),
    jsonb_to_recordset(content::jsonb->'species') AS species(
      code varchar,
      name varchar,
      plural varchar,
      scientific varchar
    )
  WHERE status = 200 AND scientific IS NOT NULL;
$$ LANGUAGE SQL STABLE STRICT;

CREATE FUNCTION happywhale.fetch_encounter (id integer) RETURNS TABLE (
  encounter jsonb,
  media jsonb,
  comments jsonb,
  contributors jsonb,
  sighters jsonb,
  externalIds jsonb
) AS $$
  SELECT encounter.*
  FROM
    http.http_get('https://happywhale.com/app/cs/encounter/full/' || id::text),
    jsonb_to_record(content::jsonb) AS encounter (
      encounter jsonb,
      media jsonb,
      comments jsonb,
      contributors jsonb,
      sighters jsonb,
      externalIds jsonb
    )
  WHERE status = 200
$$ LANGUAGE SQL STABLE STRICT;

CREATE FUNCTION happywhale.upsert_individual (
  id integer,
  species_code varchar,
  primary_id varchar,
  nickname varchar,
  sex public.sex
) RETURNS integer AS $$
  INSERT INTO happywhale.individuals (id, species, primary_id, nickname, sex)
  SELECT s.id, s.id, primary_id, nickname, sex
  FROM happywhale.species AS s
  WHERE s.code = species_code
  ON CONFLICT (id) DO UPDATE SET
    primary_id = EXCLUDED.primary_id,
    nickname = EXCLUDED.nickname,
    sex = EXCLUDED.sex
  RETURNING id;
$$ LANGUAGE SQL VOLATILE;

CREATE FUNCTION happywhale.upsert_user (
  id integer,
  display_name varchar
) RETURNS integer AS $$
  INSERT INTO happywhale.users (id, display_name)
  SELECT id, display_name
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name
  RETURNING id;
$$ LANGUAGE SQL VOLATILE STRICT;

CREATE FUNCTION happywhale.upsert_encounter (
  encounter jsonb
) RETURNS integer AS $$
  INSERT INTO happywhale.encounters (
    id, start_date, start_time, end_date, end_time, timezone, verbatim_location, location,
    accuracy, precision_source, individual_id, species_id, min_count, max_count, comments,
    user_id, public, fetched_at
  ) SELECT
    e.id,
    "startDate" AS start_date,
    "startTime" AS start_time,
    "endDate",
    "endTime",
    timezone,
    "verbatimLocation",
    gis.ST_Point((loc.latLng).lng, (loc.latLng).lat) AS location,
    accuracy,
    "precisionSource",
    happywhale.upsert_individual(ind.id, ind."speciesKey", ind."primaryId", ind.nickname, lower(sex)::public.sex) AS individual_id,
    sp.id AS species_id,
    "minCount",
    "maxCount",
    "adminComments",
    happywhale.upsert_user(u.id, u."displayName"),
    public,
    current_timestamp
  FROM
    jsonb_to_record(encounter) AS e (
      id integer,
      "dateRange" jsonb,
      location jsonb,
      individual jsonb,
      species varchar,
      "minCount" integer,
      "maxCount" integer,
      "adminComments" text,
      "user" jsonb,
      "public" boolean
    ) LEFT JOIN happywhale.species AS sp ON sp.code = species,
    jsonb_to_record("dateRange") AS dr ("startDate" date, "startTime" time, "endDate" date, "endTime" time, timezone varchar),
    jsonb_to_record(location) AS loc ("verbatimLocation" varchar, latLng public.lat_lng, accuracy happywhale.accuracy, "precisionSource" varchar),
    jsonb_to_record(individual) AS ind (id integer, "speciesKey" varchar, "primaryId" varchar, nickname varchar, sex varchar),
    jsonb_to_record("user") AS u (id integer, "displayName" varchar)
  ON CONFLICT (id) DO UPDATE SET
    start_date = EXCLUDED.start_date,
    start_time = EXCLUDED.start_time,
    end_date = EXCLUDED.end_date,
    end_time = EXCLUDED.end_time,
    timezone = EXCLUDED.timezone,
    verbatim_location = EXCLUDED.verbatim_location,
    fetched_at = EXCLUDED.fetched_at
  RETURNING id
$$ LANGUAGE SQL VOLATILE STRICT;


CREATE FUNCTION maplify.fetch_date_range (
  start_date DATE,
  end_date DATE,
  bbox gis.box2d
) RETURNS TABLE (
  id integer,
  project_id integer,
  trip_id integer,
  scientific_name varchar,
  location gis.Geography(Point),
  number_sighted integer,
  created_at timestamp,
  photo_url varchar,
  comments varchar,
  in_ocean boolean,
  moderated smallint,
  trusted boolean,
  is_test boolean,
  source varchar,
  usernm varchar
) AS $$
  SELECT
    id,
    project_id,
    trip_id,
    scientific_name,
    gis.ST_Point(longitude, latitude)::gis.geography AS location,
    number_sighted,
    created AS created_at,
    NULLIF(trim(photo_url), '') AS photo_url,
    NULLIF(trim(comments), '') AS comments,
    in_ocean,
    moderated,
    trusted,
    is_test,
    source,
    usernm
  FROM
    http.http_get('https://maplify.com/waseak/php/search-all-sightings.php' ||
      '?start=' || start_date::text ||
      '&end=' || end_date::text ||
      '&BBOX=' || concat_ws(',', gis.ST_XMin(bbox), gis.ST_YMin(bbox), gis.ST_XMax(bbox), gis.ST_YMax(bbox))
    ),
    jsonb_to_recordset(content::jsonb->'results') AS sightings(
      id int,
      project_id int,
      trip_id int,
      scientific_name varchar,
      latitude real,
      longitude real,
      number_sighted int,
      created timestamp,
      photo_url varchar,
      comments varchar,
      in_ocean boolean,
      moderated smallint,
      trusted boolean,
      is_test boolean,
      source varchar,
      usernm varchar
    )
  WHERE status = 200 AND source != 'rwsas';
$$ LANGUAGE SQL STABLE STRICT;

CREATE FUNCTION maplify.update_sightings (
  start_date date = current_date,
  end_date date = current_date
) RETURNS void LANGUAGE SQL VOLATILE
BEGIN ATOMIC;
  DELETE FROM maplify.sightings WHERE created_at BETWEEN start_date::timestamp AND (end_date + interval '1 day')::timestamp;
  INSERT INTO maplify.sightings
    SELECT sightings.* FROM
      gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)) AS bbox,
      maplify.fetch_date_range(start_date, end_date, bbox) AS sightings;
END;

CREATE FUNCTION inaturalist.upsert_taxon (
  id integer,
  parent_id integer,
  scientific_name varchar,
  vernacular_name varchar,
  rank inaturalist.rank
) RETURNS integer LANGUAGE SQL VOLATILE
BEGIN ATOMIC;
  INSERT INTO inaturalist.taxa (id, parent_id, scientific_name, vernacular_name, rank)
  VALUES (id, parent_id, scientific_name, vernacular_name, rank)
  ON CONFLICT (id) DO NOTHING;
  SELECT id;
END;

CREATE FUNCTION inaturalist.fetch_taxa (ids integer[]) RETURNS TABLE (
  id integer,
  ancestor_ids integer[],
  name varchar,
  parent_id integer,
  preferred_common_name varchar,
  rank inaturalist.rank
) AS $$
  SELECT taxa.*
  FROM
    http.http_get('https://api.inaturalist.org/v2/taxa', jsonb_build_object(
      'id', array_to_string(ids, ','),
      'fields', '(id:!t,ancestor_ids:!t,parent_id:!t,rank:!t,name:!t,preferred_common_name:!t,rank:!t)',
      'preferred_place_id', 1,
      'preferred_locale', 'en'
    )),
    jsonb_to_recordset((content::jsonb)->'results') AS taxa (
      id integer,
      ancestor_ids integer[],
      name varchar,
      parent_id integer,
      preferred_common_name varchar,
      rank inaturalist.rank
    )
  WHERE status = 200
$$ LANGUAGE SQL STABLE STRICT;

CREATE FUNCTION inaturalist.query_taxa (query varchar) RETURNS TABLE (
  id integer,
  ancestor_ids integer[],
  name varchar,
  parent_id integer,
  preferred_common_name varchar,
  rank inaturalist.rank
) AS $$
  SELECT taxa.*
  FROM
    http.http_get('https://api.inaturalist.org/v2/taxa', jsonb_build_object(
      'q', query,
      'fields', '(id:!t,ancestor_ids:!t,parent_id:!t,rank:!t,name:!t,preferred_common_name:!t,rank:!t)',
      'preferred_place_id', 1,
      'preferred_locale', 'en'
    )),
    jsonb_to_recordset((content::jsonb)->'results') AS taxa (
      id integer,
      ancestor_ids integer[],
      name varchar,
      parent_id integer,
      preferred_common_name varchar,
      rank inaturalist.rank
    )
  WHERE status = 200
$$ LANGUAGE SQL STABLE STRICT;

CREATE FUNCTION inaturalist.ensure_taxa (ids integer[]) RETURNS TABLE (
  taxon_id integer
) AS $$
  WITH missing (wanted_id) AS (
    SELECT wanted_id, dense_rank() over (order by wanted_id) / 10 AS chunk
    FROM (SELECT DISTINCT unnest(ids) AS wanted_id) AS v
    LEFT JOIN inaturalist.taxa AS t ON t.id = wanted_id
    WHERE t.id IS NULL
  )
    SELECT inserted.id
    FROM
      (SELECT array_agg(wanted_id) AS wanted_ids FROM missing GROUP BY chunk) AS v,
      inaturalist.fetch_taxa(wanted_ids) AS fetched,
      inaturalist.upsert_taxon(fetched.id, parent_id, name, preferred_common_name, rank) AS inserted (id)
$$ LANGUAGE SQL VOLATILE STRICT;

CREATE FUNCTION inaturalist.ensure_taxon (scientific_name varchar) RETURNS integer AS $$
SELECT count(*) AS new_taxa
  FROM inaturalist.query_taxa(scientific_name) AS named_taxon,
       inaturalist.ensure_taxa(ancestor_ids) AS ensured;
$$ VOLATILE LANGUAGE SQL;

CREATE FUNCTION happywhale.ensure_inat_taxa () RETURNS varchar AS $$
WITH missing (scientific_name) AS (
  SELECT DISTINCT scientific
  FROM happywhale.species AS hw
       LEFT JOIN inaturalist.taxa AS inat ON hw.scientific = inat.scientific_name
  WHERE inat.scientific_name IS NULL AND position(' ' in hw.scientific) != 0
), queried (ancestor_id) AS (
  SELECT DISTINCT unnest(ancestor_ids) AS ancestor_id
  FROM missing, inaturalist.query_taxa(scientific_name) AS q
)
SELECT count(*) AS new_taxa
FROM (SELECT array_agg(ancestor_id) AS ancestor_ids FROM queried) v,
     inaturalist.ensure_taxa(ancestor_ids) AS ensured;
$$ LANGUAGE SQL VOLATILE;

CREATE FUNCTION happywhale.ensure_species () RETURNS void LANGUAGE SQL VOLATILE
BEGIN ATOMIC;
  INSERT INTO happywhale.species (code, name, plural, scientific)
  SELECT code, name, plural, scientific
  FROM happywhale.fetch_species_config()
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    plural = EXCLUDED.plural,
    scientific = EXCLUDED.scientific;
  SELECT happywhale.ensure_inat_taxa();
END;
COMMENT ON FUNCTION happywhale.ensure_species() IS 'Ensure there is an iNaturalist taxon for each HappyWhale species';

CREATE FUNCTION inaturalist.fetch_observation_page (
  earliest date,
  latest date,
  extent gis.box2d,
  taxon_ids integer[],
  page_no integer,
  per_page integer = 200,
  out total_results integer,
  out results jsonb
) AS $$
  SELECT total_results, results
  FROM
    http.http_get('https://api.inaturalist.org/v2/observations', jsonb_build_object(
      'd1', earliest,
      'd2', latest,
      'licensed', true,
      'nelat', gis.ST_YMax(extent),
      'nelng', gis.ST_XMax(extent),
      'swlat', gis.ST_YMin(extent),
      'swlng', gis.ST_XMin(extent),
      'taxon_id', array_to_string(taxon_ids, ','),
      'geoprivacy', 'open',
      'taxon_geoprivacy', 'open',
      'per_page', per_page,
      'page', page_no,
      'fields', '(id:!t,description:!t,geojson:!t,license_code:!t,time_observed_at:!t,uri:!t,public_positional_accuracy:!t' ||
        'observation_photos:(position:!t,photo:(id:!t,attribution:!t,hidden:!t,license_code:!t,original_dimensions:(height:!t,width:!t),url:!t)),' ||
        'taxon:(id:!t,ancestor_ids:!t),' ||
        'user:(id:!t,login:!t,name:!t))'
    )),
    jsonb_to_record(content::jsonb) AS page (total_results integer, results jsonb)
$$ LANGUAGE SQL STABLE STRICT;

CREATE FUNCTION inaturalist.upsert_observation_page (
  page jsonb
) RETURNS table (observation_id bigint, photo_id bigint) LANGUAGE SQL VOLATILE STRICT AS $$
  WITH observations AS (
    SELECT observation.*
    FROM jsonb_to_recordset(page) AS observation (
      id bigint,
      taxon jsonb,
      description text,
      geojson jsonb,
      time_observed_at timestamptz,
      license_code inaturalist.license,
      uri varchar,
      "user" jsonb,
      observation_photos jsonb,
      public_positional_accuracy integer
    )
  ), taxa AS (
    SELECT jsonb_array_elements(taxon->'ancestor_ids')::integer AS id
    FROM observations
  ), taxa_to_fetch AS (
    SELECT DISTINCT needed.id, dense_rank() over (order by needed.id) / 10 AS chunk
    FROM taxa AS needed
    LEFT JOIN inaturalist.taxa AS existing ON needed.id = existing.id
    WHERE existing.id IS NULL
  ), taxon_chunks_to_fetch AS (
    SELECT array_agg(id) AS ids
    FROM taxa_to_fetch
    GROUP BY chunk
  ), taxon_insertions AS (
    SELECT inaturalist.upsert_taxon(id, parent_id, name, preferred_common_name, rank) id
    FROM taxon_chunks_to_fetch,
      inaturalist.fetch_taxa(ids)
  ), observation_insertions AS (
    INSERT INTO inaturalist.observations (
      id, description, location, observed_at, license_code, uri, username, taxon_id, fetched_at, public_positional_accuracy
    )
    SELECT
      o.id,
      NULLIF(trim(description), ''),
      gis.ST_Point(coordinates[1], coordinates[2]) AS location,
      time_observed_at AS observed_at,
      license_code,
      uri,
      o.user->>'login' AS username,
      taxon.id AS taxon_id,
      current_timestamp,
      public_positional_accuracy
    FROM observations AS o,
      jsonb_to_record(geojson) AS geojson (coordinates double precision[]),
      jsonb_to_record(taxon) AS taxon (id integer) LEFT JOIN taxon_insertions AS ti ON taxon.id = ti.id
    ON CONFLICT (id) DO UPDATE SET
      taxon_id = EXCLUDED.taxon_id,
      description = EXCLUDED.description,
      observed_at = EXCLUDED.observed_at,
      license_code = EXCLUDED.license_code,
      fetched_at = EXCLUDED.fetched_at
    RETURNING id
  )
  INSERT INTO inaturalist.observation_photos (
    id, observation_id, seq, attribution, hidden, license, original_dimensions, url
  )
  SELECT
    photo.id,
    o.id,
    observation_photo.position,
    photo.attribution,
    photo.hidden,
    photo.license_code,
    dims::public.dimensions::public.dimensions,
    photo.url
  FROM observations AS o JOIN observation_insertions AS oi ON o.id=oi.id,
    jsonb_to_recordset(observation_photos) AS observation_photo (id bigint, position smallint, photo jsonb),
    jsonb_to_record(observation_photo.photo) AS photo (id bigint, attribution varchar, hidden boolean, license_code inaturalist.license, original_dimensions jsonb, url varchar),
    jsonb_to_record(photo.original_dimensions) AS dims (height int, width int)
  ON CONFLICT (id) DO UPDATE SET
    hidden = EXCLUDED.hidden,
    license = EXCLUDED.license,
    seq = EXCLUDED.seq
  RETURNING observation_id, id
$$;
