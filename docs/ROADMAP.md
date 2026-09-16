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
- [x] drag/reorder bookmarks and categories
- [x] Netscape `bookmarks.html` import plus Dockmark/simple JSON import
- [x] JSON and browser-compatible HTML export
- [x] configurable search engines and bang shortcuts
- [x] Workspaces: create/edit/delete, bookmark/custom items, ordering and open-all
- [x] Sessions: cloud CRUD, URL-list capture, Web restore and pinned-state snapshots
- [x] command palette with keyboard navigation and executable results
- [x] appearance/theme preferences: System / Light / Dark with local-first startup and D1 persistence
- [x] local-first settings with D1 persistence
- [x] private Web sessions, extension device pairing and revocation
- [x] curated public homepage with explicit publish/unpublish controls
- [x] bookmark-library search across title, URL, description, category and tags, including `#tag` filters
- [x] first-class manual bookmark description/tag editing with tag browsing and per-tag counts

## V1.5 — health and metadata

- [x] URL metadata fetch: title, description, canonical, favicon and OpenGraph
- [x] metadata review gate: fetched values stay separate until explicitly applied
- [x] server-side public URL health checks with redirect revalidation and SSRF safeguards
- [x] extension-only local URL health checks with explicit per-host permission review
- [x] redirect review and one-click URL replacement
- [x] conservative bulk cleanup that excludes ignored/local/manual entries and transient/special statuses
- [x] health history storage, API and Settings review UI

## V2 — browser bridge

- [x] reviewed browser-native bookmark import with URL de-duplication and extension-local mapping
- [ ] optional two-way browser bookmark synchronization (intentionally deferred beyond v1.0: current model uses reviewed Browser→Dockmark plus explicit per-item Dockmark→Browser writeback; no silent background mutation)
- [x] save current browser window as a cloud Session
- [x] restore a Session from the extension with pinned state preserved
- [x] inject live open tabs into the Web Command Palette
- [x] make Workspace `reuse` focus an existing matching tab before opening a new one
- [x] make Workspace `pinned` create/reuse pinned tabs through the extension
- [x] versioned extension capability handshake with the configured Dockmark Web origin
- [x] dynamic content-script registration limited to the explicitly authorized Dockmark origin
- [x] Chromium Manifest V3 packaging (`wxt zip`)
- [x] real Playwright Chromium smoke test for MV3 worker, capabilities, optional permissions, tabs and pinned restore
- [x] CI artifact for installable Chromium ZIP
- [x] tag-driven GitHub Release packaging
- [x] deployed-origin manual bridge + native bookmark permission smoke check
- [x] Firefox Manifest V3 build/package validation in CI
- [x] Firefox release ZIP + reproducible sources ZIP packaging
- [x] Firefox deployed-origin runtime validation (`docs/FIREFOX_VALIDATION.md`)
- [x] New Tab local snapshot search across bookmark title, URL, description, category and `#tag` terms
- [x] one-click New Tab local snapshot reset that leaves cloud data, pairing, browser settings and bookmark mappings untouched; test-phase caches are reseeded rather than migrated
- [x] dedicated transparent New Tab `D·` favicon with light/dark browser-chrome adaptation
- [ ] signed Firefox distribution / AMO channel after runtime validation

## Deployment

- [x] canonical root Wrangler configuration
- [x] Cloudflare Worker + Static Assets + D1 single-unit deployment
- [x] Deploy to Cloudflare README button
- [x] documented existing-GitHub-repository Workers Builds setup
- [x] D1 migrations included in the deploy path
- [x] CI Wrangler deploy dry-run using Vite's generated deployment config

## V3 — AI-assisted organization

- [x] OpenAI-compatible Chat Completions endpoint/model configuration in the Web UI
- [x] API key stored as the self-hosted `DOCKMARK_AI_API_KEY` Worker secret; never persisted to browser localStorage or D1
- [x] Worker-side provider proxy with public-HTTPS endpoint validation, same-origin redirect review, timeout and response-size limits
- [x] configurable provider timeout stored browser-locally, default 90 seconds with Worker-enforced 15–180 second bounds
- [x] classification into existing categories, tags, title cleanup and descriptions as suggestions
- [x] preview/diff/apply workflow for reviewed bulk AI edits (20 bookmarks/request)
- [x] session-local generation queue with Pending / Generated / All filters, generated markers and automatic next-batch selection
- [x] reviewed AI apply uses one session-only API request and one atomic D1 batch instead of per-bookmark bookmark/tag round trips
- [x] never allow AI to override URL or HealthPolicy safety exclusions; only `normal` bookmarks enter the provider request/write surface
- [x] preserve tags in Dockmark JSON export/import
- [x] richer tag browsing/search surfaces outside the AI review workflow
- [ ] optional provider adapters for Responses-style APIs, custom authentication or other non-Chat-Completions protocols

## V4 — capture and smart library

- [x] paired extension Quick Capture: save the active HTTP/HTTPS tab directly into Dockmark Inbox
- [x] exact-URL duplicate review before insertion; duplicate capture never creates a second bookmark
- [x] Inbox as a system review state rather than a synthetic category
- [x] Web Inbox filing flow: keep uncategorized or move to an existing category, then clear Inbox state explicitly
- [x] paired device scope remains append-only for Quick Capture; it cannot edit/delete existing Dockmark bookmarks
- [x] reviewed multi-tab capture from current-window tabs: read-only preflight, explicit selection, final duplicate recheck, then append selected new URLs to Inbox
- [x] optional metadata suggestion refresh for newly captured public URLs: title, description, canonical URL and favicon remain separate until individually selected during Inbox review; local-only stays server-disabled
- [x] saved filters / Smart Collections built from category, tags, domain, health and Inbox state, persisted in D1 as non-mutating live views
- [x] Smart Collections are first-class Web Launcher results with live match counts/filter context and deep links into the selected collection
- [x] New Tab caches Smart Collection definitions plus Inbox membership after paired refresh and supports offline collection search + local `@Collection` browsing
- [x] reviewed Inbox AI triage: select up to 20 `normal` captures, generate title/description/category/tag suggestions, review whole rows, then apply + clear Inbox in the same atomic D1 batch; metadata URL/favicon review stays separate
- [x] explicit tag validation: over-limit tags fail before mutation instead of being silently truncated or dropped
- [x] manual bookmark create/edit commits bookmark fields and tags in one atomic D1 batch
- [x] Quick Capture normalizes concurrent URL races back to duplicate review, and reviewed multi-tab inserts commit transactionally rather than partially
- [x] bookmark search uses the same whitespace token-AND / `#tag` semantics across Library, Web Launcher and local-first New Tab
- [x] bookmark add/edit keeps tag and duplicate-URL validation beside the affected field, shows saving state locally, and reserves the page-level banner for non-field/system errors
- [x] private navigation surfaces a lightweight live Inbox waiting count that refreshes after reviewed filing and when the Web app regains focus after extension capture
- [x] V4 closeout complete: Capture → Inbox → metadata/AI review → filing → Smart Collections is review-gated, duplicate-safe, locally searchable, and visibly actionable without silent bookmark mutation

## V5 — power library workflows

- [x] reviewed multi-select Library organization for up to 50 bookmarks: search candidates, select explicitly, preview category/tag changes, then apply atomically
- [x] category moves append selected bookmarks deterministically at the destination while preserving reviewed selection order
- [x] bulk tag add/remove validates the final per-bookmark 12-tag limit before any mutation; overlap and over-limit reviews fail closed
- [x] bulk organization remains Web-session-only and never changes title, URL, description, HealthPolicy, browser mappings or health history
- [x] Smart Collection → reviewed bulk workflow handoff without duplicating the Collection filter manually; saved live matches become the scoped bulk candidate set and up to 50 are preselected for review
- [ ] duplicate-review workspace for near duplicates / canonical-equivalent URLs; recommendations only, never silent merge/delete
- [ ] reviewed bulk maintenance actions for health policy and explicit archive/delete workflows with clear destructive confirmation
- [ ] change journal for high-impact bulk operations with enough before/after context to support safe manual recovery
- [ ] reassess optional reviewed two-way browser synchronization only after Library bulk/recovery semantics are stable
