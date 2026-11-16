-- Posts sent from the Orca Network Community Group on Facebook (decision 117, bd
-- salish-i1a.3.3). Only a contributor marked as a sender may send: Orca Network's staff
-- or people it names, granted by hand on the machine (docs/runbook/read-path-build.md).
-- Not `editor`, which may change anyone's sightings, and not the curators of decision 120,
-- who need not be senders.
ALTER TABLE contributors ADD COLUMN facebook_sender INTEGER NOT NULL DEFAULT 0 CHECK (facebook_sender IN (0, 1));

-- One row for each send: who sent which post, when, and whether the reader could read it.
-- The post's HTML is not here but in a file on the volume (api/facebook-sends.ts), deleted
-- after a week, or a month if it couldn't be read: at up to 700 KB a send, it would swell
-- the store that the build copies every five minutes and that Litestream keeps for 30 days.
-- What the post says is the next step's to keep (bd salish-i1a.3.5).
CREATE TABLE facebook_sends (
  id           INTEGER PRIMARY KEY,
  received_at  TEXT    NOT NULL,                -- ISO 8601, UTC: when the API received it
  captured_at  TEXT    NOT NULL,                -- when the bookmarklet took the post, by the sender's clock,
                                                -- which Facebook's "2 hours ago" counts back from
  user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  url          TEXT    NOT NULL CHECK (length(url) BETWEEN 1 AND 2000),  -- the page's address as the sender had it
  group_id     TEXT,                            -- Facebook's, from the post's permalinks or else its address
  post_id      TEXT,
  html_bytes   INTEGER NOT NULL CHECK (html_bytes >= 0),
  html_sha256  TEXT    NOT NULL,
  file         TEXT    NOT NULL,                -- its HTML's file, while it is kept
  lines        INTEGER CHECK (lines >= 0),      -- what the reader found, or null when it couldn't read it
  comments     INTEGER CHECK (comments >= 0),
  error        TEXT,                            -- why it couldn't, or null
  CHECK ((error IS NULL) = (lines IS NOT NULL AND comments IS NOT NULL))
) STRICT;
