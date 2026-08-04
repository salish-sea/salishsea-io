-- occurrence_days: filter on the timestamp range, not the local-date cast (salish-46f).
--
-- The function filtered `(observed_at AT TIME ZONE 'PST8PDT')::date BETWEEN
-- from_day AND to_day`. Nothing indexes that expression: migration
-- 20260610001507 dropped the date-cast indexes as vestigial precisely because
-- the app had moved to timestamp-range filtering, and 20260731000000
-- reintroduced the cast when the function was created.
--
-- So the planner seq-scanned maplify.sightings and nested-looped against taxa,
-- discarding 101,001 rows to keep 405. Measured on production, 42-day window
-- (what the calendar's six-week grid asks for) with the Salish Sea bbox:
--
--                          time     buffers   maplify.sightings
--   date cast .........  180 ms      14,734   Seq Scan
--   timestamp range ...   79 ms      12,464   Bitmap Index Scan
--
-- The buffer count matters as much as the time. `anon` runs with
-- statement_timeout=3s, and 180 ms warm is only comfortable while the pages are
-- cached; the seq scan reads the whole sightings table when they aren't, which
-- is how a single request blew the ceiling on 2026-08-02 (Sentry
-- SALISHSEA-IO-11). Index scans degrade far better cold.
--
-- The signature is unchanged, so no client changes: `from_day`/`to_day` are
-- still local dates. Only the WHERE is rewritten, into the half-open range
-- [from_day 00:00 local, to_day+1 00:00 local). That is the same set of rows —
-- verified over the whole corpus, 2012 to 2026 and roughly thirty DST
-- transitions: 2,568 days and 61,671 occurrences under both, with zero rows in
-- either EXCEPT direction.
--
-- Reading occurrence_index instead would be cheaper still (28 ms, 731 buffers)
-- but it lags ingest by up to ~6 minutes, which decision 021 rejected so a
-- contributor's own sighting moves their circle the moment they save it.

CREATE OR REPLACE FUNCTION public.occurrence_days(
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
  -- Half-open, so the last day is whole without naming its final instant.
  WHERE observed_at >= (from_day::timestamp AT TIME ZONE 'PST8PDT')
    AND observed_at <  ((to_day + 1)::timestamp AT TIME ZONE 'PST8PDT')
    AND (location).lon BETWEEN COALESCE(min_lon, -180) AND COALESCE(max_lon, 180)
    AND (location).lat BETWEEN COALESCE(min_lat,  -90) AND COALESCE(max_lat,  90)
  GROUP BY 1;
$$;

COMMENT ON FUNCTION public.occurrence_days(date, date, double precision, double precision, double precision, double precision) IS
  'Sighting volume per PST8PDT calendar day within a date range and optional lon/lat bounds. Backs the sidebar calendar. Null bounds mean no spatial filter. Filters observed_at as a timestamp range so the observed_at indexes apply (salish-46f).';

-- CREATE OR REPLACE keeps the existing privileges, but restate them so the
-- migration is self-contained (same convention as 20260731000000).
GRANT EXECUTE ON FUNCTION public.occurrence_days(date, date, double precision, double precision, double precision, double precision)
  TO anon, authenticated;
