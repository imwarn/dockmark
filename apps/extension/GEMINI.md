# apps/extension/
> L2 | Parent: ../../GEMINI.md

Member list
package.json: Extension workspace package manifest (`@dockmark/extension` v1.6.1), WXT build/zip scripts for Chrome, New Tab variant, and Firefox MV3.
wxt.config.ts: WXT MV3 manifest generator for Chrome and Firefox; sets version `1.6.1`, `default_locale: "en"`, localized `__MSG_*__` descriptions, optional `bookmarks`/host permissions, `Alt+Shift+D` command, and `d` omnibox keyword.
tsconfig.json: TypeScript compiler configuration extending `.wxt/tsconfig.json`.
entrypoints/background.ts: MV3 service worker handling Web bridge registration, tab activation, Workspace/Session restore, native bookmark sync/writeback, and local health dispatch.
entrypoints/newtab-app.ts: WXT unlisted script bundle (`newtab-app.js`) wiring New Tab state, keyboard shortcuts (`launcherShortcut`, `slashFocus`), storage/tab listeners, and Playwright smoke hooks without adding `chrome_url_overrides` to the Standard manifest.
entrypoints/popup/index.html: HTML shell for the 384px extension popup workbench.
entrypoints/popup/main.tsx: State-aware React 19 popup workbench with header status pill, setup wizard / 3-tab daily segmented views (Capture + searchable Open Tabs, Multi-Tab, Sessions), and settings drawer toggle.
entrypoints/popup/api.ts: Popup domain types, storage keys, URL/monogram helpers, Bearer-authenticated `requestJson`, and best-effort remote appearance/locale sync.
entrypoints/popup/OpenTabsPanel.tsx: Real-time filterable Open Tabs list with Pinyin initial search (`@dockmark/core`), outer-only focus search box with `×` clear button, host monograms, `Current`/`Switch` pills, and keyboard navigation.
entrypoints/popup/SessionsPanel.tsx: Sessions tab view for saving the current window as a cloud Session and restoring recent cloud Sessions.
entrypoints/popup/SetupWizard.tsx: Two-step onboarding card for connecting the Dockmark server origin and exchanging a one-time pairing code.
entrypoints/popup/SettingsDrawer.tsx: Collapsible settings view housing Theme/Language segmented controls, browser shortcut guide (`Alt+Shift+D` / Omnibox `d` + `chrome://extensions/shortcuts` link), server reconnect, device unpair, and optional native bookmarks toggle.
entrypoints/popup/ReviewedCapture.tsx: Multi-tab capture review panel with normalized URL dedup summary (`New`/`Existing`/`Repeated`), batch selection, and Inbox save.
entrypoints/popup/style.css: Compact dark/light forest-sage styling for the 384px popup workbench, composite tab search input, and shortcut guide chips.
entrypoints/local-health-permission/index.html: HTML shell for the single-host local health permission prompt.
entrypoints/local-health-permission/main.ts: Scoped local/private hostname permission prompt with light/dark theme detection and EN/zh-CN localization.
entrypoints/local-health-permission/style.css: Dark/light forest-sage styling for the local health permission page.
lib/ext-locale.ts: Shared extension theme (`dockmarkAppearanceV1`) and locale (`dockmarkLocaleV1`) persistence, DOM application, and `browser.storage.local` reactive sync built on `@dockmark/core`.
lib/local-health.ts: Local/private bookmark HTTP probe runner that gates host checks behind single-hostname `optional_host_permissions`.
lib/launcher-access.ts: Global `Alt+Shift+D` launcher opener and `d + Space` omnibox search over cached local snapshots.
lib/newtab/types.ts: New Tab storage constants, snapshot/result/DOM/state contracts, and pure URL/tag/monogram helpers.
lib/newtab/i18n.ts: Bilingual EN/zh-CN New Tab copy catalog, `window.dockmarkI18n` / `DOCKMARK_NEWTAB_I18N` runtime, and `browser.storage.onChanged` locale sync built on `@dockmark/core`.
lib/newtab/state.ts: Shared reactive New Tab state container, DOM element resolver, and `Object.defineProperties` global bridge preserving Playwright smoke hooks.
lib/newtab/search.ts: Unified local-first command search engine supporting Pinyin initials (`@dockmark/core`), `#tag` filters, `@Collection` browsing, `!` bang shortcuts, Sessions, Workspaces, Open Tabs, and canonical 8-result Web Launcher ranking.
lib/newtab/render.ts: DOM renderers for connection/offline status, topbar controls, search clear button, Category/`@Collection` filter pills, bookmark/workspace cards, and command results.
lib/newtab/sync.ts: Bearer-authenticated API transport, single-pass cloud snapshot hydration, open-tab loading, Workspace/Session restore, and local snapshot clearing.
public/dockmark-bridge.js: Content script bridging trusted Dockmark Web pages to `background.ts` via `window.postMessage`.
public/_locales/en/messages.json: English MV3 manifest localization catalog (`extDescription`, `cmdOpenLauncher`, `newtabDescription`).
public/_locales/zh_CN/messages.json: Simplified Chinese MV3 manifest localization catalog (`extDescription`, `cmdOpenLauncher`, `newtabDescription`).
public/newtab.html: Local-first New Tab launcher shell loading `newtab-theme.js` in `<head>` and WXT-compiled `newtab-app.js` at the end of `<body>`, with composite command bar, `×` clear button, syntax hints, filterable Bookmarks, and Workspaces.
public/newtab.css: Compact dark/light forest-sage styling for the New Tab launcher, outer-focus composite command bar, domain monograms, filter pills, and workspace mode indicators.
public/newtab-theme.js: Head-loaded zero-FOUC theme and locale attribute bootstrapper synchronizing `dockmarkAppearanceV1` across `localStorage` and `chrome.storage.local`.
public/newtab-icon.svg: Adaptive light/dark `D·` SVG favicon for extension pages.
public/icons/: Packaged PNG extension icons (`dockmark-16.png`, `dockmark-32.png`, `dockmark-48.png`, `dockmark-128.png`).

[PROTOCOL]: Update this header on change, then check GEMINI.md
