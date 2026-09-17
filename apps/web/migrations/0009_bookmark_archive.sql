ALTER TABLE bookmarks ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bookmarks_archived_at
  ON bookmarks(archived_at);
