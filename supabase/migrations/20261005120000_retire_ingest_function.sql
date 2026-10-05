-- The `ingest` Edge Function retires (decision 061, salish-xv35.9), and the two Vault
-- secrets that let pg_cron call it go with it.
--
-- pg_cron called the function every five minutes for each source, reading its URL and
-- trigger secret from Vault (20260706000000, 20260925120000). Migrations 20261004120000
-- and 20261005000000 unscheduled all three jobs: the read-path build fetches every source
-- itself, with the same shared fetch code, into its own mirrors. Nothing else read these
-- secrets — the backfill script that used them to call the function by hand retires in
-- the same change — so they serve nothing, and a secret that serves nothing is only
-- something to leak.
--
-- The function connected as the `ingest` role (20260706130000), which production gave a
-- password out of band. That login now serves nothing either, and it carries write grants
-- on every source table, so it goes too. The role and its grants stay: the persist tests
-- run as it through SET ROLE, which needs no login.
--
-- The function itself is deleted by hand (`supabase functions delete ingest`), along with
-- its secrets INGEST_TRIGGER_SECRET, INGEST_DB_URL and INGEST_SENTRY_DSN; none lives in
-- the database.
-- ingest.runs stays: it is the history of every run Postgres's ingest made, and dropping
-- it is a decision of its own.

DELETE FROM vault.secrets
WHERE name IN ('ingest_function_url', 'ingest_trigger_secret');

ALTER ROLE ingest NOLOGIN PASSWORD NULL;
