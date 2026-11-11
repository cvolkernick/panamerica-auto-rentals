-- Single-use owner invite tokens. Stores the SHA-256 of the token, never the token.
-- Apply later with wrangler d1 execute. Creating a new link marks older unused rows used.

PRAGMA foreign_keys = ON;

CREATE TABLE owner_invites (
  token_hash TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES owners (id) ON DELETE CASCADE
);

CREATE INDEX idx_owner_invites_owner_id ON owner_invites (owner_id);
