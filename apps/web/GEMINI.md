# apps/web/
> L2 | Parent: /GEMINI.md

Dockmark Web SPA (React 19 + Vite 8) and Cloudflare Worker API (`worker/`). Routes `/` to the read-only public page and `/app/*` to the authenticated workspace, launcher, triage views, and settings.

## Submodules
- `worker/` — Cloudflare Worker HTTP API layer and D1 data handlers (see `apps/web/worker/GEMINI.md`)
- `migrations/` — Ordered D1 SQL schema migrations for bookmarks, workspaces, sessions, auth, tags, inbox, smart collections, and change journal
- `public/` — Static SVG icon assets served by Vite and Cloudflare Workers

## Entry & Build Files
index.html: SPA HTML shell with pre-paint appearance and locale FOUC-prevention script
vite.config.ts: Vite + React + Cloudflare Worker dev/build configuration
package.json: `@dockmark/web` workspace scripts (`dev`, `build`, `typecheck`) and dependencies
tsconfig.json: TypeScript project configuration extending `tsconfig.base.json`

## `src/` — Shell, Launcher, Settings & Public UI
src/main.tsx: SPA bootstrapper applying local appearance/locale before paint, binding system listeners, syncing cloud settings, and mounting PrivateRoot or PublicPage
src/PrivateRoot.tsx: Session auth gate (`LoginCard`, `SetupRequired`) and sticky 46px private utility bar with inbox badge and 1-click theme/locale quick-toggles
src/App.tsx: Authenticated workspace shell with sticky 64px topbar, Raycast-style command bar (`!bang`, `@collection`, `#tag`, Pinyin initials, customizable `launcherShortcut`/`slashFocus`), keyboard-navigable results, and section router
src/LauncherDashboard.tsx: Command ranking (`buildLauncherResults`), keyboard-navigable `LauncherCommandPanel`, empty-query dashboard (open tabs, workspaces, filterable bookmarks), and `SafeFavicon`
src/PublicPage.tsx: Read-only Personal Navigation Station (`/`) loading `/api/settings/public-page` + `/api/public/bookmarks` with customizable site title/subtitle, ordered `★ Pinned Favorites` section, collapsible category headers persisted in visitor-local `dockmarkPublicCollapsedV1` (with Collapse/Expand all and search auto-expand), Pinyin search + web engine switcher, category nav pills, visitor-local 3-way layout (`grid`/`compact`/`list`), `usePublicI18n()`, and local theme toggle
src/SettingsPage.tsx: Client-side `/app/settings/*` router coordinating 5 tabs: Appearance & Language, Browser, AI Service, Security, and Public Page
src/AppearanceSettings.tsx: Theme (`System / Light / Dark`) and Language (`System / English / 简体中文`) selector cards synced via `PATCH /api/settings/appearance`
src/BrowserSettingsManager.tsx: Local-first and D1-synced New Tab launcher limits, default engine, launcher shortcut (`⌘K`/`⌘J`/`Alt+K` + `/` focus), and bookmark conflict policy settings
src/AiProviderSettingsPage.tsx: Dedicated `/app/settings/ai` panel with 6 OpenAI-compatible provider presets, D1-synced non-secret endpoint/model/timeout form (`saveCloudAiSettings`), `Default / Local` vs `Cloud synced` state badge, wrapped `DOCKMARK_AI_API_KEY` Worker secret status check, and Inbox/Organize quick links
src/SecuritySettings.tsx: One-time extension pairing code generator and active/revoked paired-device management
src/PublicPageSettings.tsx: Personal Navigation Station settings view orchestrating `PublicSiteConfigCard`, ordered `★ Pinned Favorites` curation (up to `MAX_PUBLIC_PINNED_BOOKMARKS = 24`), single and bulk bookmark publication, and canonical category/bookmark public ordering
src/PublicSiteConfigCard.tsx: Extracted top configuration card for `PublicPageSettings` editing public root (`/`) site title/subtitle, default layout, search bar, web search, category nav, and new-tab behavior
src/BrowserExtensionManager.tsx: Extension hub (`/app/extension`) with Chromium New Tab, Chromium Standard, and Firefox MV3 profiles, install guide, and live bridge diagnostics

## `src/` — Library, Workspace & Triage Managers
src/BookmarkManager.tsx: Tabbed Bookmarks hub coordinating Library, Organize, Health, and Change Journal views
src/BookmarkManagerLegacy.tsx: Category sidebar and bookmark CRUD/tagging/reordering library manager with `?q=` URL deep-link search and `×` clear button
src/BookmarkCategorySidebar.tsx: Left sidebar of BookmarkManagerLegacy handling category CRUD/reordering and tag filter chips
src/BookmarkFormFields.tsx: Shared bookmark form field grid (`BookmarkFields`) and localized `HealthBadge` extracted from BookmarkManagerLegacy
src/BookmarkFavicon.tsx: Shared HTTP/HTTPS favicon renderer with domain monogram fallback and `safeDomainLabel` helper
src/BookmarkMaintenance.tsx: URL reachability checks (server + local bridge), health policy overrides, metadata refresh, and archive management
src/LibraryBulkOrganizer.tsx: Bulk category/tag organizer and reviewed AI batch organization workflow
src/LibraryBulkMaintenance.tsx: Bulk archive, restore, and health-policy maintenance actions
src/AiOrganizationSettings.tsx: Cloud-hydrated AI provider status strip with 1-click `/app/settings/ai` link, collapsible inline override form, and locale-aware bookmark organization suggestions
src/ChangeJournal.tsx: Audit trail viewer for reversible library mutations
src/WorkspaceManager.tsx: Named Workspace CRUD, open-mode (`new_tab` / `reuse` / `pinned`) editor, and bridge/web launch actions
src/SessionManager.tsx: Saved tab-window Session CRUD, capture from live tabs, and pinned/standard restore
src/SearchEngineManager.tsx: Custom search engine and `!bang` keyword CRUD with default engine selection
src/TransferManager.tsx: HTML/JSON bookmark import/export workflow and native browser import hub
src/NativeBookmarkImport.tsx: Reviewed native browser bookmark import, mapping reconciliation, conflict review, and manual writeback
src/NativeBookmarkSyncPanels.tsx: Extracted mapping preview (`NativeMappingPreviewPanel`) and import tree (`NativeImportTreePanel`) views for NativeBookmarkImport
src/InboxPage.tsx: Capture Inbox triage view with cloud-hydrated AI provider status, `/app/settings/ai` quick link, metadata review, and filing/archiving actions
src/InboxReviewCard.tsx: Single-bookmark Inbox review card handling filing, AI triage selection, and opt-in metadata suggestions
src/SmartCollectionsPage.tsx: Saved dynamic filter collection builder, live preview, and bulk handoff
src/DuplicateReviewPage.tsx: Duplicate URL group review workbench with Pinyin search, segmented evidence filters, atomic-style tag/description merge + Keep & Archive execution, full Undo (restoring archived bookmark and reverting merged metadata), and Locate in Library handoff
src/DuplicateCandidateCard.tsx: Extracted duplicate pair comparison card (`computeDuplicateMerge`) displaying side-by-side URL diff highlighting, unique `#tag` chips, contextual merge preview toggle, and Keep/Archive actions

## `src/` — Client Data, Bridge, Theme & i18n Modules
src/i18n.ts: Web locale state (`dockmarkLocaleV1`, `dockmarkPublicLocaleV1`), cloud sync, `useI18n()`, and visitor-only `usePublicI18n()`
src/theme.ts: Local/cloud appearance (`dockmarkAppearanceV1`), theme-color/favicon updates, and `saveAppearanceAndLocale`
src/api.ts: Typed HTTP client for categories, bookmarks, workspaces, sessions, and search engines
src/auth-client.ts: Web session auth, pairing code creation, and paired-device revocation API client
src/browser-bridge.ts: `window.postMessage` Browser Bridge client for extension handshake, open tabs, workspace/session launch, and native bookmark permissions
src/extension-distribution.ts: Release version constant (`1.6.1`), download URLs, and semver comparison helper
src/public-settings-api.ts: Public Navigation Station settings client (`fetchPublicPageSettings`, `savePublicPageSettings`, `dockmarkPublicSiteConfigV1` cache, and visitor-local `dockmarkPublicLayoutV1` preference)
src/ai-organization.ts: AI status, cloud-synced `/api/settings/ai` (`fetchAiSettings`, `saveCloudAiSettings`), and locale-aware `/api/ai/organize` + `/api/ai/apply` client helpers
src/bookmark-details-api.ts: Composite bookmark + tag mutation API client
src/bookmark-search.ts: Tokenized bookmark, `#tag`, and Hanzi Pinyin initial client-side search predicates
src/bookmark-transfer.ts: Netscape HTML and Dockmark JSON bookmark parsers and serializers
src/change-journal-api.ts: Change journal listing API client
src/duplicate-review-api.ts: Duplicate group listing (`iconUrl`, `tags`, timestamps) and resolution API client
src/inbox-api.ts: Capture Inbox listing, count, filing, and `INBOX_CHANGED_EVENT` broadcaster
src/library-batch-api.ts: Bulk library category/tag batch API client
src/library-maintenance-api.ts: Archived bookmark listing and bulk maintenance API client
src/local-health-api.ts: Local-network health probe submission API client
src/native-bookmark-sync.ts: Native browser bookmark diff, mapping, and conflict normalization helpers
src/reorder-api.ts: Category and bookmark position reorder API client
src/smart-collection-match.ts: Client-side Smart Collection filter predicate and label formatter
src/smart-collections-api.ts: Smart Collection CRUD API client
src/tag-api.ts: Bookmark tag map and per-bookmark tag mutation API client

## `src/` — Global, Shell & Feature Stylesheets
src/styles.css: Base reset, launcher command bar, LauncherDashboard grid, compact management headers, and shared form/card primitives
src/theme.css: Dark (`#0a0f0c`) and light (`#f4f7f5`) semantic `--dm-*` design tokens plus Appearance & Language card styles
src/ui-polish.css: Outer-only `:focus-within` rings for composite search boxes (zero inner outline), custom SVG-chevron `<select>` styling, reusable `.dm-search-box`, and light-theme surface alignment
src/light-theme-consistency.css: Light-theme overrides for Extension, Transfer, Auth, and Public Page curation cards
src/responsive-shell.css: Sticky 46px utility bar, sticky 64px topbar (`top: 46px`), 128px sticky sidebar offset, and 900/720/520px responsive nav rules
src/settings.css: 5-tab Settings subnav, preference cards, overflow-safe AI provider/secret grid, segmented controls, and public pinning/curation layout styles
src/security.css: Private utility bar, quick theme/locale pills, auth screens, and paired-device list styles
src/extension.css: Extension hub hero, profile cards, installation guide, diagnostics, and compact launcher nudge strip
src/public-page.css: Personal Navigation Station topbar, visitor controls, Pinyin/web search bar, category nav pills, `★ Pinned Favorites` section, collapsible group headers, and `grid`/`compact`/`list` layouts
src/*.css (feature sheets): Scoped styles for `ai-organization`, `bookmark-tags`, `bridge`, `change-journal`, `duplicate-review`, `health`, `inbox`, `library-bulk`, `maintenance`, `reorder`, `search-engines`, `session`, `smart-collections`, `transfer`, and `workspaces`

[PROTOCOL]: Update this header on change, then check GEMINI.md
