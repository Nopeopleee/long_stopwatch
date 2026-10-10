-- Cloudflare production Workers cap WebCrypto PBKDF2 deriveBits at 100,000
-- iterations per call. The existing users table requires >= 200,000 and cannot
-- store a compliant password hash. Keep it and move password credentials into
-- a versioned, separately constrained table instead of rebuilding referenced
-- account rows or weakening the old CHECK constraint.
--
-- Version 1 uses HMAC-SHA256(password, a server-only AUTH_PASSWORD_PEPPER)
-- followed by salted PBKDF2-SHA256 with <= 100,000 iterations.
-- Never store the pepper here or rotate it without a password rehash plan.
CREATE TABLE IF NOT EXISTS auth_password_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL CHECK(length(password_hash) = 64),
  password_salt TEXT NOT NULL CHECK(length(password_salt) = 32),
  password_iterations INTEGER NOT NULL CHECK(password_iterations BETWEEN 10000 AND 100000),
  kdf_version INTEGER NOT NULL DEFAULT 1 CHECK(kdf_version = 1),
  updated_at INTEGER NOT NULL
);
