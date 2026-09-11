# Dockmark roadmap

## V0 — foundation

- [x] npm-workspaces monorepo
- [x] React + Vite + Cloudflare Worker web app
- [x] WXT + React extension shell
- [x] shared core models
- [x] D1 initial schema
- [x] `HealthPolicy` including `local-only` and `ignore`
- [x] extension proof-of-concept: list and activate current-window tabs

## V1 — usable personal launcher

- [x] bookmark CRUD and categories
- [ ] drag/reorder bookmarks and categories
- [x] Netscape `bookmarks.html` import plus Dockmark/simple JSON import
- [x] JSON and browser-compatible HTML export
- [x] configurable search engines and bang shortcuts
- [x] Workspaces: create/edit/delete, bookmark/custom items, ordering and open-all
- [x] Sessions: cloud CRUD, URL-list capture, Web restore and pinned-state snapshots
- [x] command palette with keyboard navigation and executable results
- [ ] appearance/theme preferences
- [ ] local-first settings with D1 persistence

## V1.5 — health and metadata

- [ ] URL metadata fetch: title, description, canonical, favicon and OpenGraph
- [x] server-side public URL health checks with redirect revalidation and SSRF safeguards
- [ ] extension-only local URL health checks
- [ ] redirect review and one-click URL replacement
- [ ] bulk cleanup that excludes ignored/local/manual entries
- [x] health history storage and API

## V2 — browser bridge

- [ ] browser-native bookmark import and optional two-way mapping
- [x] save current browser window as a cloud Session
- [x] restore a Session from the extension with pinned state preserved
- [ ] make Workspace `reuse` focus an existing matching tab before opening a new one
- [ ] make Workspace `pinned` create/focus pinned tabs through the extension
- [ ] extension capability handshake with Web app
- [ ] Chromium first; Firefox validation next

## V3 — AI-assisted organization

- [ ] OpenAI-compatible provider configuration
- [ ] API keys stored locally by default
- [ ] classification, tags, title cleanup and descriptions as suggestions
- [ ] preview/diff/apply workflow for bulk AI edits
- [ ] never allow AI to override HealthPolicy safety exclusions
