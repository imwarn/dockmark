/**
 * [INPUT]: depends on @dockmark/core domain types, ./api, ./browser-bridge, ./i18n, ./LauncherDashboard, and workspace section manager views
 * [OUTPUT]: exports App root workspace shell with sticky 64px topbar, command palette launcher, and section router
 * [POS]: Primary authenticated workspace mounted by PrivateRoot for /app and /app/(workspaces|sessions|bookmarks|search|transfer|extension).
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  Bookmark,
  Category,
  CommandResult,
  SearchEngine,
  SessionWithItems,
  WorkspaceWithItems,
} from "@dockmark/core";
import {
  activateBridgeTab,
  getBridgeStatus,
  getOpenTabs,
  onBridgeEvent,
  openWorkspaceWithBridge,
  restoreSessionWithBridge,
  type BridgeTab,
} from "./browser-bridge";
import {
  listBookmarks,
  listCategories,
  listSearchEngines,
  listSessions,
  listWorkspaces,
} from "./api";
import { useI18n } from "./i18n";
import { listInbox } from "./inbox-api";
import {
  buildLauncherResults,
  LauncherCommandPanel,
  LauncherDashboard,
} from "./LauncherDashboard";
import { listSmartCollections, type SmartCollection } from "./smart-collections-api";
import { listBookmarkTags } from "./tag-api";
import { BookmarkManager } from "./BookmarkManager";
import { BrowserExtensionManager } from "./BrowserExtensionManager";
import { SearchEngineManager } from "./SearchEngineManager";
import { SessionManager } from "./SessionManager";
import { TransferManager } from "./TransferManager";
import { WorkspaceManager } from "./WorkspaceManager";

type View = "launcher" | "workspaces" | "sessions" | "bookmarks" | "search" | "transfer" | "extension";

const viewPaths: Record<View, string> = {
  launcher: "/app",
  workspaces: "/app/workspaces",
  sessions: "/app/sessions",
  bookmarks: "/app/bookmarks",
  search: "/app/search",
  transfer: "/app/transfer",
  extension: "/app/extension",
};

function viewFromPath(pathname: string): View {
  for (const [view, path] of Object.entries(viewPaths) as Array<[View, string]>) {
    if (view === "launcher") continue;
    if (pathname === path || pathname.startsWith(`${path}/`)) return view;
  }
  return "launcher";
}

function navigateView(view: View) {
  const path = viewPaths[view];
  if (window.location.pathname === path) return;
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function openUrls(urls: string[]) {
  for (const url of urls) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  }
}

export function App() {
  const { locale, tx } = useI18n();
  const [view, setView] = useState<View>(() => viewFromPath(window.location.pathname));
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkTags, setBookmarkTags] = useState<Record<string, string[]>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [smartCollections, setSmartCollections] = useState<SmartCollection[]>([]);
  const [inboxIds, setInboxIds] = useState<Set<string>>(() => new Set());
  const [workspaces, setWorkspaces] = useState<WorkspaceWithItems[]>([]);
  const [sessions, setSessions] = useState<SessionWithItems[]>([]);
  const [searchEngines, setSearchEngines] = useState<SearchEngine[]>([]);
  const [openTabs, setOpenTabs] = useState<BridgeTab[]>([]);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setDataError(null);
    try {
      const [
        nextCategories,
        nextBookmarks,
        nextBookmarkTags,
        nextInbox,
        nextCollections,
        nextWorkspaces,
        nextSessions,
        nextSearchEngines,
      ] = await Promise.all([
        listCategories(),
        listBookmarks(),
        listBookmarkTags(),
        listInbox(),
        listSmartCollections(),
        listWorkspaces(),
        listSessions(),
        listSearchEngines(),
      ]);
      setCategories(nextCategories);
      setBookmarks(nextBookmarks);
      setBookmarkTags(nextBookmarkTags);
      setInboxIds(new Set(nextInbox.map((bookmark) => bookmark.id)));
      setSmartCollections(nextCollections);
      setWorkspaces(nextWorkspaces);
      setSessions(nextSessions);
      setSearchEngines(nextSearchEngines);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : tx("Could not load Dockmark data.", "无法加载 Dockmark 数据。"));
    } finally {
      setLoading(false);
    }
  }, [tx]);

  const refreshBridge = useCallback(async () => {
    try {
      const status = await getBridgeStatus();
      if (!status.connected) throw new Error("Browser bridge is unavailable.");
      const tabs = await getOpenTabs();
      setBridgeConnected(true);
      setOpenTabs(tabs);
    } catch {
      setBridgeConnected(false);
      setOpenTabs([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const unsubscribe = onBridgeEvent((event) => {
      if (event === "ready" || event === "tabs-changed") void refreshBridge();
    });
    const onFocus = () => void refreshBridge();
    window.addEventListener("focus", onFocus);
    void refreshBridge();
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshBridge]);

  useEffect(() => {
    const focusLauncher = () => {
      navigateView("launcher");
      setView("launcher");
      void refreshBridge();
      requestAnimationFrame(() => commandInputRef.current?.focus());
    };
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusLauncher();
        return;
      }
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
      focusLauncher();
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [refreshBridge]);

  const defaultEngine = useMemo(
    () => searchEngines.find((engine) => engine.isDefault) ?? searchEngines[0] ?? null,
    [searchEngines],
  );

  const primaryBangKeyword = useMemo(
    () => searchEngines.find((engine) => engine.isDefault && engine.keyword)?.keyword
      ?? searchEngines.find((engine) => engine.keyword)?.keyword
      ?? "g",
    [searchEngines],
  );

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const bookmarkById = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])),
    [bookmarks],
  );

  const hasQuery = query.trim().length > 0;

  const results = useMemo(
    () => buildLauncherResults({
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
    }),
    [
      bookmarkTags,
      bookmarks,
      bridgeConnected,
      categoryById,
      defaultEngine,
      inboxIds,
      openTabs,
      query,
      searchEngines,
      sessions,
      smartCollections,
      tx,
      workspaces,
    ],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= results.length) setSelectedIndex(Math.max(0, results.length - 1));
  }, [results.length, selectedIndex]);

  const launchWorkspace = useCallback(async (workspace: WorkspaceWithItems) => {
    const ordered = [...workspace.items].sort((a, b) => a.position - b.position);
    if (bridgeConnected) {
      try {
        await openWorkspaceWithBridge(ordered.map((entry) => ({
          url: entry.url,
          openMode: entry.openMode,
        })));
        return;
      } catch {
        setBridgeConnected(false);
        setOpenTabs([]);
      }
    }
    openUrls(ordered.map((entry) => entry.url));
  }, [bridgeConnected]);

  const activateTab = useCallback(async (tab: BridgeTab, forceNewTab: boolean) => {
    if (forceNewTab && tab.url) {
      const opened = window.open(tab.url, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
      return;
    }
    try {
      await activateBridgeTab(tab.id);
      return;
    } catch {
      setBridgeConnected(false);
      setOpenTabs([]);
    }
    if (tab.url) window.location.assign(tab.url);
  }, []);

  async function executeResult(item: CommandResult, forceNewTab = false) {
    if (item.id.startsWith("search-shortcut:")) {
      const engineId = item.id.slice("search-shortcut:".length);
      const engine = searchEngines.find((candidate) => candidate.id === engineId);
      if (engine?.keyword) {
        setQuery(`!${engine.keyword} `);
        requestAnimationFrame(() => commandInputRef.current?.focus());
      }
      return;
    }

    if (item.source === "navigation" && item.id === "navigation:extension") {
      navigateView("extension");
      return;
    }

    if (item.source === "collection" && item.id.startsWith("navigation:collection:")) {
      const collectionId = item.id.slice("navigation:collection:".length);
      const path = `/app/collections?collection=${encodeURIComponent(collectionId)}`;
      if (forceNewTab) {
        const opened = window.open(path, "_blank", "noopener,noreferrer");
        if (opened) opened.opener = null;
      } else {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      return;
    }

    if (item.source === "tab") {
      if (forceNewTab && item.url) {
        const opened = window.open(item.url, "_blank", "noopener,noreferrer");
        if (opened) opened.opener = null;
        return;
      }
      const tabId = Number(item.id.slice("tab:".length));
      if (Number.isFinite(tabId)) {
        try {
          await activateBridgeTab(tabId);
          return;
        } catch {
          setBridgeConnected(false);
          setOpenTabs([]);
        }
      }
      if (item.url) window.location.assign(item.url);
      return;
    }

    if (item.source === "workspace") {
      const workspace = workspaces.find((candidate) => candidate.id === item.id);
      if (workspace) await launchWorkspace(workspace);
      return;
    }

    if (item.source === "session") {
      const session = sessions.find((candidate) => candidate.id === item.id);
      if (!session) return;
      const ordered = [...session.items].sort((a, b) => a.position - b.position);
      if (bridgeConnected) {
        try {
          await restoreSessionWithBridge(ordered.map((entry) => ({
            url: entry.url,
            pinned: entry.pinned,
          })));
          return;
        } catch {
          setBridgeConnected(false);
          setOpenTabs([]);
        }
      }
      openUrls(ordered.map((entry) => entry.url));
      return;
    }

    if (!item.url) return;
    if (forceNewTab) {
      const opened = window.open(item.url, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
    } else {
      window.location.assign(item.url);
    }
  }

  function prefillSyntax(prefix: string) {
    setQuery(prefix);
    requestAnimationFrame(() => {
      const input = commandInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(prefix.length, prefix.length);
    });
  }

  function onCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) setSelectedIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setSelectedIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Tab") {
      const selected = results[selectedIndex];
      if (selected?.id.startsWith("search-shortcut:")) {
        event.preventDefault();
        void executeResult(selected);
      }
      return;
    }
    if (event.key === "Enter") {
      if (!hasQuery) return;
      const selected = results[selectedIndex];
      if (selected) {
        event.preventDefault();
        void executeResult(selected, event.shiftKey || event.metaKey || event.ctrlKey);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else commandInputRef.current?.blur();
    }
  }

  const launcherStatus = loading
    ? tx("Loading…", "加载中…")
    : bridgeConnected
      ? tx(`Browser bridge · ${openTabs.length} open tabs`, `浏览器桥接 · ${openTabs.length} 个标签页`)
      : defaultEngine
        ? tx(`Web mode · ${defaultEngine.name}`, `网页模式 · ${defaultEngine.name}`)
        : tx("Web mode", "网页模式");

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => navigateView("launcher")} aria-label={tx("Dockmark home", "Dockmark 启动台")}>
          <span className="brand-mark">D·</span>
          <span>Dockmark</span>
        </button>
        <nav className="workspace-section-nav" aria-label={tx("Workspace sections", "工作区分区导航")}>
          <button className={`ghost ${view === "launcher" ? "active" : ""}`} type="button" aria-current={view === "launcher" ? "page" : undefined} onClick={() => navigateView("launcher")}>
            {tx("Launcher", "启动台")}
          </button>
          <button className={`ghost ${view === "workspaces" ? "active" : ""}`} type="button" aria-current={view === "workspaces" ? "page" : undefined} onClick={() => navigateView("workspaces")}>
            {tx("Workspaces", "工作区")}
          </button>
          <button className={`ghost ${view === "sessions" ? "active" : ""}`} type="button" aria-current={view === "sessions" ? "page" : undefined} onClick={() => navigateView("sessions")}>
            {tx("Sessions", "会话")}
          </button>
          <button className={`ghost ${view === "bookmarks" ? "active" : ""}`} type="button" aria-current={view === "bookmarks" ? "page" : undefined} onClick={() => navigateView("bookmarks")}>
            {tx("Bookmarks", "书签")}
          </button>
          <button className={`ghost ${view === "search" ? "active" : ""}`} type="button" aria-current={view === "search" ? "page" : undefined} onClick={() => navigateView("search")}>
            {tx("Search", "搜索")}
          </button>
          <button className={`ghost ${view === "transfer" ? "active" : ""}`} type="button" aria-current={view === "transfer" ? "page" : undefined} onClick={() => navigateView("transfer")}>
            {tx("Transfer", "导入导出")}
          </button>
          <button className={`ghost ${view === "extension" ? "active" : ""}`} type="button" aria-current={view === "extension" ? "page" : undefined} onClick={() => navigateView("extension")}>
            {tx("Extension", "扩展")}
          </button>
        </nav>
      </header>

      {view === "workspaces" ? (
        <WorkspaceManager
          workspaces={workspaces}
          bookmarks={bookmarks}
          loading={loading}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectedChange={setSelectedWorkspaceId}
          onChanged={refresh}
        />
      ) : view === "sessions" ? (
        <SessionManager
          sessions={sessions}
          loading={loading}
          selectedSessionId={selectedSessionId}
          onSelectedChange={setSelectedSessionId}
          onChanged={refresh}
        />
      ) : view === "bookmarks" ? (
        <BookmarkManager bookmarks={bookmarks} categories={categories} bookmarkTags={bookmarkTags} loading={loading} onChanged={refresh} />
      ) : view === "search" ? (
        <SearchEngineManager engines={searchEngines} loading={loading} onChanged={refresh} />
      ) : view === "transfer" ? (
        <TransferManager bookmarks={bookmarks} categories={categories} onChanged={refresh} onOpenExtension={() => navigateView("extension")} />
      ) : view === "extension" ? (
        <BrowserExtensionManager />
      ) : (
        <>
          <section className="hero launcher-hero">
            <div className={`command ${bridgeConnected ? "bridge-connected" : ""}`}>
              <span className="search-icon" aria-hidden="true">⌕</span>
              <input
                ref={commandInputRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => void refreshBridge()}
                onKeyDown={onCommandKeyDown}
                placeholder={tx(
                  "Search tabs, Workspaces, Sessions, Collections, bookmarks or #tags…",
                  "搜索标签页、工作区、会话、智能合集、书签或 #标签…",
                )}
                aria-label={tx("Search Dockmark", "搜索 Dockmark")}
                aria-controls={hasQuery ? "dockmark-command-results" : undefined}
                aria-activedescendant={hasQuery && results[selectedIndex] ? `command-result-${selectedIndex}` : undefined}
                role="combobox"
                aria-expanded={hasQuery}
              />
              {hasQuery && (
                <button
                  className="command-clear"
                  type="button"
                  aria-label={tx("Clear search", "清空搜索")}
                  onClick={() => {
                    setQuery("");
                    commandInputRef.current?.focus();
                  }}
                >
                  ×
                </button>
              )}
              <span className="command-shortcuts"><kbd>⌘ K</kbd></span>
            </div>

            <div className="command-syntax-bar">
              <div className="command-syntax-pills" aria-label={tx("Search syntax shortcuts", "搜索语法快捷入口")}>
                <button type="button" className="syntax-pill" onClick={() => prefillSyntax(`!${primaryBangKeyword} `)}>
                  <code>!{primaryBangKeyword}</code>
                  <span>{tx("Search", "搜索")}</span>
                </button>
                <button type="button" className="syntax-pill" onClick={() => prefillSyntax("@")}>
                  <code>@</code>
                  <span>{tx("Collections", "合集")}</span>
                </button>
                <button type="button" className="syntax-pill" onClick={() => prefillSyntax("#")}>
                  <code>#</code>
                  <span>{tx("Tags", "标签")}</span>
                </button>
              </div>
              <span className={`launcher-status-pill ${bridgeConnected ? "connected" : ""}`}>
                <span className="status-dot" aria-hidden="true" />
                {launcherStatus}
              </span>
            </div>
          </section>

          {dataError && (
            <section className="panel launcher-error-panel" role="alert">
              <div className="panel-error">
                <strong>{tx("Dockmark could not reach its database.", "Dockmark 暂时无法连接数据库。")}</strong>
                <span>{dataError}</span>
                <button className="secondary" type="button" onClick={() => void refresh()}>
                  {tx("Retry", "重试")}
                </button>
              </div>
            </section>
          )}

          {hasQuery ? (
            <LauncherCommandPanel
              results={results}
              selectedIndex={selectedIndex}
              bookmarkById={bookmarkById}
              bridgeConnected={bridgeConnected}
              launcherStatus={launcherStatus}
              loading={loading}
              locale={locale}
              onSelectIndex={setSelectedIndex}
              onExecute={executeResult}
            />
          ) : (
            <>
              {!bridgeConnected && (
                <button className="extension-nudge extension-nudge-compact" type="button" onClick={() => navigateView("extension")}>
                  <span className="extension-nudge-copy">
                    <strong>{tx("Browser bridge offline", "浏览器桥接未连接")}</strong>
                    <span>{tx("Install Dockmark Extension for live tabs, pinned sessions and bookmark sync.", "安装 Dockmark 扩展即可解锁打开标签页切换、固定会话恢复与原生书签同步。")}</span>
                  </span>
                  <span className="extension-nudge-action">{tx("Extension →", "安装与诊断 →")}</span>
                </button>
              )}

              <LauncherDashboard
                bookmarks={bookmarks}
                bookmarkTags={bookmarkTags}
                categories={categories}
                smartCollections={smartCollections}
                inboxIds={inboxIds}
                workspaces={workspaces}
                openTabs={openTabs}
                bridgeConnected={bridgeConnected}
                loading={loading}
                onLaunchWorkspace={launchWorkspace}
                onActivateTab={activateTab}
                onOpenView={(target) => navigateView(target)}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
