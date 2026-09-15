PRAGMA foreign_keys = ON;

ALTER TABLE health_checks
ADD COLUMN source TEXT NOT NULL DEFAULT 'server'
CHECK(source IN ('server', 'extension'));

CREATE INDEX health_checks_source_idx ON health_checks(bookmark_id, source, checked_at DESC);
