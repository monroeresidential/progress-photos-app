CREATE TABLE projects (
  slug            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  site_url        TEXT NOT NULL,
  allowed_origins TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,
  project_slug  TEXT NOT NULL REFERENCES projects(slug),
  taken_at      TEXT NOT NULL,            -- ISO 8601 with the photo's own offset (display, day grouping)
  taken_utc     TEXT NOT NULL,            -- same instant as UTC 'YYYY-MM-DDTHH:MM:SS.sssZ' (ordering, cursor)
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL,
  caption       TEXT,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  widths        TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  hidden        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_slug, fingerprint)
);

CREATE INDEX photos_feed ON photos (project_slug, hidden, taken_utc DESC, id DESC);
