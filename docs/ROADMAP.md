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
- [ ] configurable search engines and bang shortcuts
- [ ] Workspaces: create/edit/open-all
- [ ] Sessions: save/import/open from the web
- [ ] command palette with keyboard navigation
- [ ] appearance/theme preferences
- [ ] local-first settings with D1 persistence

## V1.5 — health and metadata

- [ ] URL metadata fetch: title, description, canonical, favicon and OpenGraph
- [ ] server-side public URL health checks with SSRF protection
- [ ] extension-only local URL health checks
- [ ] redirect review and one-click URL replacement
- [ ] bulk cleanup that excludes ignored/local/manual entries
- [ ] health history and last-check timestamps

## V2 — browser bridge

- [ ] browser-native bookmark import and optional two-way mapping
- [ ] save current window as Session
- [ ] reuse existing matching tab before opening a new one
- [ ] extension capability handshake with Web app
- [ ] Chromium first; Firefox validation next

## V3 — AI-assisted organization

- [ ] OpenAI-compatible provider configuration
- [ ] API keys stored locally by default
- [ ] classification, tags, title cleanup and descriptions as suggestions
- [ ] preview/diff/apply workflow for bulk AI edits
- [ ] never allow AI to override HealthPolicy safety exclusions
