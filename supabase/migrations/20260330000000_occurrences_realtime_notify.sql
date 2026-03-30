-- Replace the defunct postgres_changes subscription on the occurrences VIEW
-- (which never fires because views produce no WAL events) with triggers on
-- each of the four base tables that feed the view.  Each trigger calls
-- realtime.send(), which issues a pg_notify() under the hood so that the
-- Supabase Realtime server forwards a broadcast event to all subscribed
-- clients.  The frontend listens with
--   supabase.channel('occurrences').on('broadcast', {event: 'occurrences_changed'}, ...)

CREATE OR REPLACE FUNCTION public.notify_occurrences_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM realtime.send(
    '{}'::jsonb,
    'occurrences_changed',
    'occurrences',
    false  -- public channel: no authentication required to receive
  );
  RETURN NULL;
END;
$$;

-- public.observations (user-submitted sightings via SalishSea.io)
CREATE TRIGGER occurrences_changed_after_observations
  AFTER INSERT OR UPDATE OR DELETE ON public.observations
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_occurrences_changed();

-- maplify.sightings (Whale Alert data ingested by cron)
CREATE TRIGGER occurrences_changed_after_maplify_sightings
  AFTER INSERT OR UPDATE OR DELETE ON maplify.sightings
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_occurrences_changed();

-- inaturalist.observations (iNaturalist data ingested by cron)
CREATE TRIGGER occurrences_changed_after_inat_observations
  AFTER INSERT OR UPDATE OR DELETE ON inaturalist.observations
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_occurrences_changed();

-- happywhale.encounters (HappyWhale data ingested by cron)
CREATE TRIGGER occurrences_changed_after_happywhale_encounters
  AFTER INSERT OR UPDATE OR DELETE ON happywhale.encounters
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_occurrences_changed();
