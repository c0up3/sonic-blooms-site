CREATE TABLE IF NOT EXISTS members (
  email TEXT PRIMARY KEY,
  name TEXT,
  favourite TEXT,
  status TEXT NOT NULL DEFAULT 'waitlist',
  confirmation_code TEXT,
  code_created_at TEXT,
  code_revoked_at TEXT,
  banned_at TEXT,
  ban_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS signup_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  email TEXT,
  action TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS signup_attempts_ip_created_idx
  ON signup_attempts (ip_hash, created_at);

CREATE INDEX IF NOT EXISTS signup_attempts_email_created_idx
  ON signup_attempts (email, created_at);
