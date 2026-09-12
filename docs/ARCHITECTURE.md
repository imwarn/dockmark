# Dockmark architecture

Dockmark is a web-first personal launcher. The browser extension is an optional capability bridge, not the product's primary storage layer.

## Product boundaries

- **Web app**: bookmarks, categories, search engines, workspaces, saved sessions, appearance and cloud sync.
- **Extension**: current/open tabs, browser-native bookmark import/mapping, local-network health checks and tab reuse/activation.
- **Cloudflare**: Worker API + static SPA assets + D1 primary data store.
- **Local-only extension data**: browser-native bookmark mappings, device preferences and future local health state stay in extension storage.
- **Local secrets**: AI API keys remain browser-local in v1 and are never written to D1.

## Why web-first

A saved Workspace or Session must be usable from Chrome, Edge, Firefox, Safari or a mobile browser without installing an extension in each browser. Only operations that require privileged browser APIs are extension-only.

## Core entities

- `Bookmark`: durable cloud link with metadata and a health policy.
- `Workspace`: reusable, curated group of links/tabs.
- `Session`: point-in-time browser window/tab snapshot.
- `HealthPolicy`: `normal`, `ignore`, `local-only`, or `manual`.
- `SearchEngine`: `%s`-style custom search target plus optional keyword.

## Health policy rules

`local-only` is inferred for common loopback/private-network hosts and must never be checked from the Cloudflare Worker. The extension may perform a local check when installed and explicitly allowed.

`ignore` never participates in scheduled checks, health scoring, bulk removal, or AI deletion suggestions.

`manual` is only checked when explicitly requested.

Server-side health checks reject loopback, link-local, RFC1918/private ranges, IPv6 local ranges, unsafe redirects and non-HTTP(S) schemes to reduce SSRF risk.

## Command ranking

When the extension is available, Dockmark's command bar ranks sources in this order:

1. open tab
2. workspace
3. session
4. bookmark
5. navigation item
6. web search

Without the extension, `open tab` simply disappears and the rest of the command model stays identical.

## Storage

D1 is the system of record for structured cloud user data. Browser-internal identifiers do not belong in D1. KV may be introduced later only for read-heavy derived caches or short-lived configuration snapshots. R2 is optional for large backup bundles or user-uploaded backgrounds.

### Native bookmark mapping

Browser-native bookmark import is intentionally asymmetric in the first implementation:

```text
Browser bookmark tree
        ↓ read only
review / de-dupe / category mapping
        ↓
Dockmark Bookmark in D1
        ↑
LocalBookmarkMapping in extension storage
```

`LocalBookmarkMapping` stores `browserBookmarkId`, `dockmarkBookmarkId`, URL and mapping time in `browser.storage.local`. Multiple native bookmark IDs may point to one Dockmark bookmark when URLs normalize to the same value. The extension prunes a mapping if the native bookmark disappears or its URL changes.

The current implementation never sends browser bookmark IDs to D1 and never mutates the native bookmark tree. Optional two-way sync requires a separate conflict model and explicit user controls before it can be introduced safely.

## Extension bridge

The Web ↔ Extension bridge uses a narrow versioned protocol with explicit capability flags. Privileged Web requests are accepted only from the Dockmark origin configured in extension-local storage. Host access to that origin is requested explicitly and the content script is registered dynamically.

Native bookmark support is exposed as a capability separately from permission state: an extension can advertise `nativeBookmarks: true` while reporting that the optional `bookmarks` permission has not yet been granted. This lets Web UI degrade safely without assuming privileged APIs are always available.
