-- Local-only seed data for reviewing Dockmark UI states.
DELETE FROM bookmark_tags;
DELETE FROM tags;
DELETE FROM workspace_items;
DELETE FROM workspaces;
DELETE FROM session_items;
DELETE FROM sessions;
DELETE FROM bookmarks;
DELETE FROM categories;

INSERT INTO categories (id, name, icon, position) VALUES
  ('cat-dev',   'Development',  'code',     0),
  ('cat-read',  'Reading',      'book',     1),
  ('cat-design','Design',       'palette',  2),
  ('cat-tools', 'Tools',        'wrench',   3),
  ('cat-ref',   'Reference With A Fairly Long Category Name', 'folder', 4);

INSERT INTO bookmarks (id, category_id, title, url, description, position, health_policy, health_status) VALUES
  ('bm-01','cat-dev','GitHub','https://github.com/','Where the code lives.',0,'normal','healthy'),
  ('bm-02','cat-dev','Cloudflare Workers docs','https://developers.cloudflare.com/workers/','Runtimes, bindings and limits for Dockmark''s Worker API.',1,'normal','healthy'),
  ('bm-03','cat-dev','Vite','https://vite.dev/','Frontend build tooling used by the Web app.',2,'normal','healthy'),
  ('bm-04','cat-read','Hacker News','https://news.ycombinator.com/','Daily skim.',0,'normal','healthy'),
  ('bm-05','cat-read','Lobsters','https://lobste.rs/','Smaller, calmer link aggregator.',1,'normal','slow'),
  ('bm-06','cat-read','A Very Long Bookmark Title That Should Be Truncated Instead Of Pushing The Actions Off Screen','https://example.com/long-title','Description is also long so the second line has something realistic to ellipsize.',2,'normal','healthy'),
  ('bm-07','cat-design','Figma','https://www.figma.com/','Interface work.',0,'normal','healthy'),
  ('bm-08','cat-design','Coolors','https://coolors.co/','Palette generation.',1,'normal','healthy'),
  ('bm-09','cat-design','Refactoring UI','https://www.refactoringui.com/','Visual design rules.',2,'ignore','ignored'),
  ('bm-10','cat-tools','camelCase Converter','https://example.com/camel','Small utilities used every day.',0,'normal','healthy'),
  ('bm-11','cat-tools','JSON Formatter','https://jsonformatter.org/','',1,'manual','unknown'),
  ('bm-12','cat-tools','Internal Dashboard','http://192.168.1.24:8080/','Local-only service, health checks must stay on-device.',2,'local-only','unknown'),
  ('bm-13','cat-ref','MDN Web Docs','https://developer.mozilla.org/en-US/','The reference.',0,'normal','healthy'),
  ('bm-14',NULL,'Unsorted Inbox Link','https://example.com/unsorted','Captured but not yet filed.',0,'normal','unknown'),
  ('bm-15',NULL,'Another Inbox Link With No Category','https://example.org/another','',1,'normal','broken');

UPDATE bookmarks SET inbox_at = CURRENT_TIMESTAMP WHERE id IN ('bm-14','bm-15');
UPDATE bookmarks SET archived_at = CURRENT_TIMESTAMP WHERE id = 'bm-11';

INSERT INTO tags (id, name) VALUES
  ('tag-1','daily'), ('tag-2','reference'), ('tag-3','longread'), ('tag-4','infra');

INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES
  ('bm-01','tag-1'), ('bm-01','tag-4'),
  ('bm-02','tag-2'), ('bm-02','tag-4'),
  ('bm-06','tag-3'), ('bm-06','tag-2'), ('bm-06','tag-1'),
  ('bm-13','tag-2'), ('bm-13','tag-3');

INSERT INTO workspaces (id, name, description, icon, position) VALUES
  ('ws-1','Morning triage','Inbox, calendar and the issue tracker before anything else.','sun',0),
  ('ws-2','Frontend build','Everything needed for a Web interface change.','browser',1),
  ('ws-3','Research','Longer reads and docs that stay open all day.','book',2);

INSERT INTO workspace_items (id, workspace_id, title, url, open_mode, position) VALUES
  ('wi-1','ws-1','Gmail','https://mail.google.com/','reuse',0),
  ('wi-2','ws-1','Calendar','https://calendar.google.com/','reuse',1),
  ('wi-3','ws-1','GitHub Issues','https://github.com/issues','new-tab',2),
  ('wi-4','ws-2','Vite','https://vite.dev/','reuse',0),
  ('wi-5','ws-2','Workers docs','https://developers.cloudflare.com/workers/','pinned',1),
  ('wi-6','ws-2','Figma','https://www.figma.com/','reuse',2),
  ('wi-7','ws-3','Hacker News','https://news.ycombinator.com/','reuse',0),
  ('wi-8','ws-3','MDN','https://developer.mozilla.org/en-US/','reuse',1);

INSERT INTO sessions (id, name, source_device) VALUES
  ('se-1','Friday afternoon research','MacBook Pro'),
  ('se-2','Weekend reading','iPad'),
  ('se-3','Browser crashed — 23 tabs','Work Windows laptop');

INSERT INTO session_items (id, session_id, title, url, pinned, position) VALUES
  ('si-1','se-1','Workers docs','https://developers.cloudflare.com/workers/',1,0),
  ('si-2','se-1','D1 migrations','https://developers.cloudflare.com/d1/',0,1),
  ('si-3','se-1','Vite plugin API','https://vite.dev/guide/api-plugin',0,2),
  ('si-4','se-2','The Grug Brained Developer','https://grugbrain.dev/',0,0),
  ('si-5','se-2','Lobsters thread on caching','https://lobste.rs/',0,1),
  ('si-6','se-3','A very long page title that keeps going and going and should ellipsize cleanly','https://example.com/long',0,0);

INSERT INTO smart_collections (id, name, filters_json, position) VALUES
  ('sc-1','Inbox review','{"match":"all","filters":[{"field":"inbox","operator":"is","value":"true"}]}',0),
  ('sc-2','Dev references','{"match":"any","filters":[{"field":"tag","operator":"is","value":"reference"}]}',1);
