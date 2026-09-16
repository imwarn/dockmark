CREATE TABLE smart_collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX smart_collections_name_unique ON smart_collections(lower(name));
CREATE INDEX smart_collections_position_idx ON smart_collections(position, name);
