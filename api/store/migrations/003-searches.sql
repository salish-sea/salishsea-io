-- What people search for (decision 078): one row each time someone chooses a result in
-- the search field, or gives up, by closing it or pausing without choosing. No account,
-- address or cookie is kept: only the words typed, how many results they found, what was
-- chosen, and which kind of page the field was on.
CREATE TABLE searches (
  id            INTEGER PRIMARY KEY,
  created_at    TEXT    NOT NULL,
  query         TEXT    NOT NULL CHECK (length(query) BETWEEN 1 AND 200),
  results       INTEGER NOT NULL CHECK (results >= 0),
  chosen_kind   TEXT    CHECK (chosen_kind IS NULL OR length(chosen_kind) BETWEEN 1 AND 40),
  chosen_label  TEXT    CHECK (chosen_label IS NULL OR length(chosen_label) BETWEEN 1 AND 200),
  page          TEXT    CHECK (page IS NULL OR length(page) BETWEEN 1 AND 40)
) STRICT;
