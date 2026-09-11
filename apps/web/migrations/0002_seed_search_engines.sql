INSERT OR IGNORE INTO search_engines (id, name, keyword, search_url, is_default, position) VALUES
  ('search-google', 'Google', 'g', 'https://www.google.com/search?q=%s', 1, 0),
  ('search-bing', 'Bing', 'b', 'https://www.bing.com/search?q=%s', 0, 1),
  ('search-duckduckgo', 'DuckDuckGo', 'ddg', 'https://duckduckgo.com/?q=%s', 0, 2),
  ('search-github', 'GitHub', 'gh', 'https://github.com/search?q=%s&type=repositories', 0, 3);
