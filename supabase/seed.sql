INSERT INTO happywhale.species (code, name, plural, scientific)
SELECT code, name, plural, scientific FROM happywhale.fetch_species_config();

select *
FROM inaturalist.fetch_observation_page(
  current_date - 30,
  current_date,
  gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)),
  array[152871],
  1,
  1),
inaturalist.upsert_observation_page(results) ups;


INSERT INTO maplify.sightings
SELECT fetched.* FROM
  gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)) AS bbox,
  maplify.fetch_date_range((current_date - '90 days'::interval)::date, current_date, bbox) AS fetched;
