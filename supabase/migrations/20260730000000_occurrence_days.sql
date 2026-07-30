-- occurrence_days: one row per local calendar day that has sightings, with how
-- many. Feeds the sidebar calendar (bd salish-dq2), which sizes each day's
-- circle by that day's volume.
--
-- Day boundaries use PST8PDT, matching every other date the app shows: the URL's
-- ?d=, fetchOccurrences' range, and dateFromObservedAt in src/salish-sea.ts. A
-- day here is therefore the same set of records the map draws for that ?d=.
--
-- Read live off public.occurrences rather than the occurrence_index matview.
-- The matview would be cheaper (~7ms vs ~120ms for a month) but lags ingest by
-- up to ~6 minutes, and the calendar sits directly above the form where a
-- contributor adds a sighting -- their own day's circle must grow the moment
-- they save it. A month costs ~120ms on prod, which is well within budget for a
-- control the user pages through by hand.
--
-- Clients filter on `day` (the calendar asks for one month at a time). Postgres
-- pushes that predicate down through the GROUP BY into each of the view's four
-- UNION branches, so the cost scales with the month, not the corpus.
CREATE VIEW public.occurrence_days AS
SELECT
  (observed_at AT TIME ZONE 'PST8PDT')::date AS day,
  count(*)::int AS occurrence_count
FROM public.occurrences
GROUP BY 1;

COMMENT ON VIEW public.occurrence_days IS
  'Sighting volume per PST8PDT calendar day. Backs the sidebar calendar.';

GRANT SELECT ON public.occurrence_days TO anon, authenticated;
