-- Record on the run row what decision 042 already decides in the fetch layer:
-- whether a failure was transient (an upstream 5xx or 429, a timeout, a refused
-- connection — exactly what the retry policy retries). Until now that verdict
-- reached the structured log and Sentry's gate but not ingest.runs, so the
-- heartbeat (decision 012) could not tell iNaturalist being down for
-- maintenance from our own pipeline stopping, and tripped on both (decision 060).
--
-- NOT NULL DEFAULT false: unmarked is a defect, as in 042. Historic failed rows
-- stay false; the heartbeat only reads a day back, so they age out on their own.

ALTER TABLE ingest.runs
    ADD COLUMN transient boolean NOT NULL DEFAULT false;

ALTER TABLE ingest.runs
    ADD CONSTRAINT runs_transient_only_on_failure
    CHECK (NOT transient OR outcome = 'failed');

COMMENT ON COLUMN ingest.runs.transient IS
  'Failed because the upstream was unavailable (decision 042''s classifier), not because of a defect. Always false unless outcome = failed.';
