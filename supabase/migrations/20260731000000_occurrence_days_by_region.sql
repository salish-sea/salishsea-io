-- occurrence_days gains a region (salish-yfd).
--
-- The sidebar calendar sizes each day's circle by that day's sighting volume.
-- Once a region filters the map and the list, the calendar has to agree: a day
-- that counts sightings the map is not drawing reads "busy" and then clicks
-- through to empty water, which is exactly the confusion this feature exists to
-- remove.
--
-- The bbox has to apply BEFORE the aggregate, and the view exposed only `day`
-- and `occurrence_count`, so there was nothing for a client-side predicate to
-- bite on. Hence a function. The map and the observation list need no such
-- thing — PostgREST filters `location->lon` / `location->lat` on the
-- occurrences view directly.
--
-- Bounds are nullable, together meaning "Everywhere": COALESCE to whole-world
-- limits rather than branching on IS NULL, so the planner sees one shape
-- regardless of region.
--
-- Cost, measured on production (61k occurrences, 2026-07-30):
--
--   * a month with no region  ............ 169 ms
--   * a month + the Salish Sea bbox ...... 75 ms
--   * the Salish Sea bbox, NO day bound .. 3,448 ms
--
-- Adding the region makes it FASTER: the bbox cuts rows before they reach the
-- occurrences view's nested-loop joins against taxa/providers/collections/
-- organizations, which are what the query actually spends its time on. There is
-- deliberately no spatial index — `location` on the view is a computed
-- composite, not a geography, so no index could apply, and the Salish Sea bbox
-- matches 62% of the corpus, where a seq scan wins anyway. See decision 021.
--
-- The day bound is NOT optional, and that is load-bearing: the third row above
-- is what a region query costs without one. `from_day`/`to_day` are required
-- arguments so there is no way to call this without a date range.

DROP VIEW IF EXISTS public.occurrence_days;

CREATE FUNCTION public.occurrence_days(
  from_day date,
  to_day   date,
  min_lon  double precision DEFAULT NULL,
  min_lat  double precision DEFAULT NULL,
  max_lon  double precision DEFAULT NULL,
  max_lat  double precision DEFAULT NULL
)
RETURNS TABLE (day date, occurrence_count int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (observed_at AT TIME ZONE 'PST8PDT')::date AS day,
    count(*)::int AS occurrence_count
  FROM public.occurrences
  WHERE (observed_at AT TIME ZONE 'PST8PDT')::date >= from_day
    AND (observed_at AT TIME ZONE 'PST8PDT')::date <= to_day
    AND (location).lon BETWEEN COALESCE(min_lon, -180) AND COALESCE(max_lon, 180)
    AND (location).lat BETWEEN COALESCE(min_lat,  -90) AND COALESCE(max_lat,  90)
  GROUP BY 1;
$$;

COMMENT ON FUNCTION public.occurrence_days(date, date, double precision, double precision, double precision, double precision) IS
  'Sighting volume per PST8PDT calendar day within a date range and optional lon/lat bounds. Backs the sidebar calendar. Null bounds mean no spatial filter.';

GRANT EXECUTE ON FUNCTION public.occurrence_days(date, date, double precision, double precision, double precision, double precision)
  TO anon, authenticated;
