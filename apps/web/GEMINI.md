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
src/App.tsx: Authenticated workspace shell with sticky 64px topbar, Raycast-style command bar (`!bang`, `@collection`, `#tag`), keyboard-navigable results, and section router
src/LauncherDashboard.tsx: Command ranking (`buildLauncherResults`), keyboard-navigable `LauncherCommandPanel`, empty-query dashboard (open tabs, workspaces, filterable bookmarks), and `SafeFavicon`
src/PublicPage.tsx: Read-only curated public directory (`/`) using visitor-local `usePublicI18n()` and local theme toggle without mutating owner D1
src/SettingsPage.tsx: Client-side `/app/settings/*` router coordinating Appearance & Language, Browser, Security, and Public Page panels
src/AppearanceSettings.tsx: Theme (`System / Light / Dark`) and Language (`System / English / 简体中文`) selector cards synced via `PATCH /api/settings/appearance`
src/BrowserSettingsManager.tsx: Local-first and D1-synced New Tab launcher limits, default engine, and bookmark conflict policy settings
src/SecuritySettings.tsx: One-time extension pairing code generator and active/revoked paired-device management
src/PublicPageSettings.tsx: Single and bulk bookmark publication manager plus canonical category/bookmark public ordering
src/BrowserExtensionManager.tsx: Extension hub (`/app/extension`) with Chromium New Tab, Chromium Standard, and Firefox MV3 profiles, install guide, and live bridge diagnostics

## `src/` — Library, Workspace & Triage Managers
src/BookmarkManager.tsx: Tabbed Bookmarks hub coordinating Library, Organize, Health, and Change Journal views
src/BookmarkManagerLegacy.tsx: Category sidebar and bookmark CRUD/tagging/reordering library manager
src/BookmarkMaintenance.tsx: URL reachability checks (server + local bridge), health policy overrides, metadata refresh, and archive management
src/LibraryBulkOrganizer.tsx: Bulk category/tag organizer and reviewed AI batch organization workflow
src/LibraryBulkMaintenance.tsx: Bulk archive, restore, and health-policy maintenance actions
src/AiOrganizationSettings.tsx: AI provider status inspection and locale-aware bookmark organization suggestions
src/ChangeJournal.tsx: Audit trail viewer for reversible library mutations
src/WorkspaceManager.tsx: Named Workspace CRUD, open-mode (`new_tab` / `reuse` / `pinned`) editor, and bridge/web launch actions
src/SessionManager.tsx: Saved tab-window Session CRUD, capture from live tabs, and pinned/standard restore
src/SearchEngineManager.tsx: Custom search engine and `!bang` keyword CRUD with default engine selection
src/TransferManager.tsx: HTML/JSON bookmark import/export workflow and native browser import hub
src/NativeBookmarkImport.tsx: Reviewed native browser bookmark import, mapping reconciliation, conflict review, and manual writeback
src/InboxPage.tsx: Capture Inbox triage view with AI/metadata review and filing/archiving actions
src/SmartCollectionsPage.tsx: Saved dynamic filter collection builder, live preview, and bulk handoff
src/DuplicateReviewPage.tsx: Duplicate URL group detector and reviewed merge/archive workflow

## `src/` — Client Data, Bridge, Theme & i18n Modules
src/i18n.ts: Web locale state (`dockmarkLocaleV1`, `dockmarkPublicLocaleV1`), cloud sync, `useI18n()`, and visitor-only `usePublicI18n()`
src/theme.ts: Local/cloud appearance (`dockmarkAppearanceV1`), theme-color/favicon updates, and `saveAppearanceAndLocale`
src/api.ts: Typed HTTP client for categories, bookmarks, workspaces, sessions, and search engines
src/auth-client.ts: Web session auth, pairing code creation, and paired-device revocation API client
src/browser-bridge.ts: `window.postMessage` Browser Bridge client for extension handshake, open tabs, workspace/session launch, and native bookmark permissions
src/extension-distribution.ts: Release version constant (`1.6.0`), download URLs, and semver comparison helper
src/ai-organization.ts: AI status and locale-aware `/api/ai/organize` + `/api/ai/apply` client helpers
src/bookmark-details-api.ts: Composite bookmark + tag mutation API client
src/bookmark-search.ts: Tokenized bookmark and `#tag` client-side search predicates
src/bookmark-transfer.ts: Netscape HTML and Dockmark JSON bookmark parsers and serializers
src/change-journal-api.ts: Change journal listing API client
src/duplicate-review-api.ts: Duplicate group listing and resolution API client
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
src/ui-polish.css: Unified focus rings, form control states, hover/selection tokens, and light-theme surface alignment
src/light-theme-consistency.css: Light-theme overrides for Extension, Transfer, Auth, and Public Page curation cards
src/responsive-shell.css: Sticky 46px utility bar, sticky 64px topbar (`top: 46px`), 128px sticky sidebar offset, and 900/720/520px responsive nav rules
src/settings.css: Settings subnav, preference cards, segmented controls, and public curation layout styles
src/security.css: Private utility bar, quick theme/locale pills, auth screens, and paired-device list styles
src/extension.css: Extension hub hero, profile cards, installation guide, diagnostics, and compact launcher nudge strip
src/public-page.css: Curated public page topbar, visitor controls, compact hero, and responsive card grid
src/*.css (feature sheets): Scoped styles for `ai-organization`, `bookmark-tags`, `bridge`, `change-journal`, `duplicate-review`, `health`, `inbox`, `library-bulk`, `maintenance`, `reorder`, `search-engines`, `session`, `smart-collections`, `transfer`, and `workspaces`

[PROTOCOL]: Update this header on change, then check GEMINI.md
