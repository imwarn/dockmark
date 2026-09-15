# Dockmark

**A cloud-synced personal launcher for bookmarks, workspaces and browser tabs.**

Dockmark is web-first: bookmarks, reusable Workspaces, temporary Sessions and configurable search live in one self-hosted launcher that works across browsers. The optional Chromium extension adds privileged capabilities such as live open-tab search, switching to an existing tab, Workspace reuse/pinning, pinned Session restore and reviewed browser-native bookmark synchronization. Users can choose a Standard profile or an opt-in Dockmark New Tab profile with a local-first offline-capable launcher.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/brand/dockmark-mark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./docs/brand/dockmark-mark-light.svg">
    <img src="./docs/brand/dockmark-mark-dark.svg" width="96" height="96" alt="Dockmark D dot brand mark">
  </picture>
</p>

<p align="center"><strong>D·</strong> — the minimal Dockmark mark used from favicon scale through the Web UI.</p>

The Web app resolves the favicon dynamically so it follows the active System / Light / Dark appearance. The static SVG above documents the canonical mark: dark mode uses the `#0a0f0c` Dockmark surface with the soft green mark, while light mode uses the paired `#f4f7f5` surface with dark green ink.

> Status: **v0.8.0** — persisted bookmark/category reordering, System / Light / Dark appearance, curated public page, secure extension pairing and local-first browser settings are implemented. Metadata and Health improvements are the next active milestone.

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
- Local-first Dockmark launcher on every new tab
- Last-known-good offline cache

dockmark-newtab-chrome-v<version>.zip

Standard Dockmark Extension
- Complete Browser Bridge
- Reviewed bookmark sync/writeback
- Keeps the browser's existing New Tab page unchanged

dockmark-chrome-v<version>.zip
```

The New Tab package uses Chromium's static `chrome_url_overrides.newtab` manifest capability. The Standard package is explicitly validated in CI to contain no New Tab override.

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

**Clear cache** removes only the local New Tab data snapshot. It does not remove the configured Dockmark origin, Browser/New Tab settings, native-bookmark mappings or granted browser permissions.

### Distribution channels

Dockmark keeps manual installation as a permanent distribution channel. During Early Access it is the primary path; after Chrome Web Store listings become public, store install actions can become primary while manual downloads remain visible for users who cannot or prefer not to access the Web Store.

The Web **Extension** page presents both profiles as one Dockmark product choice. A user chooses either Standard or Dockmark New Tab and installs only that profile.

### Manual install in Chromium

1. Download either `dockmark-newtab-chrome-v<version>.zip` or `dockmark-chrome-v<version>.zip` from the Dockmark Extension page/GitHub Release and unzip it.
2. Open `chrome://extensions` (or the equivalent page in your Chromium browser).
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the extracted Dockmark folder containing `manifest.json`.
5. Open the Dockmark extension popup, enter your deployed Dockmark origin, and choose **Connect**.
6. If you need browser bookmark import/sync/writeback, separately choose **Enable bookmark access**.

The extension requests host permission only for the Dockmark origin you explicitly connect and dynamically registers the Web bridge there.

When switching an existing unpacked installation between Standard and New Tab profiles, replace the files in the **same extension folder** and click **Reload** in `chrome://extensions`. Keeping the same unpacked path preserves the extension ID, local mappings, configured origin and local New Tab cache. Do not load both profiles side-by-side.

For local development, build the unpacked Standard extension directly:

```bash
npm install
npm run build:extension
```

Then load:

```text
apps/extension/.output/chrome-mv3
```

### Native browser bookmark sync

Native bookmark access is optional; Chromium's `bookmarks` permission is not requested at install time.

1. Open the extension popup and choose **Enable bookmark access** under **Native bookmarks**.
2. Open Dockmark Web and go to **Transfer**.
3. Choose **Read browser bookmarks**.
4. Review imports and Browser ↔ Dockmark mappings.
5. Resolve incremental changes explicitly with Safe Apply or Review actions.

Dockmark keeps `browserBookmarkId ↔ dockmarkBookmarkId` mappings only in extension local storage. Browser-internal bookmark IDs are not uploaded to D1.

Browser → Dockmark changes can be previewed and safely applied. Conflict Review supports **Use Browser**, **Keep Dockmark**, **Re-link** and **Unlink**. Dockmark → Browser writeback is deliberately narrower: the user must explicitly click **Write Dockmark → Browser** for one mapped item, and only the mapped browser bookmark's title/URL are updated. Dockmark does not background-write, create, delete or move native browser bookmarks.

### Create installable ZIPs

Standard profile:

```bash
npm run package:extension
```

New Tab profile:

```bash
npm run package:extension:newtab
```

WXT writes the unpacked Standard Chromium build under `apps/extension/.output/chrome-mv3`. The New Tab packaging step clones that build to `apps/extension/.output/chrome-mv3-newtab`, adds only the static New Tab manifest override and packages the local launcher assets. Release archives are normalized to:

```text
apps/extension/.output/dockmark-chrome-v<version>.zip
apps/extension/.output/dockmark-newtab-chrome-v<version>.zip
```

CI uploads both ZIPs as Actions artifacts, and the versioned Extension Release workflow publishes both assets to the matching GitHub Release.

### Chromium smoke tests

CI runs real headless Chromium instances for both profiles.

The Standard smoke verifies the MV3 service worker, versioned capability handshake, optional native-bookmark permission semantics, open-tab enumeration/activation, pinned Session restore and—critically—that the Standard manifest does **not** override New Tab.

The New Tab smoke loads the packaged New Tab variant, seeds a last-known-good snapshot while giving it no Dockmark host permission/network access, then verifies that cached bookmarks, Workspaces and search-engine commands still render and search locally. It also verifies local settings behavior including card limits, Open Tabs visibility, default-search override, manual-refresh mode and cache clearing, and confirms the New Tab manifest override is isolated to that opt-in profile.

To run both locally:

```bash
npm install
npm run build:extension
npm install --no-save playwright@1.63.0
npx playwright install --with-deps --no-shell chromium
npm run smoke:chromium
npm run package:extension:newtab
npm run smoke:chromium:newtab
```

After deploying the Web app, a useful live bridge check is:

1. Load one Dockmark profile and connect it to the deployed Dockmark origin.
2. Open two ordinary HTTP/HTTPS tabs outside the Dockmark origin.
3. Open Dockmark and press `Ctrl+K` / `⌘K`; the tabs should appear above Workspaces.
4. Select an Open Tab result; Dockmark should focus the existing tab instead of duplicating it.
5. Open a Workspace containing a `reuse` item and a `pinned` item; the existing matching tab should be reused and the pinned item should become pinned.
6. Restore a Session containing a pinned tab; its pinned state should be preserved.
7. Enable **Native bookmarks**, map a small reviewed subset and exercise Browser → Dockmark and explicit Dockmark → Browser Review actions.
8. With the New Tab profile, open a new tab online once to seed/refresh the local snapshot, then disconnect the network and confirm cached search/launch remains available.
9. Change Browser/New Tab settings in the Web Extension page, sync them, and verify the New Tab profile follows the selected limits/search/refresh policy after its next successful settings refresh.

## Design principles

- Web app is the primary management product; the extension is an optional capability bridge/launcher.
- Users choose exactly one Chromium profile: Standard or Dockmark New Tab.
- The New Tab profile is local-first and uses cloud refresh as an enhancement, not a startup dependency.
- Workspaces and Sessions are cloud-portable across browsers.
- Command priority is `Open Tabs > Workspace > Session > Bookmark > Navigation > Search` when the extension is connected.
- The Web/Extension bridge uses a versioned capability handshake so the two sides can evolve independently.
- Browser-native bookmark access is optional and reviewed; native IDs/mappings stay local to the extension.
- Browser bookmark writes are explicit per-item actions, never background mutations.
- Manual extension download remains available even after browser-store distribution channels are added.
- Local/private URLs are never health-checked from Cloudflare.
- `ignore` and `local-only` entries are excluded from bulk broken-link deletion.
- AI changes are suggestions with preview/diff/apply, never silent mutations.
- AI API keys stay local in v1.

## Stack

- Web: React + Vite + Cloudflare Workers Static Assets
- Data: Cloudflare D1
- Extension: WXT + React, Manifest V3
- Browser E2E: Playwright Chromium
- Shared code: TypeScript workspace package

## Repository layout

```text
apps/
  web/          React SPA + Cloudflare Worker + D1 migrations
  extension/    optional browser bridge + local-first New Tab variant (WXT)
packages/
  core/         shared domain models, URL policy, search and command ranking
scripts/
  chromium-extension-smoke.mjs
  chromium-newtab-smoke.mjs
  package-newtab-extension.mjs
  prepare-cloudflare-deploy.mjs
  prepare-workers-build.mjs
  rename-extension-package.mjs
docs/
  ARCHITECTURE.md
  API.md
  ROADMAP.md
wrangler.jsonc  canonical Worker + D1 input configuration
```

## Local development

Requirements: Node.js 22+.

```bash
npm install
npm run db:migrate:local
npm run dev
```

Extension development:

```bash
npm run dev:extension
```

## Pull request and merge workflow

Dockmark intentionally keeps a human merge gate even when CI is fully green. GitHub Auto-merge is not enabled by default for normal feature PRs.

The normal flow is:

1. Implement work on a feature/fix/docs branch and open a PR against `main`.
2. Wait for the required CI jobs to complete successfully. This includes Web typecheck/build/Cloudflare validation and, for browser-affecting changes, the real Chromium smoke/package jobs.
3. Review the final diff and CI result after the latest commit has passed.
4. Manually choose **Squash and merge**.
5. Let the resulting `main` push drive downstream automation: Cloudflare Workers Builds handles production deployment, and an extension version change can trigger the matching GitHub Release/package workflow.

A green CI run means the PR is eligible to merge; it does **not** mean GitHub will merge it automatically. Keeping the explicit Squash-and-merge step gives the project one final checkpoint for behavior, release scope and deployment intent.

Direct feature commits to `main` should be avoided under normal development; reserve direct fixes for exceptional recovery/revert situations.

## D1 setup

Local D1 migrations:

```bash
npm run db:migrate:local
```

For a manual remote deployment, create D1 once, place the returned database ID in the root `wrangler.jsonc`, then run:

```bash
npm run db:migrate:remote
```

## License

No open-source license has been granted yet. This repository currently uses the default copyright protections. Third-party dependencies retain their own licenses.

Dockmark is being implemented independently. Other navigation/bookmark products may inform product requirements and interaction ideas, but source code from repositories without an explicit license should not be copied into this project.
