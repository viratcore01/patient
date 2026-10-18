-- Vitalis Patient Search — central database schema (single-doctor clinic)

CREATE TABLE IF NOT EXISTS patients (
  id            TEXT PRIMARY KEY,          -- registration number, e.g. HM-2026-0205
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  age           INTEGER,
  gender        TEXT,
  city          TEXT,
  first_visit   TEXT,
  seed_notes    TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  registration_number TEXT NOT NULL,
  owner               TEXT NOT NULL,       -- fixed owner marker (single-doctor clinic)
  body                TEXT NOT NULL DEFAULT '',
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (registration_number, owner)
);
