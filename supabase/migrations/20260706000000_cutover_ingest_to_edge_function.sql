-- Cutover: drive ingest from the TypeScript Edge Function instead of in-DB SQL
-- (epic salishsea-io-89d / decision 011, issue salishsea-io-89d.3).
--
-- Atomic switch: unschedule the two pg_cron SQL ingest jobs and, in their place,
-- schedule pg_net calls to the `ingest` Edge Function every 5 minutes. Downtime
-- is acceptable — each run re-fetches a rolling 10-day window via idempotent
-- upsert, so any gap self-heals on the first new run.
--
-- SECRETS (set out-of-band in Vault, prod only):
--   - ingest_function_url    → https://<project-ref>.supabase.co/functions/v1/ingest
--   - ingest_trigger_secret  → the shared secret the function checks (also set as
--                              an Edge Function secret so the function can compare)
-- The scheduled command reads both from Vault. On a local `db reset` those
-- secrets do not exist, so the `WHERE EXISTS (...)` guard makes net.http_post a
-- no-op — local/dev NEVER calls the deployed function. (Local ingest, if needed,
-- is a manual `supabase functions serve` + curl.)
--
-- The SQL ingest FUNCTIONS themselves are intentionally NOT dropped here
-- (supabase/seed.sql still calls maplify.update_sightings directly). They are
-- retired in a later migration after a prod bake-in confirms the Edge path is
-- healthy via ingest.runs.

-- 1. Retire the old SQL ingest cron jobs (no-op if already gone).
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('load-recent-maplify-sightings', 'load-recent-inaturalist-observations');

-- 2. Schedule the Edge Function via pg_net, one job per source, every 5 minutes.
--    net.http_post is async (enqueues + returns immediately); the function does
--    the work and records its own ingest.runs row, so we do not consume the
--    response. The generous timeout only affects how pg_net logs the eventual
--    response, not whether the ingest completes.
SELECT cron.schedule('ingest-maplify', '*/5 * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ingest_function_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-ingest-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ingest_trigger_secret')
    ),
    body := jsonb_build_object('source', 'maplify', 'trigger', 'cron'),
    timeout_milliseconds := 60000
  )
  WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'ingest_function_url');
$job$);

SELECT cron.schedule('ingest-inaturalist', '*/5 * * * *', $job$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ingest_function_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-ingest-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ingest_trigger_secret')
    ),
    body := jsonb_build_object('source', 'inaturalist', 'trigger', 'cron'),
    timeout_milliseconds := 60000
  )
  WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'ingest_function_url');
$job$);
