PRAGMA foreign_keys = ON;

CREATE TABLE bookmark_metadata (
  bookmark_id TEXT PRIMARY KEY REFERENCES bookmarks(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  canonical_url TEXT,
  icon_url TEXT,
  image_url TEXT,
  final_url TEXT,
  fetched_at TEXT NOT NULL
);

CREATE INDEX bookmark_metadata_fetched_idx ON bookmark_metadata(fetched_at DESC);

CREATE TRIGGER bookmark_metadata_clear_on_url_update
AFTER UPDATE OF url ON bookmarks
WHEN OLD.url <> NEW.url
BEGIN
  DELETE FROM bookmark_metadata WHERE bookmark_id = NEW.id;
END;
