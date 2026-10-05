-- What salishsea.io's users write (decision 065, salish-9uu.3.2), as Postgres held it: the
-- same tables and columns, with Postgres's constraints, so the copy is a copy and the
-- build reads the same rows. SQLite has no geography, enum or timestamptz: a location is
-- its longitude and latitude, an enum a CHECKed text, a time ISO 8601 text in UTC.

-- Who a sighting is attributed to. Only those who sign in or own a native sighting: the
-- iNaturalist observers Postgres's ingest minted are not ours (the mirror keeps their
-- logins). `id` and `entity_id` are Postgres's, kept, since files and links carry them.
CREATE TABLE contributors (
  id        INTEGER PRIMARY KEY,
  entity_id TEXT    NOT NULL UNIQUE,
  name      TEXT    NOT NULL CHECK (length(name) >= 1),
  picture   TEXT,
  editor    INTEGER NOT NULL DEFAULT 0 CHECK (editor IN (0, 1)),
  -- the canonical URI's shape; the import checks its checksum, as is_valid_orcid did
  orcid     TEXT CHECK (orcid IS NULL OR orcid GLOB 'https://orcid.org/[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9X]')
) STRICT;

-- A Google account that has signed in (030), and the contributor it writes as. `id` is
-- the Supabase user's uuid, kept, so a sighting's owner stays its owner across the move.
CREATE TABLE users (
  id             TEXT    PRIMARY KEY,
  google_sub     TEXT    NOT NULL UNIQUE,
  email          TEXT,
  -- RESTRICT, here and on a sighting: removing a contributor is a deliberate migration,
  -- never a cascade that takes their sightings with it.
  contributor_id INTEGER NOT NULL REFERENCES contributors(id) ON DELETE RESTRICT,
  created_at     TEXT    NOT NULL
) STRICT;

-- The emails a contributor is known by, so a new sign-in with one Google has verified
-- joins its contributor. NOCASE folds ASCII only, where Postgres's citext folded Unicode.
CREATE TABLE contributor_email_addresses (
  email_address  TEXT    PRIMARY KEY COLLATE NOCASE,
  contributor_id INTEGER NOT NULL REFERENCES contributors(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE observations (
  id             TEXT    PRIMARY KEY,
  observed_at    TEXT    NOT NULL,
  subject_lon    REAL    NOT NULL,
  subject_lat    REAL    NOT NULL,
  observer_lon   REAL,
  observer_lat   REAL,
  body           TEXT,
  count          INTEGER CHECK (count IS NULL OR count > 0),
  url            TEXT,
  direction      TEXT    CHECK (direction IS NULL OR direction IN
                   ('north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest')),
  accuracy       INTEGER,
  contributor_id INTEGER REFERENCES contributors(id) ON DELETE RESTRICT,
  user_id        TEXT    NOT NULL REFERENCES users(id),
  provider_id    INTEGER NOT NULL DEFAULT 1,
  collection_id  INTEGER DEFAULT 10,
  source_url     TEXT,
  entity_id      TEXT    NOT NULL CHECK (entity_id GLOB 'SSA:[0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL,
  CHECK ((observer_lon IS NULL) = (observer_lat IS NULL))
) STRICT;

CREATE TABLE observation_photos (
  id             INTEGER PRIMARY KEY,
  observation_id TEXT    NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL CHECK (seq >= 0),
  href           TEXT    NOT NULL,
  license_code   TEXT    NOT NULL,
  UNIQUE (observation_id, seq)
) STRICT;

-- 039: anyone may write, nobody reads but the notifier, which stamps the last two.
CREATE TABLE feedback (
  id           INTEGER PRIMARY KEY,
  created_at   TEXT    NOT NULL,
  name         TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email        TEXT    CHECK (email IS NULL OR length(email) BETWEEN 3 AND 320),
  message      TEXT    NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
  page_url     TEXT    CHECK (page_url IS NULL OR length(page_url) <= 2000),
  user_agent   TEXT    CHECK (user_agent IS NULL OR length(user_agent) <= 500),
  release      TEXT    CHECK (release IS NULL OR length(release) <= 100),
  user_id      TEXT    REFERENCES users(id) ON DELETE SET NULL,
  notified_at  TEXT,
  github_issue INTEGER
) STRICT;

-- What a person asserts an occurrence shows (014, 054). None yet. The individual, group
-- and party they name are the catalogue's, which lives in files, so those references are
-- checked where they are read, not here.
CREATE TABLE identifications (
  id                   INTEGER PRIMARY KEY,
  occurrence_id        TEXT    NOT NULL,
  individual_id        INTEGER,
  social_group_id      INTEGER,
  is_present           INTEGER NOT NULL DEFAULT 1 CHECK (is_present IN (0, 1)),
  evidence             TEXT    CHECK (evidence IS NULL OR evidence IN
                         ('text_mention', 'photograph', 'cv_match', 'field_observation', 'acoustic')),
  method               TEXT    NOT NULL CHECK (method IN ('text_extraction', 'manual', 'cv', 'upstream_import')),
  status               TEXT    NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'validated', 'rejected')),
  asserted_by_party_id INTEGER,
  confidence           REAL    CHECK (confidence IS NULL OR method = 'cv'),
  code                 TEXT,
  created_at           TEXT    NOT NULL,
  certainty            TEXT    CHECK (certainty IS NULL OR certainty IN ('possible', 'probable', 'certain')),
  CHECK ((individual_id IS NULL) <> (social_group_id IS NULL))
) STRICT;
