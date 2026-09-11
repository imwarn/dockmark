# Dockmark architecture

Dockmark is a web-first personal launcher. The browser extension is an optional capability bridge, not the product's primary storage layer.

## Product boundaries

- **Web app**: bookmarks, categories, search engines, workspaces, saved sessions, appearance and cloud sync.
- **Extension**: current/open tabs, browser-native bookmarks, local-network health checks and tab reuse/activation.
- **Cloudflare**: Worker API + static SPA assets + D1 primary data store.
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

The first server-side health-check implementation must reject loopback, link-local, RFC1918/private ranges, IPv6 local ranges, unsafe redirects and non-HTTP(S) schemes to reduce SSRF risk.

## Command ranking

When the extension is available, Dockmark's command bar ranks sources in this order:

1. open tab
2. workspace
3. bookmark
4. navigation item
5. web search

Without the extension, `open tab` simply disappears and the rest of the command model stays identical.

## Storage

D1 is the system of record for structured user data. KV may be introduced later only for read-heavy derived caches or short-lived configuration snapshots. R2 is optional for large backup bundles or user-uploaded backgrounds.

## Extension bridge

The initial extension exposes a small internal message surface for reading current-window tabs and activating an existing tab. The future Web ↔ Extension bridge should use a narrow, versioned protocol and capability detection rather than assume every browser API exists.
