# Firefox validation

Dockmark v1.0 introduces a **Firefox Standard MV3 preview**. Chromium remains the fully automated runtime-smoke target; Firefox is built and package-validated in CI, then validated manually in a real Firefox session before the Firefox roadmap item is considered complete.

## Build and package

From the repository root:

```bash
npm install
npm run build:extension:firefox
npm run package:extension:firefox
```

Expected artifacts:

- `apps/extension/.output/dockmark-firefox-v<version>.zip`
- `apps/extension/.output/dockmark-firefox-sources-v<version>.zip`

The Firefox build is explicitly **Manifest V3**. Dockmark depends on the `scripting` API for dynamic content-script registration, so the Firefox package does not fall back to WXT's default Firefox MV2 target.

## Temporary installation

The GitHub Firefox ZIP is currently an **unsigned validation build**. It is not presented as a permanent Firefox installation channel yet.

1. Unzip `dockmark-firefox-v<version>.zip`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…**.
4. Select the extracted `manifest.json`.
5. Open the Dockmark extension popup and configure the deployed Dockmark origin.
6. Grant access only to that Dockmark origin when prompted.

Firefox removes temporary add-ons on browser restart. Signed AMO/self-distribution is a later distribution step and should not be implied by the GitHub ZIP.

## Manual runtime checklist

Use a deployed Dockmark instance and verify the following in order.

### 1. Bridge handshake

- Extension page reports **Connected**.
- Extension version matches the Web release version.
- Bridge protocol is compatible.
- Open tabs, Workspace reuse/pinning, Sessions, native bookmarks, writeback and local health all report as available capabilities.

### 2. Origin-scoped bridge permission

- Before configuration, the extension does not have access to arbitrary websites.
- Configuring Dockmark requests access only to the selected Dockmark origin.
- Reloading the Dockmark page restores the bridge without requesting broader site access.

### 3. Optional native bookmark permission

- Native bookmark access is **not granted at install time**.
- Choosing **Enable bookmark access** in the popup grants the separate `bookmarks` permission.
- Transfer → Browser bookmarks can read the Firefox bookmark tree after permission is granted.

### 4. Reviewed Browser → Dockmark sync

Create or select a disposable Firefox bookmark and import/map it.

- Change the Firefox bookmark title or URL.
- Refresh Transfer.
- Mapping state changes to `BROWSER CHANGED` rather than silently mutating Dockmark.
- **Apply safe changes** updates Dockmark only after explicit review.
- Deleting the Firefox bookmark unlinks the mapping without deleting the Dockmark bookmark.

### 5. Explicit Dockmark → Browser writeback

- Edit a mapped Dockmark bookmark.
- The mapping enters a review/divergence state.
- **Write Dockmark → Browser** updates only the mapped Firefox bookmark title/URL after the explicit action.
- No browser bookmark is created, moved or deleted in the background.

### 6. Tabs, Workspaces and Sessions

- Open-tab search returns normal HTTP(S) tabs and excludes the Dockmark app itself.
- Activating an existing tab focuses the correct Firefox window/tab.
- Workspace `reuse` focuses an existing matching tab before creating a duplicate.
- Workspace `pinned` preserves/creates pinned state.
- Session restore opens the expected URLs and preserves pinned items.

### 7. Local/private health permission

Use a reachable local URL such as `http://localhost:3000`.

- **Check locally** opens the dedicated extension permission page.
- Permission is requested for the exact local hostname only.
- After approval, the result is recorded with **Browser** as the health source.
- A local → public redirect is surfaced for review and does not broaden extension permissions to the public host.

## Completion gate

Firefox runtime validation is considered complete only when the checklist above passes on a real Firefox build. CI success alone means **package-compatible**, not **runtime-validated**.
