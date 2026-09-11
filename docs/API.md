# Dockmark API (V0)

The Web app talks to a same-origin Cloudflare Worker under `/api`. The API is intentionally small while Dockmark is single-user/self-hosted.

## Categories

- `GET /api/categories`
- `POST /api/categories` — `{ name, icon?, position? }`
- `GET /api/categories/:id`
- `PATCH /api/categories/:id` — `{ name?, icon?, position? }`
- `DELETE /api/categories/:id`

Deleting a category does **not** delete its bookmarks. D1's foreign key rule moves those bookmarks to the uncategorized state.

## Bookmarks

- `GET /api/bookmarks`
- `GET /api/bookmarks?categoryId=:id`
- `POST /api/bookmarks`
- `GET /api/bookmarks/:id`
- `PATCH /api/bookmarks/:id`
- `DELETE /api/bookmarks/:id`

Create example:

```json
{
  "title": "Local app",
  "url": "localhost:3000",
  "categoryId": null
}
```

The API normalizes bare URLs. Public bare hosts default to HTTPS; local/private bare hosts default to HTTP. Local hostnames, private/special IP ranges and local network suffixes are automatically assigned `healthPolicy: "local-only"` unless the caller explicitly chooses another policy.

Supported health policies:

- `normal` — eligible for server-side checks.
- `ignore` — excluded from automatic checks and bulk broken-link cleanup.
- `local-only` — excluded from server checks and cleanup; the optional extension may check it locally later.
- `manual` — excluded from bulk checks but may be checked through an explicit single-bookmark action.

Changing a bookmark URL resets health status when appropriate. `ignore` and `local-only` map to `ignored` and `local-only` statuses respectively.

## Health checks

- `POST /api/bookmarks/:id/check` — explicitly check one `normal` or `manual` bookmark.
- `GET /api/bookmarks/:id/health` — return up to 20 most recent check records.

Server checks use a short timeout, do not automatically follow redirects, and revalidate every redirect target before requesting it. Local/private targets and redirects are rejected. `ignore` and `local-only` bookmarks cannot be checked by the server.

A check records status, HTTP status when available, final URL, elapsed milliseconds, optional error code and timestamp in D1. The bookmark's current `health_status` is updated from the latest result.

## Workspaces

A Workspace is a cloud-stored reusable set of URLs. Items can either reference an existing Dockmark bookmark or exist only inside the Workspace.

- `GET /api/workspaces` — list workspaces with their ordered items.
- `POST /api/workspaces` — `{ name, description?, icon?, position? }`
- `GET /api/workspaces/:id`
- `PATCH /api/workspaces/:id` — `{ name?, description?, icon?, position? }`
- `DELETE /api/workspaces/:id`
- `GET /api/workspaces/:id/items`
- `POST /api/workspaces/:id/items`
- `PATCH /api/workspaces/:id/items/:itemId`
- `DELETE /api/workspaces/:id/items/:itemId`

Add an existing bookmark:

```json
{
  "bookmarkId": "bookmark-id",
  "openMode": "reuse"
}
```

Add a Workspace-only URL:

```json
{
  "title": "Local dashboard",
  "url": "localhost:3000",
  "openMode": "reuse"
}
```

Supported open modes:

- `reuse` — Web mode opens the URL normally; the browser extension will later focus a matching existing tab when possible.
- `new-tab` — always request a new tab.
- `pinned` — Web mode still opens a normal tab; the browser extension will later apply pinned-tab behavior.

Workspace item URLs use the same normalization and local/private URL policy as bookmarks. Deleting a Workspace deletes its Workspace items. Deleting a referenced bookmark does not delete the Workspace item; the stored title/URL remain usable because `bookmark_id` is set to null by D1.

## Errors

Errors use a stable envelope:

```json
{
  "error": {
    "code": "bookmark_exists",
    "message": "This URL is already bookmarked."
  }
}
```

Expected status codes include `400`, `404`, `405`, `409`, and `500`.
