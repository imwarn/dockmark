import { useCallback, useEffect, useMemo, useState } from "react";
import { rankCommands, type Bookmark, type Category, type CommandResult } from "@dockmark/core";
import { listBookmarks, listCategories } from "./api";
import { BookmarkManager } from "./BookmarkManager";

const sourceLabel: Record<CommandResult["source"], string> = {
  tab: "Open tab",
  workspace: "Workspace",
  bookmark: "Bookmark",
  navigation: "Navigation",
  search: "Search",
};

const workspacePlaceholder: CommandResult = {
  id: "workspace-dev",
  source: "workspace",
  title: "Development",
  subtitle: "Workspace · coming next",
  score: 24,
};

export function App() {
  const [view, setView] = useState<"launcher" | "bookmarks">("launcher");
  const [query, setQuery] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setDataError(null);
    try {
      const [nextCategories, nextBookmarks] = await Promise.all([
        listCategories(),
        listBookmarks(),
      ]);
      setCategories(nextCategories);
      setBookmarks(nextBookmarks);
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

    const candidates = [workspacePlaceholder, ...bookmarkResults];
    const filtered = normalized
      ? candidates.filter((item) =>
          `${item.title} ${item.subtitle ?? ""}`.toLowerCase().includes(normalized),
        )
      : candidates;

    return rankCommands(filtered).slice(0, 8);
  }, [bookmarks, query]);

  return (
    <main className="shell">
      <header className="topbar">
        <button className="brand brand-button" type="button" onClick={() => setView("launcher")} aria-label="Dockmark home">
          <span className="brand-mark">D·</span>
          <span>Dockmark</span>
        </button>
        <nav>
          <button
            className={`ghost ${view === "launcher" ? "active" : ""}`}
            type="button"
            onClick={() => setView("launcher")}
          >Launcher</button>
          <button className="ghost" type="button" disabled title="Workspaces are next">Workspaces</button>
          <button
            className={`ghost ${view === "bookmarks" ? "active" : ""}`}
            type="button"
            onClick={() => setView("bookmarks")}
          >Bookmarks</button>
          <button className="settings" aria-label="Settings" type="button" title="Settings are coming later">⌘</button>
        </nav>
      </header>

      {view === "bookmarks" ? (
        <BookmarkManager
          bookmarks={bookmarks}
          categories={categories}
          loading={loading}
          onChanged={refresh}
        />
      ) : (
        <>
          <section className="hero">
            <p className="eyebrow">YOUR PERSONAL LAUNCHER</p>
            <h1>Everything you return to,<br />one command away.</h1>
            <div className="command">
              <span className="search-icon">⌕</span>
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search bookmarks, workspaces or the web…"
                aria-label="Search Dockmark"
              />
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
                {results.map((item) => (
                  <a
                    className="result"
                    href={item.url ?? "#"}
                    key={item.id}
                    onClick={(event) => {
                      if (!item.url) event.preventDefault();
                    }}
                  >
                    <span className="favicon">{item.title.slice(0, 1)}</span>
                    <span className="result-copy">
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
                    </span>
                    <span className="pill">{sourceLabel[item.source]}</span>
                  </a>
                ))}
                {!loading && !results.length && (
                  <div className="empty-command">No matching bookmarks yet.</div>
                )}
              </div>
            )}
          </section>

          <section className="feature-grid">
            <article>
              <span>01</span>
              <h2>Bookmarks</h2>
              <p>Import, organize and enrich links without binding your data to one browser.</p>
            </article>
            <article>
              <span>02</span>
              <h2>Workspaces</h2>
              <p>Keep reusable groups of tabs in the cloud and open them from any browser.</p>
            </article>
            <article>
              <span>03</span>
              <h2>Browser bridge</h2>
              <p>Install the optional extension on your main browser to reuse open tabs and native bookmarks.</p>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
