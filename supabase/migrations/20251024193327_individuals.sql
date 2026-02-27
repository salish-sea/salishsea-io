-- regexp_matches(body, E'\\m(j|k|l|t|crc)[- ]?0*(\\d[\\da-f]+)(s?)\\M', 'gi')
CREATE FUNCTION public.normalize_identifier(identifier VARCHAR) LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT 
$$;

CREATE TABLE public.individuals (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  taxon_id INTEGER NOT NULL REFERENCES inaturalist.taxa (id),
  identifier VARCHAR(50) NOT NULL,
  sex public.sex,
  born date,
  died date
);

INSERT INTO public.individuals (taxon_id, identifier, sex)
SELECT taxa.id, primary_id, sex
FROM happywhale.individuals AS ind
JOIN happywhale.species ON ind.species = species.id
JOIN inaturalist.taxa ON species.scientific = taxa.scientific_name;

CREATE TABLE public.pod_identifiers (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  taxon_id INTEGER NOT NULL REFERENCES inaturalist.taxa (id),
  identifier CHAR NOT NULL
);


CREATE OR REPLACE VIEW public.identifiers AS
SELECT identifier, 'individual' AS "type", id FROM public.individuals

UNION ALL

SELECT identifier, 'group', null FROM public.group_identifiers;
