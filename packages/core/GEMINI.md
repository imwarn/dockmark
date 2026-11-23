# packages/core/
> L2 | Parent: /GEMINI.md

Shared zero-dependency domain layer consumed by `@dockmark/web`, `apps/web/worker`, and `@dockmark/extension`.

## Member list
package.json: `@dockmark/core` workspace manifest exporting `./src/index.ts` and running `tsc -p tsconfig.json`
tsconfig.json: Package TypeScript config extending `../../tsconfig.base.json`
src/index.ts: Public barrel re-exporting models, settings, i18n, URL policy, bookmark URL normalization, command ranking, and search utilities
src/models.ts: Core entity types and CRUD input contracts (`Bookmark`, `Category`, `Workspace`, `Session`, `SearchEngine`, `HealthCheck`, `HealthPolicy`, `HealthStatus`, `CommandSource`, `CommandResult`)
src/settings.ts: `BrowserSettings` and `AppearanceSettings` (including `locale: LocalePreference`) schemas, version constants, defaults, normalizers, and merge helpers
src/i18n.ts: Shared `LocalePreference` (`"system" | "en" | "zh-CN"`), `ResolvedLocale`, `LOCALE_STORAGE_KEY`, locale normalization/resolution, `tx`, `formatRelativeTime`, and canonical `SOURCE_LABELS`, `HEALTH_STATUS_LABELS`, `HEALTH_POLICY_LABELS` dictionaries
src/url-policy.ts: Hostname/IPv4/IPv6 inspection (`inferHealthPolicy`) classifying localhost, private LAN, link-local, and non-HTTP URLs as `local-only`
src/bookmark-url.ts: Input URL normalization (`normalizeBookmarkUrl`) prepending `http://` for local bare hosts and `https://` for public hosts
src/command-rank.ts: Launcher source weights (`LAUNCHER_SOURCE_WEIGHT`), default labels, and `rankCommandResults` ordering
src/search.ts: Search engine keyword validation (`normalizeSearchKeyword`), `%s` template validation (`validateSearchTemplate`), and query URL builder

[PROTOCOL]: Update this header on change, then check GEMINI.md
