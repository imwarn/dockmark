# Dockmark

**A cloud-synced personal launcher for bookmarks, workspaces and browser tabs.**

Dockmark is web-first: bookmarks, reusable Workspaces, temporary Sessions and configurable search live in one self-hosted launcher that works across browsers. The optional Chromium extension adds privileged capabilities such as live open-tab search, switching to an existing tab, Workspace reuse/pinning, pinned Session restore, reviewed browser-native bookmark synchronization and explicitly authorized local/private URL health checks. Users can choose a Standard profile or an opt-in Dockmark New Tab profile with a local-first offline-capable launcher.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/brand/dockmark-mark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./docs/brand/dockmark-mark-light.svg">
    <img src="./docs/brand/dockmark-mark-dark.svg" width="96" height="96" alt="Dockmark D dot brand mark">
  </picture>
</p>

<p align="center"><strong>D·</strong> — the minimal Dockmark mark used from favicon scale through the Web UI.</p>

The Web app resolves the favicon dynamically so it follows the active System / Light / Dark appearance. The static SVG above documents the canonical mark: dark mode uses the `#0a0f0c` Dockmark surface with the soft green mark, while light mode uses the paired `#f4f7f5` surface with dark green ink.

> Status: **v0.9.0** — reviewed page metadata, server-side public URL health checks, redirect review, conservative cleanup, persisted health history and extension-only local/private URL checks with explicit per-host permission are implemented. Browser sync remains review-gated: no silent background bookmark mutation.

## Deploy to Cloudflare

Dockmark is a **Cloudflare Worker with Static Assets + D1**, not a separate Pages frontend and API deployment.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/imwarn/dockmark)

The repository-root `wrangler.jsonc` is the canonical Worker/D1 input configuration. The Web app itself lives in `apps/web` and uses `@cloudflare/vite-plugin`; after `vite build`, Cloudflare creates a generated deployment config below `apps/web/.wrangler/`. Dockmark's root deploy adapter rewrites that redirect at the repository root before calling Wrangler so the user config and generated deploy config share the same base path.

> Keep Cloudflare's project root at `/`. Do **not** point a Deploy-to-Cloudflare URL or Workers Builds root directly at `apps/web`, because the Web workspace depends on the shared `packages/core` workspace.

### Deploy to Cloudflare button

The button uses the repository root so Cloudflare can see the root Wrangler resource declarations and provision D1. The root `deploy` script then builds only the Web workspace, prepares the Vite-generated deployment redirect, applies D1 migrations through the `DB` binding, and deploys the generated Worker/static-assets bundle.

Cloudflare currently documents limited monorepo support for Deploy Buttons. Dockmark therefore also runs a real `wrangler deploy --dry-run` in CI after every build; this specifically catches mismatches between the root Wrangler config and Vite's generated deploy config before changes reach `main`.

### Connect this existing GitHub repository

For a long-running deployment of your own Dockmark checkout, connect the repository root `/` to Cloudflare Workers Builds and use `main` as the production branch. Dockmark detects the Workers Builds environment, prepares the Vite deployment redirect and resolves the account-local D1 database named `dockmark` before Cloudflare runs its platform-managed deploy/version-upload step. Production builds also apply pending D1 migrations before deployment.

### Deploy from the CLI

Requirements: Node.js 22+ and a Cloudflare account.

```bash
npm install
npx wrangler login
npx wrangler d1 create dockmark
```

Copy the returned D1 database ID into the root `wrangler.jsonc`, then:

```bash
npm run deploy
```

`npm run deploy` builds the Web application, prepares Cloudflare's generated deployment config, applies remote D1 migrations, and deploys the Worker/static assets as one unit.

## Browser extension

Dockmark's optional extension is built with WXT + React and currently targets Chromium first. Dockmark Web has an **Extension** page with install/profile selection, live handshake diagnostics, protocol/version information, capability flags, native-bookmark permission state and Browser/New Tab settings.

### Choose one browser profile

Dockmark ships two Chromium packages from the same codebase. They are alternatives: install **one**, not both.

```text
Dockmark New Tab                 Recommended
- Complete Browser Bridge
- Reviewed bookmark sync/writeback
- Local/private URL health checks with explicit per-host permission
- Local-first Dockmark launcher on every new tab
- Last-known-good offline cache

dockmark-newtab-chrome-v<version>.zip

Standard Dockmark Extension
- Complete Browser Bridge
- Reviewed bookmark sync/writeback
- Local/private URL health checks with explicit per-host permission
- Keeps the browser's existing New Tab page unchanged

dockmark-chrome-v<version>.zip
```

The New Tab package uses Chromium's static `chrome_url_overrides.newtab` manifest capability. The Standard package is explicitly validated in CI to contain no New Tab override.

### Local health checks

Dockmark's Worker never fetches bookmarks classified as `local-only`. When you explicitly choose **Check locally** in Settings → Metadata & Health, the browser extension performs the probe from your browser instead.

The extension does not receive local-host access at install time. If a check needs access, Dockmark opens a dedicated permission-review page and asks Chromium for the exact hostname pattern required for that bookmark. Redirects are followed only while the next target remains local/private; a local → public redirect is surfaced for review rather than used to broaden browser permissions. Browser-originated results are stored in the same health history but labeled separately from server checks.

### Local-first Dockmark New Tab

The New Tab profile does **not** redirect each new tab to the deployed Workers URL. `newtab.html`, its CSS and launcher logic live inside the extension and render immediately. The page reads a small `dockmarkNewTabCacheV1` snapshot from `chrome.storage.local`, then refreshes cloud data asynchronously when the configured Dockmark origin is reachable.

The cached snapshot contains the data needed for launcher use: bookmarks, categories, Workspaces and search engines. Open tabs are read live from the browser. Offline or on a poor connection, the last-known-good snapshot remains searchable and launchable; cloud-only management stays in the Web app.

Local New Tab capabilities include:

- cached bookmark search/open
- cached Workspace launch with `reuse`, `new-tab` and `pinned` behavior
- live open-tab search and activation
- cached custom/default search engines and bang/keyword search
- explicit online/offline/cache-age status
- background refresh without blocking first paint

If the profile has never completed one online refresh, the extension still shows a local setup shell and explains how to connect Dockmark; it never falls back to a browser network error page.

### Browser and New Tab settings

Dockmark v0.6+ adds a local-first settings layer shared by the Web management UI and the New Tab launcher. The **Extension** page exposes the settings; edits are saved to Web `localStorage` immediately, and **Sync settings** persists the current policy to D1 through `/api/settings/browser`.

The New Tab profile keeps its own last-known-good settings copy in `chrome.storage.local`, so startup behavior does not depend on the network. A successful cloud refresh updates both the launcher data snapshot and the settings snapshot.

Current settings include:

- bookmark conflict preference: `Ask every time`, `Prefer Browser` or `Prefer Dockmark`
- New Tab default search engine
- whether Open Tabs appear in New Tab search results
- bookmark-card and Workspace-card display limits
- automatic background refresh on New Tab startup

The conflict preference is a **policy foundation**, not permission for silent writes. Browser ↔ Dockmark conflicts still use the reviewed/manual resolution flow; Dockmark does not automatically mutate browser bookmarks because a preference is selected.

When **Background refresh** is disabled, opening a New Tab performs no automatic Dockmark cloud fetch. Cached data and live browser-tab capabilities remain available locally, while the explicit `↻` refresh action can still contact the configured Dockmark origin on demand.
