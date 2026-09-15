ALTER TABLE bookmarks ADD COLUMN inbox_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bookmarks_inbox_at
  ON bookmarks(inbox_at);
