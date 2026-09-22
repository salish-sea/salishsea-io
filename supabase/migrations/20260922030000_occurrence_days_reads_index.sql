-- occurrence_days reads occurrence_index for all but the last 48 hours (salish-xfo).
--
-- The calendar's RPC was the heaviest read a visitor makes. On 2026-09-14 it
-- timed out for three visitors in three minutes (Sentry SALISHSEA-IO-37, 17:33
-- to 17:36 UTC) with no deploy, no ingest write and no traffic burst behind it.
-- pg_stat_statements since 2026-08-28: mean 445 ms, max 2,742 ms among the
-- calls that finished, against anon's statement_timeout of 3s. The map's own
-- query over the same view averages 20 ms.
--
-- Its cost is buffers, not planning. Measured on production for the request
-- that failed (2026-08-30..2026-10-10, bbox -126,47,-122,50.5):
--
--                                        time    buffers
--   public.occurrences, whole range ...  135 ms   19,536
--   index + live tail (this) ..........   53 ms    3,036   (before the index below)
--
-- 19,536 buffers is ~150 MB against 224 MB of shared_buffers, so one calendar
-- render evicted most of the cache and was fast only while nothing else wanted
-- it.
--
-- Why a split rather than the index alone: occurrence_index lags ingest by up to
-- ~6 minutes, and decision 021 wants a contributor's own sighting to grow its
-- day's circle the moment they save it. Sightings are almost always saved within
-- a day or two of being made, so the last 48 hours are read live and everything
-- older from the index. The two halves partition the range on observed_at, so
-- no row is counted twice. What is given up: a record whose observed_at is more
-- than 48 hours old reaches the calendar at the next refresh rather than
-- instantly, and a deleted one leaves the calendar at the next refresh too.
--
-- SECURITY DEFINER because occurrence_index is revoked from anon and
-- authenticated (20260708052333); the function returns only per-day counts of
-- rows those roles can already read through public.occurrences. search_path is
-- empty and every name is qualified, per 20260829040000.

-- The index half filtered on observed_at by seq-scanning the whole matview
-- (1,389 buffers to keep 1,108 of 63,097 rows). REFRESH ... CONCURRENTLY
-- maintains secondary indexes, so this costs the refresh little.
CREATE INDEX occurrence_index_observed_at ON public.occurrence_index (observed_at);

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
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH observed AS (
    SELECT o.observed_at, o.location
    FROM public.occurrence_index o
    WHERE o.observed_at >= (from_day::timestamp AT TIME ZONE 'PST8PDT')
      AND o.observed_at <  LEAST((to_day + 1)::timestamp AT TIME ZONE 'PST8PDT',
                                 now() - interval '48 hours')
    UNION ALL
    SELECT o.observed_at, o.location
    FROM public.occurrences o
    -- Half-open like the rest, so the two branches meet without overlapping.
    WHERE o.observed_at >= GREATEST(from_day::timestamp AT TIME ZONE 'PST8PDT',
                                    now() - interval '48 hours')
      AND o.observed_at <  ((to_day + 1)::timestamp AT TIME ZONE 'PST8PDT')
  )
  SELECT
    (observed_at AT TIME ZONE 'PST8PDT')::date AS day,
    count(*)::int AS occurrence_count
  FROM observed
  WHERE (location).lon BETWEEN COALESCE(min_lon, -180) AND COALESCE(max_lon, 180)
    AND (location).lat BETWEEN COALESCE(min_lat,  -90) AND COALESCE(max_lat,  90)
  GROUP BY 1;
$$;

COMMENT ON FUNCTION public.occurrence_days(date, date, double precision, double precision, double precision, double precision) IS
  'Sighting volume per PST8PDT calendar day within a date range and optional lon/lat bounds. Backs the sidebar calendar. Null bounds mean no spatial filter. Reads occurrence_index for records observed more than 48 hours ago and public.occurrences for the rest, so a new sighting counts immediately (decision 021) without the whole range paying for the view (salish-xfo).';

REVOKE ALL ON FUNCTION public.occurrence_days(date, date, double precision, double precision, double precision, double precision)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.occurrence_days(date, date, double precision, double precision, double precision, double precision)
  TO anon, authenticated;
