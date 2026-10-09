-- Account authentication and ownership. Keep 0001 immutable for existing D1 deployments.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email_verified_at INTEGER,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((password_hash IS NULL AND password_salt IS NULL AND password_iterations IS NULL) OR
         (password_hash IS NOT NULL AND password_salt IS NOT NULL AND password_iterations >= 200000))
);

CREATE TABLE IF NOT EXISTS auth_identities (
  provider TEXT NOT NULL CHECK (provider = 'google'),
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (provider, user_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, user_id)
);

CREATE TABLE IF NOT EXISTS pet_owners (
  pet_id TEXT PRIMARY KEY NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  linked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
