-- The synthetic rows the twin fixture was captured over (salish-9uu.11), on top of
-- supabase/ci-seed.sql, register release 2026.10.1 (scripts/register/load.ts at 37564ef~1)
-- and the Bigg's catalogue (scripts/seed/seed-biggs.ts), in a scratch copy of the local
-- database. Kept as the record of where the fixture's inputs came from: nothing runs it
-- any more, since the Postgres views it fed are retired. One or two rows per source arm,
-- with designations in the text for the identifier candidates and a seal beside a
-- haul-out site, so every derivation the fixture checks has something to derive.
-- All of it is invented: no real sighting, person or photograph.

BEGIN;

-- Maplify (provider 2): an Orca Network report naming Bigg's animals, a Southern
-- Resident report, a harbour seal on Waadah Island's haul-out, and a test row.
INSERT INTO maplify.sightings (
    id, project_id, trip_id, name, scientific_name, location, number_sighted, created_at,
    in_ocean, moderated, trusted, is_test, source, comments, usernm, entity_id, collection_id
) VALUES
    (11, 100, 200, 'Orca', 'Orcinus orca', gis.ST_Point(-123.05, 48.55)::gis.geography, 5,
     '2026-09-10 17:20:00', TRUE, 1, TRUE, FALSE, 'whale_alert',
     '[Orca Network] T65A, T065A2 and T137A southbound off Lime Kiln (Pat Doe)', 'pdoe', 'SSA:0000900',
     maplify.resolve_collection('[Orca Network] T65A, T065A2 and T137A southbound off Lime Kiln (Pat Doe)', 'whale_alert')),
    (12, 100, 200, 'Harbor Seal', 'Phoca vitulina', gis.ST_Point(-124.5910, 48.3825)::gis.geography, 12,
     '2026-09-11 09:05:00', TRUE, 1, TRUE, FALSE, 'whale_alert',
     'Hauled out at low tide', NULL, 'SSA:0000904',
     maplify.resolve_collection('Hauled out at low tide', 'whale_alert')),
    (13, 100, 200, 'Orca', 'Orcinus orca', gis.ST_Point(-123.20, 48.50)::gis.geography, 20,
     '2026-09-12 21:45:00', TRUE, 1, TRUE, FALSE, 'acartia',
     'J35 and J47 with Ls, northbound in Haro Strait', NULL, 'SSA:0000900',
     maplify.resolve_collection('J35 and J47 with Ls, northbound in Haro Strait', 'acartia')),
    (14, 100, 200, 'Orca', 'Orcinus orca', gis.ST_Point(-123.10, 48.60)::gis.geography, 1,
     '2026-09-13 12:00:00', TRUE, 1, TRUE, TRUE, 'whale_alert', 'test, please ignore', NULL, 'SSA:0000900',
     maplify.resolve_collection('test, please ignore', 'whale_alert'));

-- iNaturalist (provider 3, collection 8): a Bigg's killer whale with a photo and
-- designations in its description, and a humpback with neither.
INSERT INTO inaturalist.observations (
    id, description, location, observed_at, license_code, uri, username, taxon_id, fetched_at,
    public_positional_accuracy, updated_at, provider_id, collection_id
) VALUES
    (9000001, 'T137A and T137B foraging near the kelp line', gis.ST_Point(-122.95, 48.45)::gis.geography,
     '2026-09-14 18:30:00+00', 'cc-by', 'https://www.inaturalist.org/observations/9000001', 'synthetic_observer',
     1602533, '2026-09-15 00:00:00', 30, '2026-09-15 00:00:00', 3, 8),
    (9000002, NULL, gis.ST_Point(-123.40, 48.30)::gis.geography,
     '2026-09-15 16:00:00+00', 'cc0', 'https://www.inaturalist.org/observations/9000002', 'synthetic_observer',
     41566, '2026-09-16 00:00:00', NULL, '2026-09-16 00:00:00', 3, 8);
INSERT INTO inaturalist.observation_photos (id, observation_id, seq, attribution, hidden, license, original_dimensions, url)
VALUES (8000001, 9000001, 1, '(c) synthetic_observer, some rights reserved (CC BY)', FALSE, 'cc-by',
        ROW(2048, 1536), 'https://static.inaturalist.org/photos/8000001/square.jpg');

-- Orcasound (provider 5, collection 4): a bout tagged with J pod and the Southern
-- Residents above it, so the deepest-tag rule has a chain to cut (salish-8vr.32).
INSERT INTO public.acoustic_bouts (id, feed_id, feed_name, location, started_at, ended_at, title, provider_id, collection_id, fetched_at)
VALUES ('bout_twin0000000000000001', 'feed_twin', 'Orcasound Lab', gis.ST_Point(-123.1735, 48.5583)::gis.geography,
        '2026-09-16 04:10:00+00', '2026-09-16 04:55:00+00', 'J pod calls', 5, 4, '2026-09-16 05:00:00+00');
INSERT INTO public.acoustic_bout_entities (bout_id, entity_id, certainty) VALUES
    ('bout_twin0000000000000001', 'SSA:0000020', 'probable'),
    ('bout_twin0000000000000001', 'SSA:0000001', 'probable');

-- Happywhale (provider 4, collection 9): T065A, encountered in local time and zone.
INSERT INTO happywhale.species (id, code, name, plural, scientific)
VALUES (1, 'killer_whale', 'Killer whale', 'Killer whales', 'Orcinus orca');
INSERT INTO happywhale.individuals (id, species, primary_id, nickname, sex) VALUES (1, 1, 'T065A', NULL, 'female');
INSERT INTO happywhale.users (id, display_name) VALUES (1, 'Synthetic Contributor');
INSERT INTO happywhale.encounters (
    id, start_date, start_time, timezone, verbatim_location, location, individual_id, species_id, min_count,
    comments, public, fetched_at, user_id, provider_id, collection_id
) VALUES (1, '2026-09-17', '13:01:38', 'America/Vancouver', 'Off Turn Point',
          gis.ST_Point(-123.24, 48.69)::gis.geography, 1, 1, 4, 'Mother and calf', TRUE,
          '2026-09-18 00:00:00', 1, 4, 9);
INSERT INTO happywhale.media (id, encounter_id, thumb_url, url, user_id, license_level, mimetype, public)
VALUES (1, 1, 'https://happywhale.com/media/1/thumb.jpg', 'https://happywhale.com/media/1.jpg', 1, 'cc-by', 'image/jpeg', TRUE);

-- A second native sighting (provider 1), with text the extraction reads and an
-- identification asserted on it; and one rejecting an animal the Maplify text names.
DO $$
DECLARE
    v_contrib_id INTEGER;
BEGIN
    SELECT contributor_id INTO v_contrib_id FROM public.user_contributor
     WHERE user_uuid = '00000000-0000-0000-0000-000000000001';
    INSERT INTO public.observations (id, observed_at, subject_location, observer_location, body, count, direction,
                                     entity_id, contributor_id, user_uuid, created_at, updated_at, collection_id)
    VALUES ('00000000-0000-4000-a000-000000000002', '2026-09-18 20:15:00+00',
            gis.ST_Point(-123.15, 48.52)::gis.geography, gis.ST_Point(-123.16, 48.53)::gis.geography,
            'T65A with her calves, heading east; T137s nearby', 3, 'east', 'SSA:0000900', v_contrib_id,
            '00000000-0000-0000-0000-000000000001', '2026-09-18 20:20:00', '2026-09-18 20:20:00',
            (SELECT id FROM public.collections WHERE slug = 'salishsea-direct'));
END $$;
INSERT INTO public.identifications (occurrence_id, individual_id, social_group_id, is_present, evidence, method, status, code, certainty)
VALUES
    ('00000000-0000-4000-a000-000000000002', (SELECT id FROM public.individuals WHERE primary_designation = 'T065A'),
     NULL, TRUE, 'photograph', 'manual', 'validated', 'T65A', 'certain'),
    ('maplify:11', (SELECT id FROM public.individuals WHERE primary_designation = 'T137A'),
     NULL, FALSE, 'photograph', 'manual', 'rejected', 'T137A', 'certain');

SELECT derived.refresh_all();

COMMIT;
