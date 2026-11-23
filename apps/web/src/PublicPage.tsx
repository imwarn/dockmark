/**
 * [INPUT]: depends on AppearancePreference, PublicPageLayout, PublicPageSettings from @dockmark/core; textMatchesQuery from ./bookmark-search; usePublicI18n from ./i18n; hostLabel, SafeFavicon, safeHttpUrl from ./LauncherDashboard; public settings API/cache helpers from ./public-settings-api; theme helpers from ./theme; and ./public-page.css
 * [OUTPUT]: exports PublicPage Personal Navigation Station with custom branding, Pinyin-aware filter & web search engines, category jump pills, and visitor-local 3-mode layout switcher
 * [POS]: Public root route (/) rendered by main.tsx for visitors. Reads /api/public/bookmarks and /api/settings/public-page in parallel and never mutates owner D1 preferences.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AppearancePreference, PublicPageLayout, PublicPageSettings } from "@dockmark/core";
import { textMatchesQuery } from "./bookmark-search";
import { usePublicI18n } from "./i18n";
import { hostLabel, SafeFavicon, safeHttpUrl } from "./LauncherDashboard";
import {
  fetchPublicPageSettings,
  PUBLIC_SITE_CONFIG_EVENT,
  PUBLIC_SITE_CONFIG_STORAGE_KEY,
  readLocalPublicPageSettings,
  readVisitorPublicLayout,
  writeVisitorPublicLayout,
} from "./public-settings-api";
import { APPEARANCE_STORAGE_KEY, applyAppearance, localAppearance } from "./theme";
import "./public-page.css";

type PublicBookmark = {
  id: string;
  title: string;
  url: string;
  description?: string;
  iconUrl?: string;
  category: { id: string; name: string; icon?: string } | null;
  position: number;
  publishedAt: string;
};

type SearchEngineMode = "filter" | "google" | "bing" | "github" | "ddg" | "baidu";

interface WebSearchEngineOption {
  id: Exclude<SearchEngineMode, "filter">;
  labelEn: string;
  labelZh: string;
  buildUrl: (query: string) => string;
}

const WEB_SEARCH_ENGINES: WebSearchEngineOption[] = [
  { id: "google", labelEn: "Google", labelZh: "Google", buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: "bing", labelEn: "Bing", labelZh: "Bing", buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
  { id: "github", labelEn: "GitHub", labelZh: "GitHub", buildUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}` },
  { id: "ddg", labelEn: "DuckDuckGo", labelZh: "DuckDuckGo", buildUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { id: "baidu", labelEn: "Baidu", labelZh: "百度", buildUrl: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}` },
];

const THEME_CYCLE: AppearancePreference[] = ["system", "light", "dark"];

export function PublicPage() {
  const { isZh, tx, setLocalePreference } = usePublicI18n();
  const [appearance, setAppearance] = useState<AppearancePreference>(() => localAppearance());
  const [siteSettings, setSiteSettings] = useState<PublicPageSettings>(() => readLocalPublicPageSettings());
  const [visitorLayout, setVisitorLayout] = useState<PublicPageLayout | null>(() => readVisitorPublicLayout());
  const [bookmarks, setBookmarks] = useState<PublicBookmark[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchEngineMode>("filter");
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const effectiveLayout: PublicPageLayout = visitorLayout ?? siteSettings.defaultLayout;
  const activeWebEngine = useMemo(
    () => WEB_SEARCH_ENGINES.find((engine) => engine.id === searchMode) ?? null,
    [searchMode],
  );

  useEffect(() => {
    const previousTitle = document.title;
    if (siteSettings.siteTitle.trim()) {
      document.title = siteSettings.siteTitle.trim();
    } else {
      document.title = "Dockmark";
    }
    return () => {
      document.title = previousTitle;
    };
  }, [siteSettings.siteTitle]);

  useEffect(() => {
    if (!siteSettings.showWebSearch && searchMode !== "filter") {
      setSearchMode("filter");
    }
  }, [searchMode, siteSettings.showWebSearch]);

  useEffect(() => {
    const syncAppearance = () => setAppearance(localAppearance());
    const onAppearance = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: AppearancePreference }>).detail;
      setAppearance(detail?.preference ?? localAppearance());
    };
    const onSiteConfig = (event: Event) => {
      const detail = (event as CustomEvent<PublicPageSettings | undefined>).detail;
      if (detail) setSiteSettings(detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) syncAppearance();
      if (event.key === PUBLIC_SITE_CONFIG_STORAGE_KEY) setSiteSettings(readLocalPublicPageSettings());
    };
    window.addEventListener("dockmark:appearance", onAppearance);
    window.addEventListener(PUBLIC_SITE_CONFIG_EVENT, onSiteConfig);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("dockmark:appearance", onAppearance);
      window.removeEventListener(PUBLIC_SITE_CONFIG_EVENT, onSiteConfig);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!siteSettings.showSearchBar) return;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [siteSettings.showSearchBar]);

  useEffect(() => {
    let cancelled = false;
    const loadBookmarks = fetch("/api/public/bookmarks", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          bookmarks?: PublicBookmark[];
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(payload.error?.message ?? `Public page request failed (${response.status}).`);
        return Array.isArray(payload.bookmarks) ? payload.bookmarks : [];
      });

    const loadSettings = fetchPublicPageSettings().catch(() => null);

    void Promise.all([loadBookmarks, loadSettings])
      .then(([items, remoteSettings]) => {
        if (cancelled) return;
        setBookmarks(items);
        if (remoteSettings) setSiteSettings(remoteSettings);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : tx("Could not load public bookmarks.", "无法加载公开书签。"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tx]);

  const categories = useMemo(() => {
    const map = new Map<string, { key: string; name: string; icon?: string; count: number }>();
    for (const bookmark of bookmarks) {
      const key = bookmark.category?.id ?? "uncategorized";
      const current = map.get(key) ?? {
        key,
        name: bookmark.category?.name ?? tx("Uncategorized", "未分类"),
        ...(bookmark.category?.icon ? { icon: bookmark.category.icon } : {}),
        count: 0,
      };
      current.count += 1;
      map.set(key, current);
    }
    return Array.from(map.values());
  }, [bookmarks, tx]);

  useEffect(() => {
    if (selectedCategoryKey !== "all" && !categories.some((category) => category.key === selectedCategoryKey)) {
      setSelectedCategoryKey("all");
    }
  }, [categories, selectedCategoryKey]);

  const filtered = useMemo(() => {
    const byCategory = selectedCategoryKey === "all"
      ? bookmarks
      : bookmarks.filter((bookmark) => (bookmark.category?.id ?? "uncategorized") === selectedCategoryKey);
    const trimmed = query.trim();
    if (!trimmed || searchMode !== "filter") return byCategory;
    return byCategory.filter((bookmark) =>
      textMatchesQuery(trimmed, [
        bookmark.title,
        bookmark.url,
        bookmark.description ?? "",
        bookmark.category?.name ?? "",
      ]),
    );
  }, [bookmarks, query, searchMode, selectedCategoryKey]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; icon?: string; items: PublicBookmark[] }>();
    for (const bookmark of filtered) {
      const key = bookmark.category?.id ?? "uncategorized";
      const current = map.get(key) ?? {
        key,
        name: bookmark.category?.name ?? tx("Uncategorized", "未分类"),
        ...(bookmark.category?.icon ? { icon: bookmark.category.icon } : {}),
        items: [],
      };
      current.items.push(bookmark);
      map.set(key, current);
    }
    return Array.from(map.values());
  }, [filtered, tx]);

  const nextAppearance = THEME_CYCLE[(THEME_CYCLE.indexOf(appearance) + 1) % THEME_CYCLE.length] ?? "system";
  const themeIcon = appearance === "light" ? "☀" : appearance === "dark" ? "☾" : "◐";
  const themeLabel = appearance === "light"
    ? tx("Light", "浅色")
    : appearance === "dark"
      ? tx("Dark", "深色")
      : tx("System", "跟随系统");

  function cycleTheme() {
    setAppearance(nextAppearance);
    applyAppearance(nextAppearance, true);
  }

  function chooseLayout(layout: PublicPageLayout) {
    setVisitorLayout(layout);
    writeVisitorPublicLayout(layout);
  }

  function openExternalUrl(url: string) {
    if (siteSettings.openInNewTab) {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
    } else {
      window.location.assign(url);
    }
  }

  function runWebSearch(engine: WebSearchEngineOption, rawQuery = query) {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;
    openExternalUrl(engine.buildUrl(trimmed));
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else searchInputRef.current?.blur();
      return;
    }
    if (event.key !== "Enter") return;
    const trimmed = query.trim();
    if (!trimmed) return;
    if (activeWebEngine) {
      event.preventDefault();
      runWebSearch(activeWebEngine, trimmed);
      return;
    }
    if (siteSettings.showWebSearch && filtered.length === 0) {
      event.preventDefault();
      runWebSearch(WEB_SEARCH_ENGINES[0]!, trimmed);
    }
  }

  const displayTitle = siteSettings.siteTitle.trim() || tx("Curated links", "个人导航");
  const displaySubtitle = siteSettings.siteSubtitle.trim()
    || tx("Curated bookmarks and quick web search.", "精选导航与快捷搜索。");
  const searchPlaceholder = activeWebEngine
    ? tx(`Search ${activeWebEngine.labelEn}…`, `使用 ${activeWebEngine.labelZh} 搜索…`)
    : tx("Filter links by title, pinyin, host or category…", "按标题、拼音首字母、域名或分类筛选…");

  const gridClass = effectiveLayout === "compact"
    ? "public-grid-compact"
    : effectiveLayout === "list"
      ? "public-grid-list"
      : "public-grid";

  return (
    <main className="public-shell">
      <header className="public-topbar">
        <a className="public-brand" href="/" aria-label={tx("Dockmark public home", "Dockmark 公开主页")}>
          <span>D·</span>
          <strong>{siteSettings.siteTitle.trim() || "Dockmark"}</strong>
        </a>
        <div className="public-topbar-actions">
          <button
            className="public-control-pill"
            type="button"
            onClick={cycleTheme}
            aria-label={tx(`Theme: ${themeLabel}`, `切换主题（当前：${themeLabel}）`)}
          >
            <span aria-hidden="true">{themeIcon}</span>
            <span>{themeLabel}</span>
          </button>
          <button
            className="public-control-pill"
            type="button"
            onClick={() => setLocalePreference(isZh ? "en" : "zh-CN")}
            aria-label={tx("Switch language to Simplified Chinese", "将页面切换为英文")}
          >
            {isZh ? "EN" : "中文"}
          </button>
          <a className="public-manage" href="/app">{tx("Workspace →", "工作台 →")}</a>
        </div>
      </header>

      <section className="public-hero">
        <div className="public-hero-head">
          <div>
            <h1>{displayTitle}</h1>
            <p className="public-intro">{displaySubtitle}</p>
          </div>
          {!loading && !error && (
            <span className="public-count-badge">
              {tx(`${bookmarks.length} link${bookmarks.length === 1 ? "" : "s"}`, `${bookmarks.length} 条链接`)}
            </span>
          )}
        </div>

        {siteSettings.showSearchBar && (
          <div className="public-search-wrap">
            {siteSettings.showWebSearch && (
              <div className="public-engine-pills" role="tablist" aria-label={tx("Search engine mode", "搜索引擎模式")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={searchMode === "filter"}
                  className={`public-engine-pill${searchMode === "filter" ? " active" : ""}`}
                  onClick={() => {
                    setSearchMode("filter");
                    searchInputRef.current?.focus();
                  }}
                >
                  {tx("Filter", "站内筛选")}
                </button>
                {WEB_SEARCH_ENGINES.map((engine) => (
                  <button
                    key={engine.id}
                    type="button"
                    role="tab"
                    aria-selected={searchMode === engine.id}
                    className={`public-engine-pill${searchMode === engine.id ? " active" : ""}`}
                    onClick={() => {
                      setSearchMode(engine.id);
                      searchInputRef.current?.focus();
                    }}
                  >
                    {tx(engine.labelEn, engine.labelZh)}
                  </button>
                ))}
              </div>
            )}

            <div className="public-search">
              <span className="public-search-icon" aria-hidden="true">⌕</span>
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                autoFocus
              />
              {query && (
                <button
                  className="dm-search-clear"
                  type="button"
                  aria-label={tx("Clear search", "清空搜索")}
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              )}
              {activeWebEngine && query.trim() ? (
                <button
                  className="public-search-submit"
                  type="button"
                  onClick={() => runWebSearch(activeWebEngine)}
                >
                  {tx("Search ↵", "搜索 ↵")}
                </button>
              ) : (
                !query && <kbd className="public-search-kbd">/</kbd>
              )}
            </div>
          </div>
        )}
      </section>

      {!loading && !error && bookmarks.length > 0 && (
        <div className="public-toolbar">
          {siteSettings.showCategoryNav && categories.length > 0 && (
            <div className="public-category-bar" role="tablist" aria-label={tx("Filter by category", "按分类快捷筛选")}>
              <button
                type="button"
                role="tab"
                aria-selected={selectedCategoryKey === "all"}
                className={`public-category-pill${selectedCategoryKey === "all" ? " active" : ""}`}
                onClick={() => setSelectedCategoryKey("all")}
              >
                <span>{tx("All", "全部")}</span>
                <em>{bookmarks.length}</em>
              </button>
              {categories.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  role="tab"
                  aria-selected={selectedCategoryKey === category.key}
                  className={`public-category-pill${selectedCategoryKey === category.key ? " active" : ""}`}
                  onClick={() => setSelectedCategoryKey(category.key)}
                >
                  {category.icon && <span aria-hidden="true">{category.icon}</span>}
                  <span>{category.name}</span>
                  <em>{category.count}</em>
                </button>
              ))}
            </div>
          )}

          <div className="public-layout-switcher" role="group" aria-label={tx("Layout density", "切换视图布局")}>
            {([
              ["grid", tx("Grid", "网格")],
              ["compact", tx("Compact", "紧凑")],
              ["list", tx("List", "列表")],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={effectiveLayout === mode ? "active" : ""}
                aria-pressed={effectiveLayout === mode}
                onClick={() => chooseLayout(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <div className="public-message public-error" role="alert">{error}</div>}
      {!error && loading && <div className="public-message">{tx("Loading curated links…", "正在加载公开书签…")}</div>}

      {!loading && !error && groups.length > 0 && (
        <section className="public-groups">
          {groups.map((group) => (
            <article className="public-group" key={group.key}>
              <div className="public-group-heading">
                <span>{group.icon ?? "#"}</span>
                <h2>{group.name}</h2>
                <small>{group.items.length}</small>
              </div>
              <div className={gridClass}>
                {group.items.map((bookmark) => {
                  const host = hostLabel(bookmark.url);
                  const href = safeHttpUrl(bookmark.url) ?? "#";
                  const cardClass = effectiveLayout === "compact"
                    ? "public-card public-card-compact"
                    : effectiveLayout === "list"
                      ? "public-card public-card-list"
                      : "public-card";
                  return (
                    <a
                      className={cardClass}
                      href={href}
                      target={siteSettings.openInNewTab ? "_blank" : undefined}
                      rel={siteSettings.openInNewTab ? "noopener noreferrer" : undefined}
                      title={`${bookmark.title} — ${host}`}
                      key={bookmark.id}
                    >
                      <SafeFavicon
                        iconUrl={bookmark.iconUrl}
                        title={bookmark.title}
                        url={bookmark.url}
                        className="public-card-icon"
                      />
                      <span className="public-card-copy">
                        <strong>{bookmark.title}</strong>
                        {effectiveLayout !== "compact" && (
                          <small>{bookmark.description || host}</small>
                        )}
                      </span>
                      {effectiveLayout === "list" && (
                        <span className="public-domain-badge">{host}</span>
                      )}
                      {effectiveLayout !== "compact" && (
                        <span className="public-card-arrow" aria-hidden="true">↗</span>
                      )}
                    </a>
                  );
                })}
              </div>
            </article>
          ))}
        </section>
      )}

      {!loading && !error && !groups.length && (
        <section className="public-empty">
          <strong>{query.trim() ? tx("No public links match that filter.", "没有匹配的公开链接。") : tx("Nothing is public yet.", "暂未发布公开链接。")}</strong>
          <span>
            {query.trim()
              ? siteSettings.showWebSearch
                ? tx("Press Enter to search Google, or pick a web search engine below.", "按 Enter 使用 Google 搜索，或直接选择下方外网引擎。")
                : tx("Try another keyword or switch category.", "请尝试其他关键词或切换分类。")
              : tx("The owner can publish selected bookmarks from Settings.", "站点所有者可在「设置 → 公开主页」中选择发布书签。")}
          </span>
          {query.trim() && siteSettings.showWebSearch && (
            <div className="public-fallback-engines">
              {WEB_SEARCH_ENGINES.slice(0, 4).map((engine) => (
                <button
                  key={engine.id}
                  type="button"
                  className="public-fallback-btn"
                  onClick={() => runWebSearch(engine)}
                >
                  {tx(`Search ${engine.labelEn} ↗`, `用 ${engine.labelZh} 搜索 ↗`)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="public-footer">
        <span>{siteSettings.siteTitle.trim() ? `${siteSettings.siteTitle.trim()} · Dockmark` : tx("Dockmark · Personal Navigation", "Dockmark · 个人导航站")}</span>
        <a href="/app">{tx("Owner sign in", "管理员登录")}</a>
      </footer>
    </main>
  );
}
