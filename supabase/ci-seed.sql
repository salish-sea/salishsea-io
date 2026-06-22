-- =====================================================================
-- CI-only static fixture for DwC-A build pre-prod gate (Phase 14).
--
-- Applied via psql (CI and local). NOTE: `supabase db query --file` cannot run
-- this file — it has multiple top-level statements and that command sends the
-- file as a single prepared statement (fails with SQLSTATE 42601). Use:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/ci-seed.sql
-- AFTER migrations have been applied (supabase db start or supabase db reset).
--
-- This file is NOT in supabase/config.toml [db.seed].sql_paths and is NOT
-- run by `supabase db start` or `supabase db reset`. It must be applied
-- explicitly (e.g., from build.yml after supabase db start).
--
-- Reference rows (providers, organizations, collections) are already seeded
-- by migration 20260619184037_reference_tables.sql. This fixture inserts
-- ONLY source rows referencing those existing IDs.
--
-- Safe to re-run ONLY on a freshly-reset local DB. The Maplify INSERTs use
-- ON CONFLICT DO NOTHING as belt-and-suspenders, but primary key conflicts
-- on the auth.users and observations rows will error if re-run.
--
-- No real PII, no production credentials, no prod DSN. All data is synthetic.
-- =====================================================================

-- =====================================================================
-- Section 1 — Native observations (dwc._native_occurrences + dwc.multimedia)
-- =====================================================================

-- Insert a minimal auth.users row. The create_contributor_on_sign_in trigger
-- fires synchronously AFTER INSERT ON auth.users and creates:
--   - a public.contributors row named 'CI Gate Test'
--   - a public.user_contributor row mapping this UUID to that contributor
-- (migration 20260203234153_individuals.sql)
INSERT INTO auth.users (
    id,
    email,
    created_at,
    updated_at,
    raw_user_meta_data
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'ci-gate@example.com',
    NOW(),
    NOW(),
    '{"name": "CI Gate Test"}'::jsonb
);

-- Use the trigger-created contributor_id to insert a native observation.
-- collection_id omitted → DEFAULT 10 (salishsea-direct); the native view
-- INNER JOINs public.collections so the default satisfies the JOIN.
-- provider_id omitted → DEFAULT 1 (direct).
DO $$
DECLARE
    v_contrib_id INTEGER;
    v_obs_id UUID := '00000000-0000-4000-a000-000000000001';
BEGIN
    SELECT contributor_id INTO v_contrib_id
      FROM public.user_contributor
     WHERE user_uuid = '00000000-0000-0000-0000-000000000001';

    INSERT INTO public.observations (
        id,
        observed_at,
        subject_location,
        taxon_id,
        count,
        contributor_id,
        user_uuid,
        created_at,
        updated_at,
        -- collection_id resolved by slug, NOT the surrogate id: collections.id
        -- is GENERATED AS IDENTITY (insertion-order artifact), so the migration
        -- says key on the slug (Pitfall 4). The native view INNER-JOINs
        -- collections, so this must resolve to a real row.
        collection_id
        -- provider_id defaults to 1 (direct)
    ) VALUES (
        v_obs_id,
        NOW() - INTERVAL '1 day',
        gis.ST_Point(-123.3, 48.4)::gis.geography,
        41521,   -- Orcinus orca (confirmed in inaturalist.taxa)
        2,
        v_contrib_id,
        '00000000-0000-0000-0000-000000000001',
        NOW(),
        NOW(),
        (SELECT id FROM public.collections WHERE slug = 'salishsea-direct')
    );

    -- One photo so dwc.multimedia is non-empty (DWCA-03 coverage).
    -- license_code = 'cc-by' (not 'none'/NULL) → included in dwc.multimedia.
    -- id is GENERATED ALWAYS AS IDENTITY — omit to use auto-assigned value.
    INSERT INTO public.observation_photos (
        observation_id,
        seq,
        href,
        license_code
    ) VALUES (
        v_obs_id,
        1,
        'https://example.com/ci-gate-test-photo.jpg',
        'cc-by'
    );
END $$;

-- =====================================================================
-- Section 2 — Maplify sightings (dwc._maplify_occurrences + Step 15.5)
-- =====================================================================
-- All three rows use ON CONFLICT DO NOTHING (belt-and-suspenders for local re-runs).
-- provider_id omitted → DEFAULT 2 (maplify).

-- Row A: trusted=TRUE, bracket-tagged comment → recordedBy='Jane Smith'.
--   collection_id resolved by slug 'orca-network' (org 'Orca Network') → Row A
--   appears in the Step 15.5 associated-parties result. Resolved by slug, not a
--   hardcoded surrogate id, because collections.id is GENERATED AS IDENTITY
--   (Pitfall 4 — see the reference-tables migration).
INSERT INTO maplify.sightings (
    id, project_id, trip_id, scientific_name,
    location, number_sighted, created_at,
    in_ocean, moderated, trusted, is_test,
    source, comments, taxon_id, collection_id
) VALUES (
    1, 100, 200, 'Orcinus orca',
    gis.ST_Point(-122.9, 48.5)::gis.geography,
    3, NOW() - INTERVAL '2 days',
    TRUE, 1, TRUE, FALSE,
    'whale_alert',
    '[Orca Network] 3 orcas heading north (Jane Smith)<br>All adults.',
    41521,  -- Orcinus orca
    (SELECT id FROM public.collections WHERE slug = 'orca-network')
) ON CONFLICT (id) DO NOTHING;

-- Row B: trusted=FALSE → EXCLUDED from dwc.occurrences by WHERE s.trusted.
--   Exercises the trust-filter branch: row is present in maplify.sightings
--   but MUST NOT appear in dwc.occurrences (occurrenceID='maplify:2' count=0).
INSERT INTO maplify.sightings (
    id, project_id, trip_id, scientific_name,
    location, number_sighted, created_at,
    in_ocean, moderated, trusted, is_test,
    source, taxon_id
) VALUES (
    2, 100, 200, 'Orcinus orca',
    gis.ST_Point(-123.1, 48.6)::gis.geography,
    1, NOW() - INTERVAL '3 days',
    TRUE, 0, FALSE, FALSE,
    'whale_alert',
    41521
) ON CONFLICT (id) DO NOTHING;

-- Row C: trusted=TRUE, no bracket tag → recordedBy=NULL (regex returns NULL).
--   collection_id=NULL (no org) → LEFT JOIN falls through to COALESCE fallback;
--   Row C appears in dwc.occurrences but NOT in Step 15.5 associated-parties.
INSERT INTO maplify.sightings (
    id, project_id, trip_id, scientific_name,
    location, number_sighted, created_at,
    in_ocean, moderated, trusted, is_test,
    source, comments, taxon_id
) VALUES (
    3, 100, 200, 'Orcinus orca',
    gis.ST_Point(-123.0, 48.7)::gis.geography,
    2, NOW() - INTERVAL '4 days',
    TRUE, 1, TRUE, FALSE,
    'whale_alert',
    'Three orcas spotted near the rocks.',
    41521
) ON CONFLICT (id) DO NOTHING;
