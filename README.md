# Dockmark

**A cloud-synced personal launcher for bookmarks, workspaces and browser tabs.**

Dockmark is web-first: bookmarks, reusable Workspaces, temporary Sessions and configurable search live in one self-hosted launcher that works across browsers. The optional browser extension adds privileged capabilities such as live open-tab search, switching to an existing tab, Workspace reuse/pinning and pinned Session restore.

> Status: active V1 development. The Web app, D1 data model, search/command palette and Chromium browser bridge are functional; packaging and browser validation are automated in CI.

## Deploy to Cloudflare

Dockmark is a **Cloudflare Worker with Static Assets + D1**, not a separate Pages frontend and API deployment.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/imwarn/dockmark)

The repository root contains the canonical `wrangler.jsonc`. Cloudflare's Deploy to Cloudflare flow can clone the repository, provision the D1 database, bind it to the Worker and configure Workers Builds. Dockmark's deploy script applies D1 migrations before deployment.

### Connect this existing GitHub repository

If you are deploying your own checkout rather than creating a copy through the button:

1. In Cloudflare, create a D1 database named `dockmark`.
2. Put its database ID into the root `wrangler.jsonc` in place of the all-zero placeholder.
3. Go to **Workers & Pages → Create application → Import a repository** and select this repository.
4. Use repository root `/` as the root directory.
5. Build command: `npm run build:web`
6. Deploy command: `npm run db:migrate:remote && npm run deploy:built -w @dockmark/web`
7. Use `main` as the production branch.

Workers Git integration will then build/deploy pushes automatically. Pull requests can use Workers preview/version workflows separately if desired.

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

`npm run deploy` builds the React/Worker application, applies remote D1 migrations, and deploys the Worker/static assets as one unit.

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

The unpacked Chromium build stays under `apps/extension/.output/chrome-mv3`, while WXT writes the install/release ZIP to the repository-root `.output/` directory (for example `.output/dockmarkextension-0.1.0-chrome.zip`). Every CI run also uploads that ZIP as the `dockmark-chromium-extension` GitHub Actions artifact. Tags matching `v*` create a GitHub Release containing the packaged extension.

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
docs/
  ARCHITECTURE.md
  API.md
  ROADMAP.md
wrangler.jsonc  canonical Worker + D1 deployment configuration
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
