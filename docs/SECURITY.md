# Dockmark security model

Dockmark separates its public launcher surface from private management and browser-device access.

## Surfaces

- `/` is the public page. It reads only `GET /api/public/bookmarks`, which contains bookmarks explicitly published by the owner.
- `/app` is the private management workspace. It requires a valid Web session.
- `/app/settings` contains Security, Browser/New Tab policy and Public Page curation.
- All other private `/api/*` routes require either a Web session or a paired extension token with an allowed device scope.
- `/api/health` remains public for deployment monitoring.

Private APIs fail closed when Dockmark security is not configured.

## Required Worker secret

Production must define:

```text
DOCKMARK_ADMIN_PASSWORD
```

The value must contain at least 12 characters. Use a long unique random password or passphrase. Do not put it in `wrangler.jsonc`, Git, browser localStorage, D1 or an extension.

Cloudflare Dashboard:

1. Open **Workers & Pages → dockmark → Settings → Variables and Secrets**.
2. Add `DOCKMARK_ADMIN_PASSWORD` as a **Secret**.
3. Save it before deploying the security foundation release.

CLI alternative:

```bash
npx wrangler secret put DOCKMARK_ADMIN_PASSWORD
```

If the secret is missing or shorter than 12 characters, `/app` shows a security setup screen and private APIs return `503 security_not_configured`. Public curated bookmarks remain readable.

## Web sessions

`POST /api/auth/login` accepts the admin password from the same Dockmark origin. Successful login generates an opaque random session token.

- The browser receives the token only in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- D1 stores only the SHA-256 hash of that token.
- Sessions expire after 30 days.
- Logout deletes the server-side session and clears the cookie.
- State-changing Web requests require the request `Origin` to match the Dockmark origin.
- Failed logins are rate-limited by a hashed client identity window.

The admin password itself is never persisted by Dockmark.

## Extension pairing

An extension never receives or stores the admin password.

1. Sign in to `/app`.
2. Open **Settings → Security**.
3. Choose **Create pairing code**.
4. Enter the one-time code in the Dockmark extension popup.
5. The extension exchanges it for a random per-device bearer token.

Pairing codes expire after 10 minutes and can be consumed once. D1 stores only the SHA-256 hash of the resulting device token. The plaintext device token exists only in that extension profile's `chrome.storage.local`.

Each extension can be revoked independently from **Settings → Security → Paired devices**. Revoking a device invalidates future private cloud requests without affecting the Web session or other paired devices.

## Device token scope

A paired device token is deliberately weaker than a Web admin session. It can read the data required by the local launcher and can create cloud Sessions. It cannot use its bearer token to:

- create, update or delete Dockmark bookmarks/categories;
- change Browser/New Tab settings;
- publish or unpublish public bookmarks;
- manage pairing codes or devices;
- perform other private administrative writes.

Browser-native bookmark writeback remains an explicit Browser Bridge action initiated from the authenticated Web Review UI. It is not authorized by the cloud device token and is never a background action.

## Public page

Publishing is opt-in per bookmark. The public endpoint is backed by the separate `public_bookmarks` table and returns only selected bookmark fields plus category presentation metadata.

Public visitors do not receive private bookmark rows, Sessions, Workspaces, Browser settings, device information or native bookmark mappings.

## New Tab behavior

Dockmark New Tab v0.7+ uses the paired device token for private cloud refreshes. The launcher remains local-first:

- the last-known-good snapshot renders before the network;
- an authenticated cloud refresh updates the snapshot;
- an invalid/revoked token or unavailable network leaves the cached launcher usable;
- browser-local Open Tabs and navigation actions continue to work without cloud access.

## Secret and token handling

Never commit `DOCKMARK_ADMIN_PASSWORD`, Web session tokens, device tokens or one-time pairing codes to the repository. Do not put them in issue/PR text or logs.

If a device token may have leaked, revoke that device. If the admin password may have leaked, rotate the Worker secret and sign out active Web sessions; a future hardening release may add a one-click global session revoke/secret-rotation workflow.
