import { useMemo, useState } from "react";
import { rankCommands, type CommandResult } from "@dockmark/core";

const demoResults: CommandResult[] = [
  {
    id: "workspace-dev",
    source: "workspace",
    title: "Development",
    subtitle: "Workspace · 5 links",
    score: 24,
  },
  {
    id: "bookmark-github",
    source: "bookmark",
    title: "GitHub",
    subtitle: "github.com",
    url: "https://github.com",
    score: 30,
  },
  {
    id: "bookmark-cf",
    source: "bookmark",
    title: "Cloudflare Dashboard",
    subtitle: "dash.cloudflare.com",
    url: "https://dash.cloudflare.com",
    score: 25,
  },
  {
    id: "local-dev",
    source: "bookmark",
    title: "Local development",
    subtitle: "localhost:3000 · local-only health",
    url: "http://localhost:3000",
    score: 15,
  },
];

const sourceLabel: Record<CommandResult["source"], string> = {
  tab: "Open tab",
  workspace: "Workspace",
  bookmark: "Bookmark",
  navigation: "Navigation",
  search: "Search",
};

export function App() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const candidates = normalized
      ? demoResults.filter((item) =>
          `${item.title} ${item.subtitle ?? ""}`.toLowerCase().includes(normalized),
        )
      : demoResults;

    return rankCommands(candidates).slice(0, 6);
  }, [query]);

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Dockmark home">
          <span className="brand-mark">D·</span>
          <span>Dockmark</span>
        </a>
        <nav>
          <button className="ghost">Workspaces</button>
          <button className="ghost">Bookmarks</button>
          <button className="settings" aria-label="Settings">⌘</button>
        </nav>
      </header>

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
          <span className="muted">Web mode</span>
        </div>
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
        </div>
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
    </main>
  );
}
