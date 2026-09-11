import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  buildSearchUrl,
  matchingBangEngines,
  parseBangQuery,
  rankCommands,
  type Bookmark,
  type Category,
  type CommandResult,
  type SearchEngine,
  type SessionWithItems,
  type WorkspaceWithItems,
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
import { BookmarkManager } from "./BookmarkManager";
import { SearchEngineManager } from "./SearchEngineManager";
import { SessionManager } from "./SessionManager";
import { TransferManager } from "./TransferManager";
import { WorkspaceManager } from "./WorkspaceManager";

const sourceLabel: Record<CommandResult["source"], string> = {
  tab: "Open tab",
  workspace: "Workspace",
  session: "Session",
  bookmark: "Bookmark",
  navigation: "Navigation",
  search: "Search",
};

type View = "launcher" | "workspaces" | "sessions" | "bookmarks" | "search" | "transfer";

function openUrls(urls: string[]) {
  for (const url of urls) {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  }
}

function hostLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function App() {
  const [view, setView] = useState<View>("launcher");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
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
      const [nextCategories, nextBookmarks, nextWorkspaces, nextSessions, nextSearchEngines] = await Promise.all([
        listCategories(),
        listBookmarks(),
        listWorkspaces(),
        listSessions(),
        listSearchEngines(),
      ]);
      setCategories(nextCategories);
      setBookmarks(nextBookmarks);
      setWorkspaces(nextWorkspaces);
      setSessions(nextSessions);
      setSearchEngines(nextSearchEngines);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Could not load Dockmark data.");
    } finally {
      setLoading(false);
    }
  }, []);

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
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("launcher");
        void refreshBridge();
        requestAnimationFrame(() => commandInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [refreshBridge]);

  const defaultEngine = useMemo(
    () => searchEngines.find((engine) => engine.isDefault) ?? searchEngines[0] ?? null,
    [searchEngines],
  );

  const results = useMemo(() => {
    const trimmed = query.trim();
    const normalized = trimmed.toLowerCase();
    const bang = parseBangQuery(trimmed, searchEngines);

    if (bang) {
      const canRun = Boolean(bang.query);
      return [{
        id: `search-run:${bang.engine.id}`,
        source: "search" as const,
        title: canRun ? `Search ${bang.engine.name} for “${bang.query}”` : `Search with ${bang.engine.name}`,
        subtitle: `!${bang.engine.keyword ?? ""} · ${bang.engine.searchUrl}`,
        ...(canRun ? { url: buildSearchUrl(bang.engine, bang.query) } : {}),
        score: 100,
      }];
    }

    const bangSuggestions = matchingBangEngines(trimmed, searchEngines);
    if (bangSuggestions.length) {
      return bangSuggestions.slice(0, 8).map((engine) => ({
        id: `search-shortcut:${engine.id}`,
        source: "search" as const,
        title: engine.name,
        subtitle: `!${engine.keyword} · type a query`,
        score: 100,
      }));
    }

    const tabCandidates = normalized ? openTabs : openTabs.slice(0, 4);
    const tabResults: CommandResult[] = tabCandidates.map((tab) => ({
      id: `tab:${tab.id}`,
      source: "tab",
      title: tab.title,
      subtitle: `${hostLabel(tab.url)}${tab.pinned ? " · Pinned" : ""}${tab.active ? " · Active" : ""}`,
      url: tab.url,
      score: 40 + (tab.pinned ? 4 : 0) + (tab.active ? 2 : 0),
    }));
    const workspaceResults: CommandResult[] = workspaces.map((workspace) => ({
      id: workspace.id,
      source: "workspace",
      title: workspace.name,
      subtitle: `Open workspace · ${workspace.items.length} tabs`,
      score: 30,
    }));
    const sessionResults: CommandResult[] = sessions.map((session, index) => ({
      id: session.id,
      source: "session",
      title: session.name,
      subtitle: `Restore session · ${session.items.length} tabs${session.sourceDevice ? ` · ${session.sourceDevice}` : ""}`,
      score: Math.max(0, 30 - index),
    }));
    const bookmarkResults: CommandResult[] = bookmarks.map((bookmark) => ({
      id: bookmark.id,
      source: "bookmark",
      title: bookmark.title,
      subtitle: hostLabel(bookmark.url),
      url: bookmark.url,
      score: 30,
    }));

    const localCandidates = [...tabResults, ...workspaceResults, ...sessionResults, ...bookmarkResults];
    const filtered = normalized
      ? localCandidates.filter((item) =>
          `${item.title} ${item.subtitle ?? ""}`.toLowerCase().includes(normalized),
        )
      : localCandidates;
    const localResults = rankCommands(filtered).slice(0, trimmed && defaultEngine ? 7 : 8);

    if (trimmed && defaultEngine) {
      localResults.push({
        id: `search-run:${defaultEngine.id}`,
        source: "search",
        title: `Search ${defaultEngine.name} for “${trimmed}”`,
        subtitle: defaultEngine.keyword ? `Default · !${defaultEngine.keyword}` : "Default search engine",
        url: buildSearchUrl(defaultEngine, trimmed),
        score: 0,
      });
    }

    return localResults;
  }, [bookmarks, defaultEngine, openTabs, query, searchEngines, sessions, workspaces]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= results.length) setSelectedIndex(Math.max(0, results.length - 1));
  }, [results.length, selectedIndex]);

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
      if (!workspace) return;
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
    if (event.key === "Enter") {
      const selected = results[selectedIndex];
      if (selected) {
        event.preventDefault();
        void executeResult(selected, event.shiftKey);
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
    ? "Loading…"
    : bridgeConnected
      ? `Browser bridge · ${openTabs.length} open tabs`
      : defaultEngine
        ? `Web mode · default ${defaultEngine.name}`
        : "Web mode";

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => setView("launcher")} aria-label="Dockmark home">
          <span className="brand-mark">D·</span>
          <span>Dockmark</span>
        </button>
        <nav>
          <button className={`ghost ${view === "launcher" ? "active" : ""}`} type="button" onClick={() => setView("launcher")}>Launcher</button>
          <button className={`ghost ${view === "workspaces" ? "active" : ""}`} type="button" onClick={() => setView("workspaces")}>Workspaces</button>
          <button className={`ghost ${view === "sessions" ? "active" : ""}`} type="button" onClick={() => setView("sessions")}>Sessions</button>
          <button className={`ghost ${view === "bookmarks" ? "active" : ""}`} type="button" onClick={() => setView("bookmarks")}>Bookmarks</button>
          <button className={`ghost ${view === "search" ? "active" : ""}`} type="button" onClick={() => setView("search")}>Search</button>
          <button className={`ghost ${view === "transfer" ? "active" : ""}`} type="button" onClick={() => setView("transfer")}>Transfer</button>
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
        <BookmarkManager bookmarks={bookmarks} categories={categories} loading={loading} onChanged={refresh} />
      ) : view === "search" ? (
        <SearchEngineManager engines={searchEngines} loading={loading} onChanged={refresh} />
      ) : view === "transfer" ? (
        <TransferManager bookmarks={bookmarks} categories={categories} onChanged={refresh} />
      ) : (
        <>
          <section className="hero">
            <p className="eyebrow">YOUR PERSONAL LAUNCHER</p>
            <h1>Everything you return to,<br />one command away.</h1>
            <div className={`command ${bridgeConnected ? "bridge-connected" : ""}`}>
              <span className="search-icon">⌕</span>
              <input
                ref={commandInputRef}
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => void refreshBridge()}
                onKeyDown={onCommandKeyDown}
                placeholder="Search open tabs, Dockmark or type !g, !gh, !ddg…"
                aria-label="Search Dockmark"
                aria-controls="dockmark-command-results"
                aria-activedescendant={results[selectedIndex] ? `command-result-${selectedIndex}` : undefined}
                role="combobox"
                aria-expanded="true"
              />
              <span className="command-shortcuts"><kbd>⌘ K</kbd></span>
            </div>
          </section>

          <section className="panel" aria-label="Command results">
            <div className="panel-heading">
              <span>{query ? "Command results" : "Quick access"}</span>
              <span className={`muted bridge-label ${bridgeConnected ? "connected" : ""}`}>{launcherStatus}</span>
            </div>
            {dataError ? (
              <div className="panel-error">
                <strong>Dockmark could not reach its database.</strong>
                <span>{dataError}</span>
                <button className="secondary" type="button" onClick={() => void refresh()}>Retry</button>
              </div>
            ) : (
              <div className="results" id="dockmark-command-results" role="listbox">
                {results.map((item, index) => (
                  <button
                    className={`result result-button ${selectedIndex === index ? "selected" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={selectedIndex === index}
                    id={`command-result-${index}`}
                    key={`${item.source}-${item.id}`}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => void executeResult(item)}
                  >
                    <span className="favicon">{item.source === "tab" ? "↗" : item.source === "session" ? "↺" : item.source === "search" ? "⌕" : item.title.slice(0, 1)}</span>
                    <span className="result-copy">
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
                    </span>
                    <span className="pill">{item.source === "search" && item.id.startsWith("search-shortcut:") ? <span className="bang-token">Bang</span> : sourceLabel[item.source]}</span>
                  </button>
                ))}
                {!loading && !results.length && <div className="empty-command">No matches. Configure a search engine or try another query.</div>}
              </div>
            )}
            <div className="command-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> select <kbd>Enter</kbd> run</span>
              <span><kbd>Shift</kbd>+<kbd>Enter</kbd> new tab <kbd>Esc</kbd> clear</span>
            </div>
          </section>

          <section className="feature-grid">
            <article><span>01</span><h2>Open tabs</h2><p>With the browser bridge connected, jump to an existing tab before creating another copy.</p></article>
            <article><span>02</span><h2>Smart workspaces</h2><p>Workspace reuse and pinned modes become real browser actions while Web mode stays portable.</p></article>
            <article><span>03</span><h2>Cross-browser fallback</h2><p>Without the extension, the same launcher, workspaces, sessions and search still work normally.</p></article>
          </section>
        </>
      )}
    </main>
  );
}
