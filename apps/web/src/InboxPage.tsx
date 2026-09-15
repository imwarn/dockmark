import { useEffect, useMemo, useState } from "react";
import type { Category } from "@dockmark/core";
import { listCategories } from "./api";
import { listInbox, resolveInboxBookmark, type InboxBookmark } from "./inbox-api";

function hostLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function InboxPage() {
  const [bookmarks, setBookmarks] = useState<InboxBookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextInbox, nextCategories] = await Promise.all([listInbox(), listCategories()]);
      setBookmarks(nextInbox);
      setCategories(nextCategories);
      setCategoryDrafts((current) => {
        const next: Record<string, string> = {};
        for (const bookmark of nextInbox) {
          next[bookmark.id] = current[bookmark.id] ?? bookmark.categoryId ?? "";
        }
        return next;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Inbox.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function review(bookmark: InboxBookmark) {
    setBusyId(bookmark.id);
    setError(null);
    setNotice(null);
    try {
      const categoryId = categoryDrafts[bookmark.id] || null;
      await resolveInboxBookmark(bookmark.id, categoryId);
      setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
      const categoryName = categoryId ? categoryById.get(categoryId) ?? "selected category" : "Uncategorized";
      setNotice(`Reviewed “${bookmark.title}” → ${categoryName}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not review Inbox bookmark.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="inbox-shell">
      <section className="inbox-hero">
        <div>
          <p className="eyebrow">QUICK CAPTURE</p>
          <h1>Inbox</h1>
          <p>Tabs saved from the Dockmark extension land here as a review state, not as a special category. Choose a category or keep an item uncategorized, then file it into your library.</p>
        </div>
        <div className="inbox-count" aria-label={`${bookmarks.length} Inbox bookmarks`}>
          <strong>{bookmarks.length}</strong>
          <span>waiting</span>
        </div>
      </section>

      {(notice || error) && <div className={`inbox-notice ${error ? "error" : "success"}`}>{error ?? notice}</div>}

      <section className="inbox-panel">
        <div className="inbox-panel-heading">
          <div><strong>Captured bookmarks</strong><span>Exact URL duplicates are rejected before a second bookmark is created.</span></div>
          <button className="secondary" type="button" disabled={loading || busyId !== null} onClick={() => void refresh()}>Refresh</button>
        </div>

        {loading ? (
          <div className="inbox-empty">Loading Inbox…</div>
        ) : bookmarks.length ? (
          <div className="inbox-list">
            {bookmarks.map((bookmark) => (
              <article className="inbox-row" key={bookmark.id}>
                <div className="inbox-copy">
                  <div className="inbox-title-line">
                    <a href={bookmark.url} target="_blank" rel="noreferrer">{bookmark.title}</a>
                    <span>{bookmark.healthPolicy === "local-only" ? "Local only" : "Captured"}</span>
                  </div>
                  <div className="inbox-meta">
                    <span>{hostLabel(bookmark.url)}</span>
                    <span>Captured {dateLabel(bookmark.inboxAt)}</span>
                    {bookmark.categoryId && <span>Currently {bookmark.categoryName ?? categoryById.get(bookmark.categoryId) ?? "categorized"}</span>}
                  </div>
                  {bookmark.description && <p>{bookmark.description}</p>}
                </div>
                <div className="inbox-review">
                  <label>
                    <span>File to</span>
                    <select
                      value={categoryDrafts[bookmark.id] ?? bookmark.categoryId ?? ""}
                      disabled={busyId === bookmark.id}
                      onChange={(event) => setCategoryDrafts((current) => ({ ...current, [bookmark.id]: event.target.value }))}
                    >
                      <option value="">Uncategorized</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <button className="primary" type="button" disabled={busyId !== null} onClick={() => void review(bookmark)}>
                    {busyId === bookmark.id ? "Filing…" : "Review & file"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="inbox-empty">
            <strong>Inbox is clear.</strong>
            <span>Use the paired Dockmark extension → Save current tab to capture the next page.</span>
          </div>
        )}
      </section>
    </main>
  );
}
