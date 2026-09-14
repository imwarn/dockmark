import { useEffect, useMemo, useState } from "react";
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

function hostLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function PublicPage() {
  const [bookmarks, setBookmarks] = useState<PublicBookmark[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load public bookmarks.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        name: bookmark.category?.name ?? "Elsewhere",
        ...(bookmark.category?.icon ? { icon: bookmark.category.icon } : {}),
        items: [],
      };
      current.items.push(bookmark);
      map.set(key, current);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <main className="public-shell">
      <header className="public-topbar">
        <a className="public-brand" href="/" aria-label="Dockmark public home"><span>D·</span><strong>Dockmark</strong></a>
        <a className="public-manage" href="/app">Private workspace →</a>
      </header>

      <section className="public-hero">
        <p className="eyebrow">CURATED LINKS</p>
        <h1>A smaller web,<br />worth returning to.</h1>
        <p className="public-intro">A deliberately public slice of this Dockmark. Private bookmarks, Workspaces, Sessions and browser controls stay behind sign-in.</p>
        <label className="public-search">
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter this public list…" autoFocus />
        </label>
      </section>

      {error && <div className="public-message public-error">{error}</div>}
      {!error && loading && <div className="public-message">Loading curated links…</div>}

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
                  <a className="public-card" href={bookmark.url} target="_blank" rel="noreferrer" key={bookmark.id}>
                    <span className="public-card-icon">{bookmark.title.slice(0, 1).toUpperCase()}</span>
                    <span className="public-card-copy">
                      <strong>{bookmark.title}</strong>
                      <small>{bookmark.description || hostLabel(bookmark.url)}</small>
                    </span>
                    <span className="public-card-arrow">↗</span>
                  </a>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}

      {!loading && !error && !groups.length && (
        <section className="public-empty">
          <strong>{query ? "No public links match that filter." : "Nothing is public yet."}</strong>
          <span>{query ? "Try another term." : "The owner can publish selected bookmarks from Settings."}</span>
        </section>
      )}

      <footer className="public-footer"><span>Dockmark · public view</span><a href="/app">Owner sign in</a></footer>
    </main>
  );
}
