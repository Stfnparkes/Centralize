-- SPMA backend schema (SQLite)
-- Designed to back the same window.storage keyspace the frontend modules use.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Generic key-value store, keyed by (prefix, key). Maps 1:1 to the frontend's
-- window.storage calls: a prefix is e.g. "roster", "games", "playerProfiles",
-- "messages", "attributes" etc. and "key" is the entity id within that prefix.
CREATE TABLE IF NOT EXISTS kv (
  prefix     TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,                 -- JSON-encoded entity
  updated_at INTEGER NOT NULL,
  updated_by TEXT,                              -- user id (FK kept loose for prototype)
  PRIMARY KEY (prefix, key)
);
CREATE INDEX IF NOT EXISTS idx_kv_prefix     ON kv(prefix);
CREATE INDEX IF NOT EXISTS idx_kv_updated_at ON kv(updated_at);

-- Users / identities. The prototype is passwordless — login.html picks a
-- role and (for players) a roster slot. In production this is replaced by
-- email + password against the same table.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,           -- 'coach-1' | 'trainer-1' | player roster id like 'pl-1'
  role          TEXT    NOT NULL,              -- 'player' | 'coach' | 'trainer' | 'admin'
  name          TEXT    NOT NULL,
  player_id     TEXT,                          -- for role='player': matches the kv roster id
  email         TEXT    UNIQUE,
  password_hash TEXT,                          -- nullable for prototype
  created_at    INTEGER NOT NULL,
  CHECK (role IN ('player','coach','trainer','admin'))
);

-- Refresh tokens (rotation). Optional for prototype; included so the schema
-- mirrors the original backend skeleton in the coaches-module zip.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  jti        TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Audit log — every write to kv lands here, scoped by user. The original
-- coaches-module backend included an audit table; we mirror that.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL,
  user_id    TEXT,
  role       TEXT,
  action     TEXT    NOT NULL,                 -- 'kv.set' | 'kv.delete' | 'auth.login' | 'auth.logout'
  prefix     TEXT,
  key        TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_occurred_at ON audit_log(occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_user_id     ON audit_log(user_id);
