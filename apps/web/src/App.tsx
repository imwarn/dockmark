import { useCallback, useEffect, useMemo, useState } from "react";
import {
  rankCommands,
  type Bookmark,
  type Category,
  type CommandResult,
  type WorkspaceWithItems,
} from "@dockmark/core";
import { listBookmarks, listCategories, listWorkspaces } from "./api";
import { BookmarkManager } from "./BookmarkManager";
import { TransferManager } from "./TransferManager";
import { WorkspaceManager } from "./WorkspaceManager";

const sourceLabel: Record<CommandResult["source"], string> = {
  tab: "Open tab",
  workspace: "Workspace",
  bookmark: "Bookmark",
  navigation: "Navigation",
  search: "Search",
};

type View = "launcher" | "workspaces" | "bookmarks" | "transfer";

export function App() {
  const [view, setView] = useState<View>("launcher");
  const [query, setQuery] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithItems[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setDataError(null);
    try {
      const [nextCategories, nextBookmarks, nextWorkspaces] = await Promise.all([
        listCategories(),
        listBookmarks(),
        listWorkspaces(),
      ]);
      setCategories(nextCategories);
      setBookmarks(nextBookmarks);
      setWorkspaces(nextWorkspaces);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Could not load Dockmark data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const workspaceResults: CommandResult[] = workspaces.map((workspace) => ({
      id: workspace.id,
      source: "workspace",
      title: workspace.name,
      subtitle: `Workspace · ${workspace.items.length} tabs`,
      score: 30,
    }));
    const bookmarkResults: CommandResult[] = bookmarks.map((bookmark) => ({
      id: bookmark.id,
      source: "bookmark",
      title: bookmark.title,
      subtitle: (() => {
        try {
          return new URL(bookmark.url).host;
        } catch {
          return bookmark.url;
        }
      })(),
      url: bookmark.url,
      score: 30,
    }));

    const candidates = [...workspaceResults, ...bookmarkResults];
    const filtered = normalized
      ? candidates.filter((item) =>
          `${item.title} ${item.subtitle ?? ""}`.toLowerCase().includes(normalized),
        )
      : candidates;

    return rankCommands(filtered).slice(0, 8);
  }, [bookmarks, query, workspaces]);

  function activateResult(item: CommandResult) {
    if (item.source === "workspace") {
      setSelectedWorkspaceId(item.id);
      setView("workspaces");
    }
  }

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
          <button className={`ghost ${view === "bookmarks" ? "active" : ""}`} type="button" onClick={() => setView("bookmarks")}>Bookmarks</button>
          <button className={`ghost ${view === "transfer" ? "active" : ""}`} type="button" onClick={() => setView("transfer")}>Transfer</button>
          <button className="settings" aria-label="Settings" type="button" title="Settings are coming later">⌘</button>
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
      ) : view === "bookmarks" ? (
        <BookmarkManager bookmarks={bookmarks} categories={categories} loading={loading} onChanged={refresh} />
      ) : view === "transfer" ? (
        <TransferManager bookmarks={bookmarks} categories={categories} onChanged={refresh} />
      ) : (
        <>
          <section className="hero">
            <p className="eyebrow">YOUR PERSONAL LAUNCHER</p>
            <h1>Everything you return to,<br />one command away.</h1>
            <div className="command">
              <span className="search-icon">⌕</span>
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search bookmarks, workspaces or the web…" aria-label="Search Dockmark" />
              <kbd>⌘ K</kbd>
            </div>
          </section>

          <section className="panel" aria-label="Command results">
            <div className="panel-heading">
              <span>{query ? "Matches" : "Quick access"}</span>
              <span className="muted">{loading ? "Loading…" : "Web mode"}</span>
            </div>
            {dataError ? (
              <div className="panel-error">
                <strong>Dockmark could not reach its database.</strong>
                <span>{dataError}</span>
                <button className="secondary" type="button" onClick={() => void refresh()}>Retry</button>
              </div>
            ) : (
              <div className="results">
                {results.map((item) => item.source === "workspace" ? (
                  <button className="result result-button" type="button" key={`${item.source}-${item.id}`} onClick={() => activateResult(item)}>
                    <span className="favicon">{item.title.slice(0, 1)}</span>
                    <span className="result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                    <span className="pill">{sourceLabel[item.source]}</span>
                  </button>
                ) : (
                  <a className="result" href={item.url ?? "#"} key={`${item.source}-${item.id}`} onClick={(event) => { if (!item.url) event.preventDefault(); }}>
                    <span className="favicon">{item.title.slice(0, 1)}</span>
                    <span className="result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                    <span className="pill">{sourceLabel[item.source]}</span>
                  </a>
                ))}
                {!loading && !results.length && <div className="empty-command">No matching bookmarks or workspaces yet.</div>}
              </div>
            )}
          </section>

          <section className="feature-grid">
            <article><span>01</span><h2>Bookmarks</h2><p>Import, organize and enrich links without binding your data to one browser.</p></article>
            <article><span>02</span><h2>Workspaces</h2><p>Keep reusable groups of tabs in the cloud and open them from any browser.</p></article>
            <article><span>03</span><h2>Browser bridge</h2><p>Install the optional extension on your main browser to reuse open tabs and native bookmarks.</p></article>
          </section>
        </>
      )}
    </main>
  );
}
