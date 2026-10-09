-- D1 stores server-trusted timestamps in Unix milliseconds.
-- Imported local pets keep legacy_started_at separately; it is not trusted
-- for public ranking. No rows are created by this migration.
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
  created_at INTEGER NOT NULL,
  origin TEXT NOT NULL DEFAULT 'native' CHECK (origin IN ('native', 'legacy')),
  legacy_started_at INTEGER,
  owner_token_hash TEXT NOT NULL,
  last_fed_at INTEGER NOT NULL,
  feed_count INTEGER NOT NULL DEFAULT 0 CHECK (feed_count >= 0),
  died_at INTEGER,
  updated_at INTEGER NOT NULL
);
