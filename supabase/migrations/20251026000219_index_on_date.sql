CREATE INDEX sighting_date ON maplify.sightings (date(((created_at AT TIME ZONE 'GMT'::text) AT TIME ZONE 'PST8PDT'::text)));
CREATE INDEX observation_date ON observations (date((observed_at AT TIME ZONE 'PST8PDT'::text)));
CREATE INDEX observation_date ON inaturalist.observations (date((observed_at AT TIME ZONE 'PST8PDT'::text)));
CREATE INDEX encounter_date ON happywhale.encounters (date((((start_date + COALESCE(start_time, '12:00:00'::time without time zone)) AT TIME ZONE timezone) AT TIME ZONE 'PST8PDT'::text)));
CREATE INDEX media_encounter ON happywhale.media (encounter_id);
CREATE INDEX species_name ON happywhale.species (scientific);

DROP TABLE happywhale.encounter_media;