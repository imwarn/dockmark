# packages/core/
> L2 | Parent: /GEMINI.md

Shared zero-dependency domain layer consumed by `@dockmark/web`, `apps/web/worker`, and `@dockmark/extension`.

## Member list
package.json: `@dockmark/core` workspace manifest exporting `./src/index.ts` and running `tsc -p tsconfig.json`
tsconfig.json: Package TypeScript config extending `../../tsconfig.base.json`
src/index.ts: Public barrel re-exporting models, settings, i18n, URL policy, bookmark URL normalization, Pinyin initials, command ranking, and search utilities
src/models.ts: Core entity types and CRUD input contracts (`Bookmark`, `Category`, `Workspace`, `Session`, `SearchEngine`, `HealthCheck`, `HealthPolicy`, `HealthStatus`, `CommandSource`, `CommandResult`)
src/settings.ts: `BrowserSettings` (including `launcherShortcut` and `slashFocus`), `AppearanceSettings`, `PublicPageSettings` (including `pinnedBookmarkIds` and `MAX_PUBLIC_PINNED_BOOKMARKS`), and non-secret `AiSettings` schemas, version constants, defaults, normalizers, and merge helpers
src/i18n.ts: Shared `LocalePreference` (`"system" | "en" | "zh-CN"`), `ResolvedLocale`, `LOCALE_STORAGE_KEY`, locale normalization/resolution, `tx`, `formatRelativeTime`, and canonical `SOURCE_LABELS`, `HEALTH_STATUS_LABELS`, `HEALTH_POLICY_LABELS` dictionaries
src/url-policy.ts: Hostname/IPv4/IPv6 inspection (`inferHealthPolicy`) classifying localhost, private LAN, link-local, and non-HTTP URLs as `local-only`
src/bookmark-url.ts: Input URL normalization (`normalizeBookmarkUrl`) prepending `http://` for local bare hosts and `https://` for public hosts
src/pinyin.ts: Zero-dependency Hanzi Pinyin initial extractor (`pinyinInitials`, `pinyinStartsWith`, `textContainsTokenOrPinyin`) via `Intl.Collator("zh-CN-u-co-pinyin")` and polyphone/common-character overrides
src/command-rank.ts: Launcher source weights (`LAUNCHER_SOURCE_WEIGHT`), default labels, text/Pinyin scoring (`launcherTextScore`), and `rankCommands` ordering
src/search.ts: Search engine keyword validation (`normalizeSearchKeyword`), `%s` template validation (`validateSearchTemplate`), and query URL builder

[PROTOCOL]: Update this header on change, then check GEMINI.md
