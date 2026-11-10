-- Password hashes and revocable server-side sessions.
-- Does not set a password and does not insert a hash. The operator sets the
-- first hash after deploy, outside this repo.

PRAGMA foreign_keys = ON;

ALTER TABLE owners ADD COLUMN password_hash TEXT;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  csrf_secret TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (owner_id) REFERENCES owners (id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_owner_id ON sessions (owner_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, created_at);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts (ip, created_at);
