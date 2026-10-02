-- What more than one derivation uses (decision 061): how to_jsonb renders the values a
-- document carries, and the register function both the occurrences and the profile links
-- call. Run before derive/occurrences.sql and derive/profile-links.sql, in the same
-- session, by the scripts that run those.

-- A timestamptz as to_jsonb renders it in a UTC session: ISO 8601 with a T, the fraction
-- only when there is one and without its trailing zeros, and +00:00.
CREATE OR REPLACE TEMP MACRO pg_ts(t) AS
  CASE WHEN t IS NULL THEN NULL ELSE
    strftime(t, '%Y-%m-%dT%H:%M:%S')
    || CASE WHEN ((epoch_us(t) % 1000000) + 1000000) % 1000000 = 0 THEN ''
            ELSE '.' || rtrim(lpad(CAST(((epoch_us(t) % 1000000) + 1000000) % 1000000 AS VARCHAR), 6, '0'), '0')
       END
    || '+00:00'
  END;

-- A float8 as Postgres renders it here: the database sets extra_float_digits = 0, so
-- float8out prints %.15g (fifteen significant digits) and to_jsonb keeps that text.
-- Coordinates are the only floats in a document. Only the document is rounded: the
-- views and build.occurrences hold the exact doubles, as derived.occurrences does,
-- because the identifier candidates carry an occurrence's location unrounded.
CREATE OR REPLACE TEMP MACRO pg_float(x) AS CAST(printf('%.15g', x) AS DOUBLE);
CREATE OR REPLACE TEMP MACRO pg_lon_lat(p) AS
  CASE WHEN p IS NOT NULL THEN {'lat': pg_float(p.lat), 'lon': pg_float(p.lon)} END;

-- register.taxon_entity_for(entity): the taxon an entity is, or the nearest one above it,
-- after following a deprecation to its replacement. A split (deprecated, no replacement)
-- resolves to nothing, deliberately: see the comment in the Postgres function.
CREATE OR REPLACE TEMP VIEW taxon_entity AS
  WITH resolved AS (
    SELECT e.entity_id AS asked, CASE WHEN d.entity_id IS NULL THEN e.entity_id ELSE d.replaced_by END AS entity_id
    FROM register.entities e
    LEFT JOIN register.deprecations d ON d.entity_id = e.entity_id
  )
  SELECT r.asked AS entity_id,
         coalesce(
           (SELECT e.entity_id FROM register.entities e WHERE e.entity_id = r.entity_id AND e.kind = 'taxon'),
           (SELECT a.ancestor_id FROM register.ancestor a
             WHERE a.entity_id = r.entity_id AND a.ancestor_kind = 'taxon'
             ORDER BY a.depth LIMIT 1)
         ) AS taxon_entity_id
  FROM resolved r;

