-- The first half of public.haulout_occurrences (supabase/migrations/20260919010000_haulouts.sql@6898775),
-- as a DuckDB twin (decision 061, salish-xv35.13): each pinniped report inside a haul-out
-- site's bounding box, with the two points the exact distance is measured between.
--
-- The view's second half, the distance itself, is PostGIS's spheroidal st_distance, which
-- DuckDB has only through its spatial extension. derive/haulout-distance.ts measures each
-- pair here instead, with GeographicLib, the library PostGIS calls; derive/profile-links.sql
-- keeps the pairs within the radius.
--
-- Reads build.occurrences, the haul-out sites as the snapshot holds them (documents), and
-- iNaturalist's taxonomy. Run after derive/shared.sql.

-- Pinnipeds: everything under the families Phocidae and Otariidae, walked by parent_id.
-- The box is the view's, divisor for divisor: it must stay a strict superset of the
-- circle (the view's comment says why each number is what it is), and as a twin it keeps
-- the same arithmetic rather than a tighter one of its own.
CREATE OR REPLACE TEMP TABLE haulout_nearby AS
  WITH RECURSIVE pinniped AS (
    SELECT id, scientific_name FROM source_inaturalist_taxa
     WHERE rank = 'family' AND scientific_name IN ('Phocidae', 'Otariidae')
    UNION
    SELECT t.id, t.scientific_name FROM source_inaturalist_taxa t JOIN pinniped p ON t.parent_id = p.id
  ),
  site AS (
    SELECT CAST(doc->>'id' AS INTEGER) AS id,
           CAST(doc->>'radius_m' AS INTEGER) AS radius_m,
           CAST(doc->'location'->>'lat' AS DOUBLE) AS lat,
           CAST(doc->'location'->>'lon' AS DOUBLE) AS lon
    FROM snapshot.haulouts
  ),
  report AS (
    SELECT id, location.lat AS lat, location.lon AS lon
    FROM build.occurrences
    WHERE doc->'taxon'->>'scientific_name' IN (SELECT scientific_name FROM pinniped)
      AND location.lon IS NOT NULL AND location.lat IS NOT NULL
  )
  SELECT h.id AS haulout_id, o.id AS occurrence_id, h.radius_m,
         h.lat AS site_lat, h.lon AS site_lon, o.lat, o.lon
  FROM site h
  JOIN report o
    ON o.lat BETWEEN h.lat - (h.radius_m / 110500.0)
                 AND h.lat + (h.radius_m / 110500.0)
   AND o.lon BETWEEN h.lon - (h.radius_m / (111320.0 * greatest(cos(radians(h.lat)), 0.01)))
                 AND h.lon + (h.radius_m / (111320.0 * greatest(cos(radians(h.lat)), 0.01)));
