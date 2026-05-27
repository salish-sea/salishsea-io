-- Add taxon 526556 (Lutrinae — otters) to iNaturalist fetch (GitHub issue #267)
CREATE OR REPLACE FUNCTION inaturalist.update_observations(from_date date, to_date date) RETURNS void VOLATILE LANGUAGE SQL AS $$
  SELECT *
  FROM inaturalist.fetch_observation_page(
    from_date,
    to_date,
    gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)),
    array[152871, 372843, 526556],
    1,
    200),
  inaturalist.upsert_observation_page(results) ups;
$$;
