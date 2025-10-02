CREATE OR REPLACE FUNCTION happywhale.upsert_individual (
  id integer,
  species_code varchar,
  primary_id varchar,
  nickname varchar,
  sex public.sex
) RETURNS integer AS $$
  INSERT INTO happywhale.individuals (id, species, primary_id, nickname, sex)
  SELECT $1, s.id, primary_id, nickname, sex
  FROM happywhale.species AS s
  WHERE s.code = species_code
  ON CONFLICT (id) DO UPDATE SET
    primary_id = EXCLUDED.primary_id,
    nickname = EXCLUDED.nickname,
    sex = EXCLUDED.sex
  RETURNING id;
$$ LANGUAGE SQL VOLATILE;