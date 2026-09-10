-- Broadcast 'occurrences_changed' once per transaction that changes a row, not
-- once per statement whether or not it changed anything (bd salish-xfo).
--
-- The triggers from 20260330000000 fire FOR EACH STATEMENT, so every INSERT
-- and DELETE the ingest issues sends a broadcast even when it touched no rows —
-- and the maplify upsert had no change guard, so it rewrote ~200 unchanged
-- rows every five minutes. Result: four broadcasts on every ingest tick, on a
-- quiet day as much as a busy one. Every open tab refetched the day's
-- sightings on each of them, at once, while the database was still inside the
-- tick's writes. A visitor's query started in that window and was killed at
-- the 3s anon statement_timeout (Sentry SALISHSEA-IO-3D, 2026-08-31 19:25).
--
-- Row-level triggers see only rows that actually changed, and a
-- transaction-local flag collapses a bulk write to one broadcast. The ingest
-- wraps each source's upsert and delete in one transaction, so a tick now
-- sends at most one broadcast per source that changed something, and none
-- when nothing did. Realtime forwards the message on commit, so a subscriber
-- that refetches after receiving it sees the rows the transaction wrote.
--
-- Trigger names are kept: 20260706130000_ingest_role.sql refers to them.

CREATE OR REPLACE FUNCTION public.notify_occurrences_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  -- An UPDATE that sets every column to what it already was still fires a
  -- row trigger. The ingest upserts guard against that themselves, but this
  -- is the place every writer passes through, so it is the place to be sure.
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NULL;
  END IF;
  -- set_config(..., is_local => true) scopes the flag to this transaction, so
  -- the first changed row broadcasts and the rest of the transaction is quiet.
  -- Outside an explicit transaction that is the statement, which is the same
  -- once-per-write guarantee the statement trigger gave.
  IF coalesce(pg_catalog.current_setting('salishsea.occurrences_notified', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM pg_catalog.set_config('salishsea.occurrences_notified', 'on', true);
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
DROP TRIGGER IF EXISTS occurrences_changed_after_observations ON public.observations;
CREATE TRIGGER occurrences_changed_after_observations
  AFTER INSERT OR UPDATE OR DELETE ON public.observations
  FOR EACH ROW EXECUTE FUNCTION public.notify_occurrences_changed();

-- maplify.sightings (Whale Alert data ingested by cron)
DROP TRIGGER IF EXISTS occurrences_changed_after_maplify_sightings ON maplify.sightings;
CREATE TRIGGER occurrences_changed_after_maplify_sightings
  AFTER INSERT OR UPDATE OR DELETE ON maplify.sightings
  FOR EACH ROW EXECUTE FUNCTION public.notify_occurrences_changed();

-- inaturalist.observations (iNaturalist data ingested by cron)
DROP TRIGGER IF EXISTS occurrences_changed_after_inat_observations ON inaturalist.observations;
CREATE TRIGGER occurrences_changed_after_inat_observations
  AFTER INSERT OR UPDATE OR DELETE ON inaturalist.observations
  FOR EACH ROW EXECUTE FUNCTION public.notify_occurrences_changed();

-- happywhale.encounters (HappyWhale data ingested by cron)
DROP TRIGGER IF EXISTS occurrences_changed_after_happywhale_encounters ON happywhale.encounters;
CREATE TRIGGER occurrences_changed_after_happywhale_encounters
  AFTER INSERT OR UPDATE OR DELETE ON happywhale.encounters
  FOR EACH ROW EXECUTE FUNCTION public.notify_occurrences_changed();
