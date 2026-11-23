/**
 * [INPUT]: depends on @dockmark/core ranking/bang/i18n helpers; BridgeTab from ./browser-bridge; bookmarkMatchesQuery from ./bookmark-search; matchesSmartCollection/smartCollectionFilterLabels from ./smart-collection-match; SmartCollection from ./smart-collections-api; useI18n from ./i18n
 * [OUTPUT]: exports safeHttpUrl, hostLabel, SafeFavicon, buildLauncherResults, LauncherCommandPanel, and LauncherDashboard
 * [POS]: Launcher UI and command-ranking module used by App.tsx. Provides the interactive empty-query dashboard, keyboard-navigable command results panel, and shared favicon renderer.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useMemo, useState, type MouseEvent } from "react";
import {
  buildSearchUrl,
  launcherTextScore,
  matchingBangEngines,
  parseBangQuery,
  rankCommands,
  SOURCE_LABELS,
  type Bookmark,
  type Category,
  type CommandResult,
  type ResolvedLocale,
  type SearchEngine,
  type SessionWithItems,
  type WorkspaceWithItems,
} from "@dockmark/core";
import { bookmarkMatchesQuery } from "./bookmark-search";
import type { BridgeTab } from "./browser-bridge";
import { useI18n } from "./i18n";
import { matchesSmartCollection, smartCollectionFilterLabels } from "./smart-collection-match";
import type { SmartCollection } from "./smart-collections-api";

export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export function SafeFavicon({
  iconUrl,
  title,
  url,
  className = "launcher-card-icon",
}: {
  iconUrl?: string | null | undefined;
  title: string;
  url?: string | undefined;
  className?: string | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const validIcon = failed ? null : safeHttpUrl(iconUrl);
  const fallbackChar = (title.trim() || (url ? hostLabel(url) : "D")).slice(0, 1).toUpperCase();

  return (
    <span className={className} aria-hidden="true">
      {validIcon ? (
        <img
          src={validIcon}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        fallbackChar
      )}
    </span>
  );
}

export interface BuildLauncherResultsInput {
  query: string;
  bookmarks: Bookmark[];
  bookmarkTags: Record<string, string[]>;
  categoryById: Map<string, string>;
  smartCollections: SmartCollection[];
  inboxIds: Set<string>;
  workspaces: WorkspaceWithItems[];
  sessions: SessionWithItems[];
  searchEngines: SearchEngine[];
  defaultEngine: SearchEngine | null;
  openTabs: BridgeTab[];
  bridgeConnected: boolean;
  tx: (en: string, zh: string) => string;
}

export function buildLauncherResults({
  query,
  bookmarks,
  bookmarkTags,
  categoryById,
  smartCollections,
  inboxIds,
  workspaces,
  sessions,
  searchEngines,
  defaultEngine,
  openTabs,
  bridgeConnected,
  tx,
}: BuildLauncherResultsInput): CommandResult[] {
  const trimmed = query.trim();
  const normalized = trimmed.toLocaleLowerCase();
  const bang = parseBangQuery(trimmed, searchEngines);

  if (bang) {
    const canRun = Boolean(bang.query);
    return [{
      id: `search-run:${bang.engine.id}`,
      source: "search",
      title: canRun
        ? tx(`Search ${bang.engine.name} for “${bang.query}”`, `使用 ${bang.engine.name} 搜索“${bang.query}”`)
        : tx(`Search with ${bang.engine.name}`, `使用 ${bang.engine.name} 搜索`),
      subtitle: `!${bang.engine.keyword ?? ""} · ${bang.engine.searchUrl}`,
      ...(canRun ? { url: buildSearchUrl(bang.engine, bang.query) } : {}),
      score: 100,
    }];
  }

  const bangSuggestions = matchingBangEngines(trimmed, searchEngines);
  if (bangSuggestions.length) {
    return bangSuggestions.slice(0, 8).map((engine) => ({
      id: `search-shortcut:${engine.id}`,
      source: "search",
      title: engine.name,
      subtitle: tx(`!${engine.keyword} · type a query`, `!${engine.keyword} · 输入搜索词`),
      score: 100,
    }));
  }

  if (trimmed.startsWith("@")) {
    const needle = trimmed.slice(1).trim();
    return smartCollections
      .flatMap((collection) => {
        const labels = smartCollectionFilterLabels(collection.filters, categoryById);
        const count = bookmarks.filter((bookmark) =>
          matchesSmartCollection(bookmark, collection.filters, bookmarkTags[bookmark.id] ?? [], inboxIds),
        ).length;
        const subtitle = tx(
          `${count} bookmark${count === 1 ? "" : "s"}${labels.length ? ` · ${labels.slice(0, 4).join(" · ")}` : " · All bookmarks"}`,
          `${count} 条书签${labels.length ? ` · ${labels.slice(0, 4).join(" · ")}` : " · 全部书签"}`,
        );
        const score = needle ? launcherTextScore(needle, collection.name, [subtitle, ...labels], 60) : 60;
        if (needle && score < 0) return [];
        return [{
          id: `navigation:collection:${collection.id}`,
          source: "collection" as const,
          title: collection.name,
          subtitle,
          score,
        }];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  const tabCandidates = normalized ? openTabs : openTabs.slice(0, 4);
  const tabResults: CommandResult[] = tabCandidates.flatMap((tab) => {
    const subtitle = `${hostLabel(tab.url)}${tab.pinned ? tx(" · Pinned", " · 已固定") : ""}${tab.active ? tx(" · Active", " · 当前") : ""}`;
    const score = launcherTextScore(trimmed, tab.title, [tab.url, subtitle], 40 + (tab.pinned ? 4 : 0) + (tab.active ? 2 : 0));
    if (normalized && score < 0) return [];
    return [{
      id: `tab:${tab.id}`,
      source: "tab",
      title: tab.title,
      subtitle,
      url: tab.url,
      score,
    }];
  });
  const workspaceResults: CommandResult[] = workspaces.flatMap((workspace) => {
    const subtitle = tx(
      `Open workspace · ${workspace.items.length} tabs`,
      `打开工作区 · ${workspace.items.length} 个标签`,
    );
    const itemText = workspace.items.flatMap((item) => [item.title, item.url]);
    const score = launcherTextScore(trimmed, workspace.name, [workspace.description ?? "", subtitle, ...itemText], 30);
    if (normalized && score < 0) return [];
    return [{
      id: workspace.id,
      source: "workspace",
      title: workspace.name,
      subtitle,
      score,
    }];
  });
  const sessionResults: CommandResult[] = sessions.flatMap((session, index) => {
    const subtitle = tx(
      `Restore session · ${session.items.length} tabs${session.sourceDevice ? ` · ${session.sourceDevice}` : ""}`,
      `恢复会话 · ${session.items.length} 个标签${session.sourceDevice ? ` · ${session.sourceDevice}` : ""}`,
    );
    const itemText = session.items.flatMap((item) => [item.title, item.url]);
    const score = launcherTextScore(trimmed, session.name, [session.sourceDevice ?? "", subtitle, ...itemText], Math.max(0, 30 - index));
    if (normalized && score < 0) return [];
    return [{
      id: session.id,
      source: "session",
      title: session.name,
      subtitle,
      score,
    }];
  });
  const collectionResults: CommandResult[] = smartCollections.flatMap((collection) => {
    const labels = smartCollectionFilterLabels(collection.filters, categoryById);
    const count = bookmarks.filter((bookmark) =>
      matchesSmartCollection(bookmark, collection.filters, bookmarkTags[bookmark.id] ?? [], inboxIds),
    ).length;
    const subtitle = tx(
      `${count} bookmark${count === 1 ? "" : "s"}${labels.length ? ` · ${labels.slice(0, 4).join(" · ")}` : " · All bookmarks"}`,
      `${count} 条书签${labels.length ? ` · ${labels.slice(0, 4).join(" · ")}` : " · 全部书签"}`,
    );
    const score = launcherTextScore(trimmed, collection.name, [subtitle, ...labels], 30);
    if (normalized && score < 0) return [];
    return [{
      id: `navigation:collection:${collection.id}`,
      source: "collection",
      title: collection.name,
      subtitle,
      score,
    }];
  });
  const bookmarkResults: CommandResult[] = bookmarks.flatMap((bookmark) => {
    const tags = bookmarkTags[bookmark.id] ?? [];
    const category = bookmark.categoryId ? categoryById.get(bookmark.categoryId) ?? "" : tx("Uncategorized", "未分类");
    const tagTokens = tags.map((tag) => `#${tag}`);
    if (normalized && !bookmarkMatchesQuery(bookmark, category, tags, trimmed)) return [];
    const subtitleParts = [hostLabel(bookmark.url)];
    if (category) subtitleParts.push(category);
    if (tagTokens.length) subtitleParts.push(tagTokens.slice(0, 3).join(" "));
    const score = launcherTextScore(trimmed, bookmark.title, [bookmark.url, bookmark.description ?? "", category, ...tags, ...tagTokens], 30);
    if (normalized && score < 0) return [];
    return [{
      id: bookmark.id,
      source: "bookmark",
      title: bookmark.title,
      subtitle: subtitleParts.join(" · "),
      url: bookmark.url,
      score,
    }];
  });
  const navigationTitle = bridgeConnected
    ? tx("Browser extension", "浏览器扩展")
    : tx("Install browser extension", "安装浏览器扩展");
  const navigationSubtitle = bridgeConnected
    ? tx("Diagnostics, version and capabilities", "连接诊断、版本与能力状态")
    : tx("Enable open tabs, Session restore and native bookmark import", "解锁打开的标签页、会话恢复与原生书签同步");
  const navigationScore = launcherTextScore(trimmed, navigationTitle, [navigationSubtitle], 20);
  const navigationResults: CommandResult[] = normalized && navigationScore < 0 ? [] : [{
    id: "navigation:extension",
    source: "navigation",
    title: navigationTitle,
    subtitle: navigationSubtitle,
    score: navigationScore,
  }];

  const localResults = rankCommands([
    ...tabResults,
    ...workspaceResults,
    ...sessionResults,
    ...collectionResults,
    ...bookmarkResults,
    ...navigationResults,
  ]).slice(0, trimmed && defaultEngine ? 8 : 9);

  if (trimmed && defaultEngine) {
    localResults.push({
      id: `search-run:${defaultEngine.id}`,
      source: "search",
      title: tx(`Search ${defaultEngine.name} for “${trimmed}”`, `使用 ${defaultEngine.name} 搜索“${trimmed}”`),
      subtitle: defaultEngine.keyword
        ? tx(`Default · !${defaultEngine.keyword}`, `默认引擎 · !${defaultEngine.keyword}`)
        : tx("Default search engine", "默认搜索引擎"),
      url: buildSearchUrl(defaultEngine, trimmed),
      score: 0,
    });
  }

  return localResults;
}

export function LauncherCommandPanel({
  results,
  selectedIndex,
  bookmarkById,
  bridgeConnected,
  launcherStatus,
  loading,
  locale,
  slashFocus = true,
  onSelectIndex,
  onExecute,
}: {
  results: CommandResult[];
  selectedIndex: number;
  bookmarkById: Map<string, Bookmark>;
  bridgeConnected: boolean;
  launcherStatus: string;
  loading: boolean;
  locale: ResolvedLocale;
  slashFocus?: boolean;
  onSelectIndex: (index: number) => void;
  onExecute: (item: CommandResult, forceNewTab: boolean) => Promise<void>;
}) {
  const { tx } = useI18n();
  const sourceLabels = SOURCE_LABELS[locale];

  return (
    <section className="panel" aria-label={tx("Command results", "搜索结果")}>
      <div className="panel-heading">
        <span>{tx("Command results", "搜索结果")}</span>
        <span className={`muted bridge-label ${bridgeConnected ? "connected" : ""}`}>{launcherStatus}</span>
      </div>
      <div className="results" id="dockmark-command-results" role="listbox">
        {results.map((item, index) => {
          const isCollection = item.source === "collection";
          const bookmark = item.source === "bookmark" ? bookmarkById.get(item.id) : undefined;
          return (
            <button
              className={`result result-button ${selectedIndex === index ? "selected" : ""}`}
              type="button"
              role="option"
              aria-selected={selectedIndex === index}
              id={`command-result-${index}`}
              key={`${item.source}-${item.id}`}
              onMouseEnter={() => onSelectIndex(index)}
              onClick={(event) => void onExecute(item, event.metaKey || event.ctrlKey || event.shiftKey)}
            >
              {bookmark ? (
                <SafeFavicon iconUrl={bookmark.iconUrl} title={bookmark.title} url={bookmark.url} className="favicon" />
              ) : (
                <span className="favicon">
                  {isCollection ? "◇" : item.source === "tab" ? "↗" : item.source === "session" ? "↺" : item.source === "search" ? "⌕" : item.source === "navigation" ? "＋" : item.title.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="result-copy">
                <strong>{item.title}</strong>
                <small>{item.subtitle}</small>
              </span>
              <span className="pill">
                {item.source === "search" && item.id.startsWith("search-shortcut:")
                  ? <span className="bang-token">{tx("Bang", "快捷搜索")}</span>
                  : sourceLabels[item.source]}
              </span>
            </button>
          );
        })}
        {!loading && !results.length && (
          <div className="empty-command">
            {tx("No matches. Configure a search engine or try another query.", "暂无匹配项，可尝试其他关键词或配置默认搜索引擎。")}
          </div>
        )}
      </div>
      <div className="command-footer">
        <span>
          <kbd>↑</kbd><kbd>↓</kbd> {tx("select", "选择")} <kbd>Enter</kbd> {tx("run", "打开")} <kbd>Tab</kbd> {tx("accept bang", "补全快捷词")}
        </span>
        <span>
          <kbd>Shift</kbd>/<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> {tx("new tab", "新标签页")}{slashFocus && <> <kbd>/</kbd> {tx("focus", "聚焦")}</>} <kbd>Esc</kbd> {tx("clear", "清空")}
        </span>
      </div>
    </section>
  );
}

type FilterKey =
  | { kind: "all" }
  | { kind: "collection"; id: string }
  | { kind: "category"; id: string | null };

interface LauncherDashboardProps {
  bookmarks: Bookmark[];
  bookmarkTags: Record<string, string[]>;
  categories: Category[];
  smartCollections: SmartCollection[];
  inboxIds: Set<string>;
  workspaces: WorkspaceWithItems[];
  openTabs: BridgeTab[];
  bridgeConnected: boolean;
  loading: boolean;
  onLaunchWorkspace: (workspace: WorkspaceWithItems) => Promise<void>;
  onActivateTab: (tab: BridgeTab, forceNewTab: boolean) => Promise<void>;
  onOpenView: (view: "workspaces" | "bookmarks") => void;
}

export function LauncherDashboard({
  bookmarks,
  bookmarkTags,
  categories,
  smartCollections,
  inboxIds,
  workspaces,
  openTabs,
  bridgeConnected,
  loading,
  onLaunchWorkspace,
  onActivateTab,
  onOpenView,
}: LauncherDashboardProps) {
  const { tx } = useI18n();
  const [filter, setFilter] = useState<FilterKey>({ kind: "all" });
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const collection of smartCollections) {
      let count = 0;
      for (const bookmark of bookmarks) {
        if (matchesSmartCollection(bookmark, collection.filters, bookmarkTags[bookmark.id] ?? [], inboxIds)) {
          count += 1;
        }
      }
      counts.set(collection.id, count);
    }
    return counts;
  }, [bookmarkTags, bookmarks, inboxIds, smartCollections]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;
    for (const bookmark of bookmarks) {
      if (!bookmark.categoryId) uncategorized += 1;
      else counts.set(bookmark.categoryId, (counts.get(bookmark.categoryId) ?? 0) + 1);
    }
    return { counts, uncategorized };
  }, [bookmarks]);

  const activeCollection = useMemo(
    () => (filter.kind === "collection" ? smartCollections.find((item) => item.id === filter.id) ?? null : null),
    [filter, smartCollections],
  );

  const visibleBookmarks = useMemo(() => {
    if (filter.kind === "all") return bookmarks;
    if (filter.kind === "collection") {
      if (!activeCollection) return bookmarks;
      return bookmarks.filter((bookmark) =>
        matchesSmartCollection(bookmark, activeCollection.filters, bookmarkTags[bookmark.id] ?? [], inboxIds),
      );
    }
    if (filter.id === null) return bookmarks.filter((bookmark) => !bookmark.categoryId);
    return bookmarks.filter((bookmark) => bookmark.categoryId === filter.id);
  }, [activeCollection, bookmarkTags, bookmarks, filter, inboxIds]);

  async function launch(workspace: WorkspaceWithItems) {
    setLaunchingId(workspace.id);
    try {
      await onLaunchWorkspace(workspace);
    } finally {
      setLaunchingId(null);
    }
  }

  function handleBookmarkClick(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (!safeHttpUrl(url)) event.preventDefault();
  }

  return (
    <div className="launcher-dashboard">
      {bridgeConnected && openTabs.length > 0 && (
        <section className="launcher-section" aria-label={tx("Open tabs", "打开的标签页")}>
          <div className="launcher-section-head">
            <h2>{tx("Open tabs", "打开的标签页")}</h2>
            <span className="launcher-section-count">{openTabs.length}</span>
          </div>
          <div className="launcher-tabs-strip">
            {openTabs.slice(0, 6).map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`launcher-tab-chip${tab.active ? " is-active" : ""}`}
                onClick={(event) => void onActivateTab(tab, event.metaKey || event.ctrlKey || event.shiftKey)}
                title={`${tab.title} — ${tab.url}`}
              >
                <span className="launcher-tab-arrow" aria-hidden="true">{tab.pinned ? "📌" : "↗"}</span>
                <span className="launcher-tab-title">{tab.title}</span>
                <small>{hostLabel(tab.url)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {workspaces.length > 0 && (
        <section className="launcher-section" aria-label={tx("Workspaces", "工作区")}>
          <div className="launcher-section-head">
            <h2>{tx("Workspaces", "工作区")}</h2>
            <span className="launcher-section-count">{workspaces.length}</span>
            <button className="text-action launcher-section-link" type="button" onClick={() => onOpenView("workspaces")}>
              {tx("Manage →", "管理 →")}
            </button>
          </div>
          <div className="launcher-workspace-grid">
            {workspaces.map((workspace) => {
              const reuseCount = workspace.items.filter((item) => item.openMode === "reuse").length;
              const pinnedCount = workspace.items.filter((item) => item.openMode === "pinned").length;
              const isLaunching = launchingId === workspace.id;
              return (
                <article className="launcher-workspace-card" key={workspace.id}>
                  <div className="launcher-workspace-main">
                    <span className="launcher-workspace-icon" aria-hidden="true">
                      {workspace.icon || workspace.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="launcher-workspace-copy">
                      <strong>{workspace.name}</strong>
                      <div className="launcher-workspace-meta">
                        <span>
                          {tx(
                            `${workspace.items.length} tab${workspace.items.length === 1 ? "" : "s"}`,
                            `${workspace.items.length} 个标签`,
                          )}
                        </span>
                        {reuseCount > 0 && <span className="launcher-mode-badge">{tx("reuse", "复用")}</span>}
                        {pinnedCount > 0 && <span className="launcher-mode-badge">{tx("pinned", "固定")}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    className="secondary launcher-launch-btn"
                    type="button"
                    disabled={isLaunching || !workspace.items.length}
                    onClick={() => void launch(workspace)}
                  >
                    {isLaunching ? tx("Opening…", "启动中…") : tx("Launch", "启动")}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="launcher-section" aria-label={tx("Bookmarks", "书签")}>
        <div className="launcher-section-head">
          <h2>{tx("Bookmarks", "书签")}</h2>
          <span className="launcher-section-count">
            {visibleBookmarks.length === bookmarks.length
              ? bookmarks.length
              : `${visibleBookmarks.length} / ${bookmarks.length}`}
          </span>
          <button className="text-action launcher-section-link" type="button" onClick={() => onOpenView("bookmarks")}>
            {tx("Manage →", "管理 →")}
          </button>
        </div>

        <div className="launcher-filter-bar" role="tablist" aria-label={tx("Filter bookmarks", "筛选书签")}>
          <button
            type="button"
            role="tab"
            aria-selected={filter.kind === "all"}
            className={`launcher-filter-pill${filter.kind === "all" ? " active" : ""}`}
            onClick={() => setFilter({ kind: "all" })}
          >
            <span>{tx("All", "全部")}</span>
            <em>{bookmarks.length}</em>
          </button>

          {smartCollections.map((collection) => {
            const active = filter.kind === "collection" && filter.id === collection.id;
            return (
              <button
                key={`collection:${collection.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                className={`launcher-filter-pill is-collection${active ? " active" : ""}`}
                onClick={() => setFilter({ kind: "collection", id: collection.id })}
              >
                <span aria-hidden="true">◇</span>
                <span>{collection.name}</span>
                <em>{collectionCounts.get(collection.id) ?? 0}</em>
              </button>
            );
          })}

          {categories.map((category) => {
            const count = categoryCounts.counts.get(category.id) ?? 0;
            if (count === 0) return null;
            const active = filter.kind === "category" && filter.id === category.id;
            return (
              <button
                key={`category:${category.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                className={`launcher-filter-pill${active ? " active" : ""}`}
                onClick={() => setFilter({ kind: "category", id: category.id })}
              >
                <span>{category.name}</span>
                <em>{count}</em>
              </button>
            );
          })}

          {categoryCounts.uncategorized > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={filter.kind === "category" && filter.id === null}
              className={`launcher-filter-pill${filter.kind === "category" && filter.id === null ? " active" : ""}`}
              onClick={() => setFilter({ kind: "category", id: null })}
            >
              <span>{tx("Uncategorized", "未分类")}</span>
              <em>{categoryCounts.uncategorized}</em>
            </button>
          )}
        </div>

        {loading && !bookmarks.length ? (
          <div className="launcher-empty">{tx("Loading bookmarks…", "正在加载书签…")}</div>
        ) : visibleBookmarks.length > 0 ? (
          <div className="launcher-bookmark-grid">
            {visibleBookmarks.map((bookmark) => {
              const tags = bookmarkTags[bookmark.id] ?? [];
              const categoryName = bookmark.categoryId ? categoryById.get(bookmark.categoryId) : null;
              return (
                <a
                  key={bookmark.id}
                  href={safeHttpUrl(bookmark.url) ?? "#"}
                  className="launcher-bookmark-card"
                  rel="noopener noreferrer"
                  onClick={(event) => handleBookmarkClick(event, bookmark.url)}
                  title={`${bookmark.title} — ${bookmark.url}`}
                >
                  <div className="launcher-bookmark-top">
                    <SafeFavicon iconUrl={bookmark.iconUrl} title={bookmark.title} url={bookmark.url} />
                    <div className="launcher-bookmark-copy">
                      <strong>{bookmark.title}</strong>
                      <small>
                        {hostLabel(bookmark.url)}
                        {categoryName ? ` · ${categoryName}` : ""}
                      </small>
                    </div>
                  </div>
                  {tags.length > 0 && (
                    <div className="launcher-bookmark-tags">
                      {tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="launcher-tag-pill">#{tag}</span>
                      ))}
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        ) : (
          <div className="launcher-empty">
            <strong>{tx("No bookmarks in this view", "当前筛选下暂无书签")}</strong>
            <span>
              {filter.kind === "all"
                ? tx("Add bookmarks in Bookmarks or import from your browser.", "可在「书签」页面新增，或从浏览器导入。")
                : tx("Choose another collection or category pill above.", "可点击上方其他合集或分类标签查看。")}
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
