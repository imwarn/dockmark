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

The API normalizes bare URLs. Public bare hosts default to HTTPS; local/private bare hosts default to HTTP. `localhost`, private IPv4 ranges and `.local` hosts are automatically assigned `healthPolicy: "local-only"` unless the caller explicitly chooses another policy.

Supported health policies:

- `normal` — eligible for server-side checks.
- `ignore` — excluded from automatic checks and bulk broken-link cleanup.
- `local-only` — excluded from server checks and cleanup; the optional extension may check it locally later.
- `manual` — checked only on explicit user action.

Changing a bookmark URL resets health status when appropriate. `ignore` and `local-only` map to `ignored` and `local-only` statuses respectively.

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
