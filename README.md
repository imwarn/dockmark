# Dockmark

**A cloud-synced personal launcher for bookmarks, workspaces and browser tabs.**

Dockmark is web-first: your bookmarks, reusable workspaces and saved tab sessions live in one self-hosted launcher that works across browsers. An optional browser extension adds privileged capabilities such as detecting open tabs, switching to an existing tab, reading native bookmarks and checking local-only URLs.

> Status: early foundation / V0.

## Design principles

- Web app is the primary product; the extension is an optional bridge.
- Workspaces and Sessions are cloud-portable across browsers.
- Open tabs rank above bookmarks when the extension is available.
- Local/private URLs are never health-checked from Cloudflare.
- `ignore` and `local-only` entries are excluded from bulk broken-link deletion.
- AI changes are suggestions with preview/diff/apply, never silent mutations.
- AI API keys stay local in v1.

## Stack

- Web: React + Vite + Cloudflare Workers
- Data: Cloudflare D1
- Extension: WXT + React
- Shared code: TypeScript workspace package

## Repository layout

```text
apps/
  web/          React SPA + Cloudflare Worker + D1 migrations
  extension/    optional browser bridge (WXT)
packages/
  core/         shared domain models, URL policy and command ranking
docs/
  ARCHITECTURE.md
  ROADMAP.md
```

## Local development

Requirements: Node.js 22+.

```bash
npm install
npm run dev
```

Extension development:

```bash
npm run dev:extension
```

## D1 setup

Create the database once:

```bash
npx wrangler d1 create dockmark
```

Replace the placeholder `database_id` in `apps/web/wrangler.jsonc` with the returned ID, then apply migrations:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

## License

No open-source license has been granted yet. This repository currently uses the default copyright protections. Third-party dependencies retain their own licenses.

Dockmark is being implemented independently. Other navigation/bookmark products may inform product requirements and interaction ideas, but source code from repositories without an explicit license should not be copied into this project.
