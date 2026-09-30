-- What the read-path build needs to derive the occurrences itself (decision 061,
-- salish-xv35.1): every table the five views behind derived.occurrences read, the
-- tables the functions they call read, the Maplify resolvers' inputs, and the stored
-- identifier candidates to check a port against. Until now read_path reached only what
-- the files publish; from here it also reaches what they are derived from.
--
-- Columns, not tables, wherever a table holds more than the derivation reads, so the
-- build machine never holds what it doesn't use. In particular public.observations'
-- user_uuid (which sign-in account wrote a sighting) and everything of a contributor's
-- but their name.
--
-- Row-level security: the views run as their owner, who reads every row. A role no
-- policy names reads zero rows of an RLS table without any error, which here would look
-- like the port disagreeing. So each RLS table gets a read policy for read_path, as the
-- profiles did in 20260929120000, and supabase/read-path-grants.test.ts checks read_path
-- sees exactly the rows the owner does.
--
-- Pinned in supabase/read-path-grants.test.ts.

GRANT USAGE ON SCHEMA maplify, inaturalist, happywhale, register, derived TO read_path;
-- The snapshot turns each geography into lon/lat with the same gis.st_x/st_y the views
-- call, so the port's floats are the store's. Entering the schema also exposes
-- PostGIS's own catalogs, which it grants to PUBLIC: pinned in the test.
GRANT USAGE ON SCHEMA gis TO read_path;

-- Maplify: the view's columns, and name + scientific_name, which the entity resolver
-- reads (scripts/ingest/maplify.ts resolveEntity) once resolution moves into the
-- derivation. The collection rules are the other resolver's table.
GRANT SELECT (id, name, scientific_name, location, number_sighted, created_at, photo_url,
              comments, is_test, source, usernm, provider_id, collection_id, source_url,
              entity_id)
  ON maplify.sightings TO read_path;
GRANT SELECT ON maplify.collection_rule TO read_path;

GRANT SELECT (id, description, location, observed_at, uri, username, taxon_id,
              public_positional_accuracy, provider_id, collection_id, source_url)
  ON inaturalist.observations TO read_path;
GRANT SELECT (id, observation_id, seq, attribution, hidden, license, url)
  ON inaturalist.observation_photos TO read_path;
GRANT SELECT (id, parent_id, scientific_name, vernacular_name, rank, current_taxon_id)
  ON inaturalist.taxa TO read_path;

GRANT SELECT (id, individual_id, user_id, species_id, verbatim_location, comments, min_count,
              location, accuracy, start_date, start_time, end_time, timezone, public,
              source_url, provider_id, collection_id)
  ON happywhale.encounters TO read_path;
GRANT SELECT (id, display_name) ON happywhale.users TO read_path;
GRANT SELECT (id, primary_id, sex) ON happywhale.individuals TO read_path;
GRANT SELECT (id, scientific, name) ON happywhale.species TO read_path;
GRANT SELECT (id, encounter_id, user_id, mimetype, url, thumb_url, public, license_level)
  ON happywhale.media TO read_path;

GRANT SELECT (id, url, body, count, direction, subject_location, observer_location,
              observed_at, entity_id, contributor_id, provider_id, collection_id, source_url)
  ON public.observations TO read_path;
GRANT SELECT (id, observation_id, seq, href, license_code) ON public.observation_photos TO read_path;
GRANT SELECT (id, name) ON public.contributors TO read_path;

GRANT SELECT (id, feed_name, title, location, started_at, ended_at, provider_id, collection_id)
  ON public.acoustic_bouts TO read_path;
GRANT SELECT (bout_id, entity_id, certainty) ON public.acoustic_bout_entities TO read_path;

GRANT SELECT (id, slug, name) ON public.providers TO read_path;
GRANT SELECT (id, name, organization_id) ON public.collections TO read_path;
GRANT SELECT (id, name, url) ON public.organizations TO read_path;

-- The register, as register.inaturalist_taxon, register.inaturalist_taxon_name,
-- register.taxon_for, register.taxon_entity_for and the Maplify name index read it.
GRANT SELECT (entity_id, kind, label) ON register.entities TO read_path;
GRANT SELECT (entity_id, name, type, language) ON register.names TO read_path;
GRANT SELECT (subject_id, predicate_id, object_id) ON register.mappings TO read_path;
GRANT SELECT (entity_id, ancestor_id, depth, ancestor_kind) ON register.ancestor TO read_path;
GRANT SELECT (entity_id, replaced_by) ON register.deprecations TO read_path;

-- What the port of derived.identifier_candidates is checked against. The occurrences
-- themselves are already read, as public.occurrences.
GRANT SELECT ON derived.occurrence_identifier_candidates TO read_path;

CREATE POLICY "The read-path build may read taxa." ON inaturalist.taxa
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read observations." ON public.observations
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read observation photos." ON public.observation_photos
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read acoustic bouts." ON public.acoustic_bouts
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read acoustic bout entities." ON public.acoustic_bout_entities
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read providers." ON public.providers
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read collections." ON public.collections
  FOR SELECT TO read_path USING (true);
CREATE POLICY "The read-path build may read organizations." ON public.organizations
  FOR SELECT TO read_path USING (true);
