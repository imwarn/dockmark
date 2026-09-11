# Dockmark

**A cloud-synced personal launcher for bookmarks, workspaces and browser tabs.**

Dockmark is web-first: bookmarks, reusable Workspaces, temporary Sessions and configurable search live in one self-hosted launcher that works across browsers. The optional browser extension adds privileged capabilities such as live open-tab search, switching to an existing tab, Workspace reuse/pinning and pinned Session restore.

> Status: active V1 development. The Web app, D1 data model, search/command palette and Chromium browser bridge are functional; packaging and browser validation are automated in CI.

## Deploy to Cloudflare

Dockmark is a **Cloudflare Worker with Static Assets + D1**, not a separate Pages frontend and API deployment.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/imwarn/dockmark)

The repository-root `wrangler.jsonc` is the canonical Worker/D1 input configuration. The Web app itself lives in `apps/web` and uses `@cloudflare/vite-plugin`; after `vite build`, Cloudflare creates a generated deployment config below `apps/web/.wrangler/`. Dockmark's root deploy adapter rewrites that redirect at the repository root before calling Wrangler so the user config and generated deploy config share the same base path.

> Keep Cloudflare's project root at `/`. Do **not** point a Deploy-to-Cloudflare URL or Workers Builds root directly at `apps/web`, because the Web workspace depends on the shared `packages/core` workspace.

### Deploy to Cloudflare button

The button uses the repository root so Cloudflare can see the root Wrangler resource declarations and provision D1. The root `deploy` script then builds only the Web workspace, prepares the Vite-generated deployment redirect, applies D1 migrations through the `DB` binding, and deploys the generated Worker/static-assets bundle.

Cloudflare currently documents limited monorepo support for Deploy Buttons. Dockmark therefore also runs a real `wrangler deploy --dry-run` in CI after every build; this specifically catches mismatches between the root Wrangler config and Vite's generated deploy config before changes reach `main`.

### Connect this existing GitHub repository

For the most predictable long-running deployment of your own Dockmark checkout:

1. In Cloudflare, create a D1 database named `dockmark`.
2. Put its database ID into the root `wrangler.jsonc` in place of the all-zero placeholder.
3. Go to **Workers & Pages → Create application → Import a repository** and select this repository.
4. Use repository root `/` as the Root directory.
5. Build command: `npm run build:web`
6. Deploy command: `npm run deploy:built`
7. Use `main` as the production branch.

`npm run deploy:built` performs three production steps: prepares the root Wrangler redirect from the Vite build output, applies remote D1 migrations, then runs `wrangler deploy` from the repository root.

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

Dockmark's optional extension is built with WXT + React and currently targets Chromium first.

### Load unpacked in Chromium

```bash
npm install
npm run build:extension
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select:

```text
apps/extension/.output/chrome-mv3
```

Open the Dockmark extension popup, enter your deployed Dockmark origin (for example a `workers.dev` URL or your custom domain), and choose **Connect**. The extension requests host permission only for the Dockmark origin you explicitly connect and dynamically registers the Web bridge there.

### Create an installable ZIP

```bash
npm run package:extension
```

WXT writes both the unpacked Chromium build and release ZIP under `apps/extension/.output/`; for example `apps/extension/.output/chrome-mv3` and `apps/extension/.output/dockmarkextension-0.1.0-chrome.zip`. CI copies the ZIP into a visible staging directory before uploading it as the `dockmark-chromium-extension` GitHub Actions artifact. Tags matching `v*` likewise stage the ZIP and create a GitHub Release containing the packaged extension.

### Chromium smoke test

CI runs a real headless Chromium instance with the unpacked Manifest V3 extension loaded. It verifies the service worker, versioned capability handshake, open-tab enumeration/activation and pinned Session restore.

To run the same smoke test locally:

```bash
npm install
npm run build:extension
npm install --no-save playwright@1.63.0
npx playwright install --with-deps --no-shell chromium
npm run smoke:chromium
```

The CI smoke test intentionally does **not** bypass Chromium's optional-host permission prompt. After deploying the Web app, do this one-minute live bridge check once:

1. Load the unpacked extension and connect it to the deployed Dockmark origin.
2. Open two ordinary HTTP/HTTPS tabs outside the Dockmark origin.
3. Open Dockmark and press `Ctrl+K` / `⌘K`; the tabs should appear above Workspaces.
4. Select an Open Tab result; Dockmark should focus the existing tab instead of duplicating it.
5. Open a Workspace containing a `reuse` item and a `pinned` item; the existing matching tab should be reused and the pinned item should become pinned.
6. Restore a Session containing a pinned tab; its pinned state should be preserved.

## Design principles

- Web app is the primary product; the extension is an optional capability bridge.
- Workspaces and Sessions are cloud-portable across browsers.
- Command priority is `Open Tabs > Workspace > Session > Bookmark > Navigation > Search` when the extension is connected.
- The Web/Extension bridge uses a versioned capability handshake so the two sides can evolve independently.
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
  extension/    optional browser bridge (WXT)
packages/
  core/         shared domain models, URL policy, search and command ranking
scripts/
  chromium-extension-smoke.mjs
  prepare-cloudflare-deploy.mjs
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
