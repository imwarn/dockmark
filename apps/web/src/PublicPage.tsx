/**
 * [INPUT]: depends on usePublicI18n from ./i18n, applyAppearance/localAppearance from ./theme, SafeFavicon/hostLabel/safeHttpUrl from ./LauncherDashboard, and ./public-page.css
 * [OUTPUT]: exports PublicPage read-only curated bookmarks directory with visitor-local theme and locale toggles
 * [POS]: Public root route (/) rendered by main.tsx for unauthenticated visitors. Never mutates owner D1 preferences.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useEffect, useMemo, useState } from "react";
import type { AppearancePreference } from "@dockmark/core";
import { usePublicI18n } from "./i18n";
import { hostLabel, SafeFavicon, safeHttpUrl } from "./LauncherDashboard";
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

const THEME_CYCLE: AppearancePreference[] = ["system", "light", "dark"];

export function PublicPage() {
  const { isZh, tx, setLocalePreference } = usePublicI18n();
  const [appearance, setAppearance] = useState<AppearancePreference>(() => localAppearance());
  const [bookmarks, setBookmarks] = useState<PublicBookmark[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setAppearance(localAppearance());
    const onAppearance = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: AppearancePreference }>).detail;
      setAppearance(detail?.preference ?? localAppearance());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) sync();
    };
    window.addEventListener("dockmark:appearance", onAppearance);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("dockmark:appearance", onAppearance);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/public/bookmarks", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { bookmarks?: PublicBookmark[]; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? `Public page request failed (${response.status}).`);
        return Array.isArray(payload.bookmarks) ? payload.bookmarks : [];
      })
      .then((items) => {
        if (!cancelled) setBookmarks(items);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : tx("Could not load public bookmarks.", "无法加载公开书签。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tx]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return bookmarks;
    return bookmarks.filter((bookmark) =>
      `${bookmark.title} ${bookmark.url} ${bookmark.description ?? ""} ${bookmark.category?.name ?? ""}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [bookmarks, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; icon?: string; items: PublicBookmark[] }>();
    for (const bookmark of filtered) {
      const key = bookmark.category?.id ?? "uncategorized";
      const current = map.get(key) ?? {
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

  return (
    <main className="public-shell">
      <header className="public-topbar">
        <a className="public-brand" href="/" aria-label={tx("Dockmark public home", "Dockmark 公开主页")}>
          <span>D·</span>
          <strong>Dockmark</strong>
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
            <h1>{tx("Curated links", "精选书签")}</h1>
            <p className="public-intro">
              {tx(
                "A public slice of this Dockmark library. Private bookmarks, Workspaces and Sessions stay behind sign-in.",
                "来自 Dockmark 的公开精选列表；私有书签、工作区与会话仅在登录后可见。",
              )}
            </p>
          </div>
          {!loading && !error && (
            <span className="public-count-badge">
              {tx(`${bookmarks.length} link${bookmarks.length === 1 ? "" : "s"}`, `${bookmarks.length} 条链接`)}
            </span>
          )}
        </div>
        <label className="public-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tx("Filter public links by title, host or category…", "按标题、域名或分类筛选公开书签…")}
            autoFocus
          />
        </label>
      </section>

      {error && <div className="public-message public-error" role="alert">{error}</div>}
      {!error && loading && <div className="public-message">{tx("Loading curated links…", "正在加载公开书签…")}</div>}

      {!loading && !error && groups.length > 0 && (
        <section className="public-groups">
          {groups.map((group) => (
            <article className="public-group" key={group.name}>
              <div className="public-group-heading">
                <span>{group.icon ?? "#"}</span>
                <h2>{group.name}</h2>
                <small>{group.items.length}</small>
              </div>
              <div className="public-grid">
                {group.items.map((bookmark) => (
                  <a
                    className="public-card"
                    href={safeHttpUrl(bookmark.url) ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
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
                      <small>{bookmark.description || hostLabel(bookmark.url)}</small>
                    </span>
                    <span className="public-card-arrow" aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {!loading && !error && !groups.length && (
        <section className="public-empty">
          <strong>{query ? tx("No public links match that filter.", "没有匹配的公开链接。") : tx("Nothing is public yet.", "暂未发布公开链接。")}</strong>
          <span>
            {query
              ? tx("Try another keyword.", "请尝试其他关键词。")
              : tx("The owner can publish selected bookmarks from Settings.", "站点所有者可在「设置 → 公开主页」中选择发布书签。")}
          </span>
        </section>
      )}

      <footer className="public-footer">
        <span>{tx("Dockmark · Public page", "Dockmark · 公开主页")}</span>
        <a href="/app">{tx("Owner sign in", "管理员登录")}</a>
      </footer>
    </main>
  );
}
