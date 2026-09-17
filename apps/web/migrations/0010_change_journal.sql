CREATE TABLE change_journal (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  summary TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_change_journal_created_at
  ON change_journal(created_at DESC);
