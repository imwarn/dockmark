# apps/extension/
> L2 | Parent: ../../GEMINI.md

Member list
package.json: Extension workspace package manifest (`@dockmark/extension` v1.6.0), WXT build/zip scripts for Chrome, New Tab variant, and Firefox MV3.
wxt.config.ts: WXT MV3 manifest generator for Chrome and Firefox; sets `default_locale: "en"`, localized `__MSG_*__` descriptions, optional `bookmarks`/host permissions, `Alt+Shift+D` command, and `d` omnibox keyword.
tsconfig.json: TypeScript compiler configuration extending `.wxt/tsconfig.json`.
entrypoints/background.ts: MV3 service worker handling Web bridge registration, tab activation, Workspace/Session restore, native bookmark sync/writeback, and local health dispatch.
entrypoints/popup/index.html: HTML shell for the 384px extension popup workbench.
entrypoints/popup/main.tsx: State-aware React 19 popup workbench with header status pill, setup wizard / 3-tab daily segmented views (Capture + searchable Open Tabs, Multi-Tab, Sessions), and settings drawer toggle.
entrypoints/popup/api.ts: Popup domain types, storage keys, URL/monogram helpers, Bearer-authenticated `requestJson`, and best-effort remote appearance/locale sync.
entrypoints/popup/OpenTabsPanel.tsx: Real-time filterable Open Tabs list with host monograms, `Current`/`Switch` pills, and keyboard navigation across all open tabs.
entrypoints/popup/SessionsPanel.tsx: Sessions tab view for saving the current window as a cloud Session and restoring recent cloud Sessions.
entrypoints/popup/SetupWizard.tsx: Two-step onboarding card for connecting the Dockmark server origin and exchanging a one-time pairing code.
entrypoints/popup/SettingsDrawer.tsx: Collapsible settings view housing Theme/Language segmented controls, server reconnect, device unpair, and optional native bookmarks toggle.
entrypoints/popup/ReviewedCapture.tsx: Multi-tab capture review panel with normalized URL dedup summary (`New`/`Existing`/`Repeated`), batch selection, and Inbox save.
entrypoints/popup/style.css: Compact dark/light forest-sage styling for the 384px popup workbench.
entrypoints/local-health-permission/index.html: HTML shell for the single-host local health permission prompt.
entrypoints/local-health-permission/main.ts: Scoped local/private hostname permission prompt with light/dark theme detection and EN/zh-CN localization.
entrypoints/local-health-permission/style.css: Dark/light forest-sage styling for the local health permission page.
lib/ext-locale.ts: Shared extension theme (`dockmarkAppearanceV1`) and locale (`dockmarkLocaleV1`) persistence, DOM application, and `browser.storage.local` reactive sync built on `@dockmark/core`.
lib/local-health.ts: Local/private bookmark HTTP probe runner that gates host checks behind single-hostname `optional_host_permissions`.
lib/launcher-access.ts: Global `Alt+Shift+D` launcher opener and `d + Space` omnibox search over cached local snapshots.
public/dockmark-bridge.js: Content script bridging trusted Dockmark Web pages to `background.ts` via `window.postMessage`.
public/_locales/en/messages.json: English MV3 manifest localization catalog (`extDescription`, `cmdOpenLauncher`, `newtabDescription`).
public/_locales/zh_CN/messages.json: Simplified Chinese MV3 manifest localization catalog (`extDescription`, `cmdOpenLauncher`, `newtabDescription`).
public/newtab.html: Local-first New Tab launcher page with compact topbar, Spotlight command bar, syntax hints, filterable Bookmarks panel, and Workspaces panel.
public/newtab.css: Compact dark/light forest-sage styling for the New Tab launcher, domain monograms, filter pills, and workspace mode indicators.
public/newtab-theme.js: Head-loaded theme bootstrapper synchronizing `dockmarkAppearanceV1` across `localStorage` and `chrome.storage.local`.
public/newtab-i18n.js: Head-loaded EN/zh-CN localization runtime (`window.dockmarkI18n`) synchronizing `dockmarkLocaleV1` and translating static/dynamic New Tab copy.
public/newtab-auth.js: Fetch wrapper injecting `Authorization: Bearer` for paired `/api/*` requests and routing `#manage` clicks to `/app`.
public/newtab.js: Core New Tab launcher state, snapshot rendering, Category/`@Collection` filter pills, theme/locale quick toggles, and command execution.
public/newtab-library-cache.js: Single-pass cloud refresh override caching bookmarks, tags, Smart Collections, Inbox IDs, Sessions, appearance, and locale atomically.
public/newtab-search.js: Local-first `#tag` filtering, Smart Collection search, and `@Collection` browsing layer over `buildResults`.
public/newtab-ux.js: Bare `!` bang suggestions, Session search/restore, Shift/Ctrl+Enter open modifiers, `/` focus shortcut, and launcher focus messaging.
public/newtab-parity.js: Canonical Web Launcher result ranking, eight-result cap with default Search slot, localized result-kind badges, and Escape-to-blur.
public/newtab-icon.svg: Adaptive light/dark `D·` SVG favicon for extension pages.
public/icons/: Packaged PNG extension icons (`dockmark-16.png`, `dockmark-32.png`, `dockmark-48.png`, `dockmark-128.png`).

[PROTOCOL]: Update this header on change, then check GEMINI.md
