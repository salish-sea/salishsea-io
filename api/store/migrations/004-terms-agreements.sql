-- A contributor's agreement to the terms of use (decision 086, #739): which version,
-- when, and from which signed-in account. The agreement is the contributor's, the
-- person's, though they may sign in with more than one account. Kept as a history, one
-- row per version agreed, so a later version is a new row beside the old.
CREATE TABLE terms_agreements (
  contributor_id INTEGER NOT NULL REFERENCES contributors(id) ON DELETE RESTRICT,
  version        INTEGER NOT NULL CHECK (version >= 1),
  agreed_at      TEXT    NOT NULL,
  user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  PRIMARY KEY (contributor_id, version)
) STRICT;
