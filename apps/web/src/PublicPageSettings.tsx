import { useEffect, useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
}

async function loadSelection() {
  const response = await fetch("/api/public/bookmarks/selection", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { bookmarkIds?: string[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Could not load public selection (${response.status}).`);
  return new Set(Array.isArray(payload.bookmarkIds) ? payload.bookmarkIds : []);
}

async function setPublished(id: string, published: boolean) {
  const response = await fetch(`/api/public/bookmarks/${encodeURIComponent(id)}`, {
    method: published ? "PUT" : "DELETE",
  });
  if (response.status === 204) return;
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Could not update public page (${response.status}).`);
}

export function PublicPageSettings({ bookmarks, categories }: Props) {
  const [published, setPublishedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSelection()
      .then((ids) => {
        if (!cancelled) setPublishedIds(ids);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load public page settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  async function toggle(bookmark: Bookmark) {
    const nextPublished = !published.has(bookmark.id);
    setBusyId(bookmark.id);
    setError(null);
    try {
      await setPublished(bookmark.id, nextPublished);
      setPublishedIds((current) => {
        const next = new Set(current);
        if (nextPublished) next.add(bookmark.id);
        else next.delete(bookmark.id);
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this bookmark.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="public-settings-section" aria-labelledby="public-settings-title">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">PUBLIC PAGE</p>
          <h2 id="public-settings-title">Curate what visitors can see.</h2>
          <p>The public homepage exposes only the bookmarks selected here. Workspaces, Sessions, settings and private bookmarks remain behind authentication.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{published.size} published</strong>
          <a className="text-action" href="/" target="_blank" rel="noreferrer">Open public page ↗</a>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      <article className="form-card settings-card settings-card-wide">
        <div className="public-bookmark-picker">
          {bookmarks.map((bookmark) => {
            const checked = published.has(bookmark.id);
            return (
              <label className="public-bookmark-row" key={bookmark.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={loading || busyId === bookmark.id}
                  onChange={() => void toggle(bookmark)}
                />
                <span>
                  <strong>{bookmark.title}</strong>
                  <small>{categoryNames.get(bookmark.categoryId ?? "") ?? "Uncategorized"} · {bookmark.url}</small>
                </span>
                <em>{checked ? "PUBLIC" : "PRIVATE"}</em>
              </label>
            );
          })}
          {!loading && !bookmarks.length && <p className="empty-copy">Add bookmarks first, then choose which ones belong on the public page.</p>}
          {loading && <p className="empty-copy">Loading public selection…</p>}
        </div>
      </article>
    </section>
  );
}
