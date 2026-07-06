-- Operational audit table for the TypeScript ingest pipeline (epic
-- salishsea-io-89d / decision 011). One row per ingest run: the durable,
-- queryable per-source metrics record and the substrate for the future
-- heartbeat/freshness alert (salishsea-io-89d.4).
--
-- Lives in its own `ingest` schema — operational metadata, deliberately NOT part
-- of the authoritative `public.*` domain (CONTEXT.md / decision 008).
--
-- Write protocol (decision 011): the shell inserts a `started` row (outcome NULL)
-- OUTSIDE the data transaction, then updates outcome/counts after the data
-- transaction commits or rolls back. A crashed run therefore leaves a visible
-- orphan (outcome IS NULL, finished_at IS NULL). There is no `partial` outcome —
-- partial persists cannot happen (the data txn is atomic).

CREATE SCHEMA IF NOT EXISTS ingest;

CREATE TABLE ingest.runs (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source         text        NOT NULL CHECK (source IN ('maplify', 'inaturalist')),
    trigger        text        NOT NULL CHECK (trigger IN ('cron', 'manual')),
    dry_run        boolean     NOT NULL DEFAULT false,
    window_start   date        NOT NULL,
    window_end     date        NOT NULL,
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    -- NULL while running; set once the data txn resolves. No 'partial' state.
    outcome        text        CHECK (outcome IN ('success', 'failed')),
    pages_fetched  integer,
    total_results  integer,
    rows_upserted  integer,
    rows_deleted   integer,
    error          text,

    -- finished runs must carry an outcome and a finish time together
    CONSTRAINT runs_finished_has_outcome
      CHECK ((finished_at IS NULL) = (outcome IS NULL)),
    -- a successful run records no error; a failed run must say why
    CONSTRAINT runs_error_matches_outcome
      CHECK (
        outcome IS DISTINCT FROM 'success' OR error IS NULL
      )
);

COMMENT ON TABLE ingest.runs IS
  'One row per network-ingest run (decision 011). Started row written outside the data txn; outcome/counts updated after it resolves. Orphan (outcome NULL) = crashed/hung run.';

-- Heartbeat query support: "newest successful run per source".
CREATE INDEX runs_source_finished_idx
  ON ingest.runs (source, finished_at DESC)
  WHERE outcome = 'success';

-- The ingest worker connects as a dedicated privileged role (decision 011),
-- created/granted in a later slice. No RLS or anon grants here: ingest.runs is
-- operational and reached only by that trusted role, never the public API.
