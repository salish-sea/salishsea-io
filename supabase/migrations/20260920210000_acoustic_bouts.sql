-- Orcasound bouts, held in our own shape (decision 013, amended 2026-09-20).
--
-- An acoustic occurrence is one moderator-curated `biophony` bout from orcasite: what was
-- heard at one hydrophone, from a start to an end. This is where the ingest will put them.
--
-- NOT A MIRROR. Maplify, iNaturalist and HappyWhale each get a schema that copies the
-- upstream verbatim (decision 008), because their shape is not ours to change. orcasite is
-- our project, so when its shape is wrong for us the fix goes there, and these tables hold
-- only what this site uses, named the way this site names things. Nothing here is parsed
-- or translated at read time.
--
-- WHAT IS DELIBERATELY ABSENT
--   * category. Only biophony bouts are ingested; a bout re-filed as anthrophony upstream
--     is deleted here by the ingest's reconcile, not kept with a flag.
--   * the tag's name, slug and kind. A bout's identity is the register entities its tags
--     cite (orcasite#1013 gives a tag an `iri`). A tag with no identifier contributes
--     nothing here, and the gap is closed in orcasite, not matched around (013).
--   * call types, vessels and recording-quality tags, which name no animal.
--   * a foreign key from entity_id to register.entities. The register is reloaded
--     wholesale on every refresh; a constraint would make an edition that retires an
--     entity fail to load because of a bout that cited it.
--
-- NO VIEW READS THESE YET. Putting a bout on the map needs a taxon, and every branch of
-- public.occurrences takes its taxon from inaturalist.taxa, which "J pod" does not have
-- (salish-53t). These tables and the ingest that fills them do not wait on that.
--
-- NO GRANTS to anon or authenticated, deliberately. Clients will read bouts through
-- public.occurrences, which runs as its owner. Production grants anon everything on a new
-- public table by default, so the REVOKE is what makes "not readable" true there; the
-- pinned set in supabase/read-grants.test.ts is unchanged.

INSERT INTO public.providers (slug, name)
VALUES ('orcasound', 'Orcasound')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE public.acoustic_bouts (
  -- orcasite's own identifier, e.g. bout_034OmhwjtcnA8JwRVVb5Av. Stable upstream, and the
  -- key the ingest reconciles on.
  id             TEXT PRIMARY KEY CHECK (id ~ '^bout_[0-9A-Za-z]+$'),
  -- The hydrophone. Denormalised on purpose: a feed is a name and a fixed position, there
  -- are about a dozen, and a bout keeps the position it was recorded at if a node moves.
  feed_id        TEXT NOT NULL,
  feed_name      TEXT NOT NULL,
  location       gis.geography(Point, 4326) NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  -- NULL while a moderator still has the bout open. None are, as of 2026-09-20.
  ended_at       TIMESTAMPTZ CHECK (ended_at IS NULL OR ended_at > started_at),
  -- The moderator's free-text title, shown as the occurrence's body. Never parsed.
  title          TEXT,
  provider_id    INTEGER NOT NULL REFERENCES public.providers (id),
  collection_id  INTEGER NOT NULL REFERENCES public.collections (id),
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.acoustic_bouts (started_at);
COMMENT ON TABLE public.acoustic_bouts IS
  'Orcasound biophony bouts, read directly from orcasite into our own shape -- not an '
  'upstream mirror (decision 013, amended 2026-09-20). One row is one acoustic occurrence.';

CREATE TABLE public.acoustic_bout_entities (
  bout_id    TEXT NOT NULL REFERENCES public.acoustic_bouts (id) ON DELETE CASCADE,
  -- The register entity a tag on this bout cites: a species, ecotype, pod, matriline or
  -- individual. Permanent and never reused (animals ADR-0010), which is what makes it
  -- safe to store.
  entity_id  TEXT NOT NULL CHECK (entity_id ~ '^SSA:[0-9]{7}$'),
  PRIMARY KEY (bout_id, entity_id)
);
CREATE INDEX ON public.acoustic_bout_entities (entity_id);
COMMENT ON TABLE public.acoustic_bout_entities IS
  'Which register entities a bout''s tags cite. A bout with no animal tag has no rows '
  'here, which is a legitimate state (salish-8vr.4 decides what the map does with it).';

ALTER TABLE public.acoustic_bouts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acoustic_bout_entities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acoustic_bouts         FROM anon, authenticated;
REVOKE ALL ON public.acoustic_bout_entities FROM anon, authenticated;
