INSERT INTO happywhale.species (code, name, plural, scientific)
SELECT code, name, plural, scientific FROM happywhale.fetch_species_config();

INSERT INTO maplify.sightings
SELECT fetched.* FROM
  gis.ST_MakeBox2D(gis.ST_Point(-136, 36), gis.ST_Point(-120, 54)) AS bbox,
  maplify.fetch_date_range((current_date - '90 days'::interval)::date, current_date, bbox) AS fetched;
