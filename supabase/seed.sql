INSERT INTO happywhale.species (code, name, plural, scientific)
SELECT code, name, plural, scientific FROM happywhale.fetch_species_config();

select *
FROM inaturalist.fetch_observation_page(
  current_date - 30,
  current_date,
  gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)),
  array[152871, 372843],
  1,
  1),
inaturalist.upsert_observation_page(results) ups;


SELECT * FROM maplify.update_sightings(current_date - 10, current_date);
