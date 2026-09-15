CREATE TABLE IF NOT EXISTS site_content (
  id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  client_key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_login_attempts_updated_at
  ON admin_login_attempts (updated_at);
