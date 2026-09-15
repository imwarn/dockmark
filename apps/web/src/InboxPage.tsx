import { useEffect, useMemo, useState } from "react";
import type { Category } from "@dockmark/core";
import {
  listCategories,
  refreshBookmarkMetadata,
  updateBookmark,
  type BookmarkMetadata,
} from "./api";
import { listInbox, resolveInboxBookmark, type InboxBookmark } from "./inbox-api";

type MetadataField = "title" | "description" | "canonicalUrl" | "iconUrl";
type MetadataSelection = Record<MetadataField, boolean>;

function emptyMetadataSelection(): MetadataSelection {
  return {
    title: false,
    description: false,
    canonicalUrl: false,
    iconUrl: false,
  };
}

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

function selectionCount(selection: MetadataSelection | undefined) {
  return selection ? Object.values(selection).filter(Boolean).length : 0;
}

export function InboxPage() {
  const [bookmarks, setBookmarks] = useState<InboxBookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [metadataById, setMetadataById] = useState<Record<string, BookmarkMetadata | null>>({});
  const [metadataSelections, setMetadataSelections] = useState<Record<string, MetadataSelection>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metadataBusyId, setMetadataBusyId] = useState<string | null>(null);
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

  async function fetchMetadata(bookmark: InboxBookmark) {
    if (bookmark.healthPolicy === "local-only") return;
    setMetadataBusyId(bookmark.id);
    setError(null);
    setNotice(null);
    try {
      const metadata = await refreshBookmarkMetadata(bookmark.id);
      setMetadataById((current) => ({ ...current, [bookmark.id]: metadata }));
      setMetadataSelections((current) => ({ ...current, [bookmark.id]: emptyMetadataSelection() }));
      setNotice(`Metadata refreshed for “${bookmark.title}”. Nothing was applied automatically.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not fetch bookmark metadata.");
    } finally {
      setMetadataBusyId(null);
    }
  }

  function toggleMetadata(bookmarkId: string, field: MetadataField) {
    setMetadataSelections((current) => {
      const selection = current[bookmarkId] ?? emptyMetadataSelection();
      return {
        ...current,
        [bookmarkId]: {
          ...selection,
          [field]: !selection[field],
        },
      };
    });
  }

  async function review(bookmark: InboxBookmark) {
    setBusyId(bookmark.id);
    setError(null);
    setNotice(null);
    try {
      const categoryId = categoryDrafts[bookmark.id] || null;
      const metadata = metadataById[bookmark.id];
      const selection = metadataSelections[bookmark.id] ?? emptyMetadataSelection();
      const input: Parameters<typeof updateBookmark>[1] = {};

      if (selection.title && metadata?.title && metadata.title !== bookmark.title) {
        if (metadata.title.length > 200) {
          throw new Error("The suggested metadata title is longer than Dockmark's 200-character bookmark title limit.");
        }
        input.title = metadata.title;
      }
      if (selection.description && metadata?.description && metadata.description !== bookmark.description) {
        input.description = metadata.description;
      }
      if (selection.canonicalUrl && metadata?.canonicalUrl && metadata.canonicalUrl !== bookmark.url) {
        input.url = metadata.canonicalUrl;
      }
      if (selection.iconUrl && metadata?.iconUrl && metadata.iconUrl !== bookmark.iconUrl) {
        input.iconUrl = metadata.iconUrl;
      }

      if (Object.keys(input).length) {
        await updateBookmark(bookmark.id, input);
      }
      await resolveInboxBookmark(bookmark.id, categoryId);
      setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
      setMetadataById((current) => {
        const next = { ...current };
        delete next[bookmark.id];
        return next;
      });
      setMetadataSelections((current) => {
        const next = { ...current };
        delete next[bookmark.id];
        return next;
      });
      const categoryName = categoryId ? categoryById.get(categoryId) ?? "selected category" : "Uncategorized";
      const applied = Object.keys(input).length;
      setNotice(
        applied
          ? `Reviewed “${bookmark.title}” with ${applied} metadata suggestion${applied === 1 ? "" : "s"} → ${categoryName}.`
          : `Reviewed “${bookmark.title}” → ${categoryName}.`,
      );
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
          <p>Tabs saved from the Dockmark extension land here as a review state, not as a special category. Public pages can optionally fetch metadata suggestions; nothing changes until you explicitly select fields and file the item.</p>
        </div>
        <div className="inbox-count" aria-label={`${bookmarks.length} Inbox bookmarks`}>
          <strong>{bookmarks.length}</strong>
          <span>waiting</span>
        </div>
      </section>

      {(notice || error) && <div className={`inbox-notice ${error ? "error" : "success"}`}>{error ?? notice}</div>}

      <section className="inbox-panel">
        <div className="inbox-panel-heading">
          <div><strong>Captured bookmarks</strong><span>Exact URL duplicates are rejected before a second bookmark is created. Metadata stays behind the same review gate.</span></div>
          <button className="secondary" type="button" disabled={loading || busyId !== null || metadataBusyId !== null} onClick={() => void refresh()}>Refresh</button>
        </div>

        {loading ? (
          <div className="inbox-empty">Loading Inbox…</div>
        ) : bookmarks.length ? (
          <div className="inbox-list">
            {bookmarks.map((bookmark) => {
              const metadata = metadataById[bookmark.id] ?? null;
              const selection = metadataSelections[bookmark.id] ?? emptyMetadataSelection();
              const selectedMetadataCount = selectionCount(selection);
              const metadataBusy = metadataBusyId === bookmark.id;
              const titleAvailable = Boolean(metadata?.title && metadata.title !== bookmark.title && metadata.title.length <= 200);
              const descriptionAvailable = Boolean(metadata?.description && metadata.description !== bookmark.description);
              const canonicalAvailable = Boolean(metadata?.canonicalUrl && metadata.canonicalUrl !== bookmark.url);
              const iconAvailable = Boolean(metadata?.iconUrl && metadata.iconUrl !== bookmark.iconUrl);

              return (
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
                    <button className="primary" type="button" disabled={busyId !== null || metadataBusyId !== null} onClick={() => void review(bookmark)}>
                      {busyId === bookmark.id
                        ? "Filing…"
                        : selectedMetadataCount
                          ? `Apply ${selectedMetadataCount} + file`
                          : "Review & file"}
                    </button>
                  </div>

                  <section className="inbox-metadata-review" aria-label={`Metadata suggestions for ${bookmark.title}`}>
                    <div className="inbox-metadata-heading">
                      <div>
                        <strong>Page metadata suggestions</strong>
                        <span>
                          {bookmark.healthPolicy === "local-only"
                            ? "Local/private metadata stays disabled on the server."
                            : "Fetch is read-only for the bookmark. Select individual fields to apply only when you file this Inbox item."}
                        </span>
                      </div>
                      <button
                        className="secondary"
                        type="button"
                        disabled={busyId !== null || metadataBusyId !== null || bookmark.healthPolicy === "local-only"}
                        onClick={() => void fetchMetadata(bookmark)}
                      >
                        {bookmark.healthPolicy === "local-only"
                          ? "Server metadata disabled"
                          : metadataBusy
                            ? "Fetching…"
                            : metadata
                              ? "Refresh metadata"
                              : "Fetch metadata"}
                      </button>
                    </div>

                    {metadata && (
                      <div className="inbox-metadata-fields">
                        <label className={`inbox-metadata-field${titleAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.title && titleAvailable} disabled={!titleAvailable || busyId !== null} onChange={() => toggleMetadata(bookmark.id, "title")} />
                          <span><small>Title</small><strong>{metadata.title ?? "Not provided"}</strong></span>
                          <em>{metadata.title && metadata.title.length > 200 ? "Too long to apply" : titleAvailable ? "Apply on file" : "Already matches / unavailable"}</em>
                        </label>
                        <label className={`inbox-metadata-field${descriptionAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.description && descriptionAvailable} disabled={!descriptionAvailable || busyId !== null} onChange={() => toggleMetadata(bookmark.id, "description")} />
                          <span><small>Description</small><strong>{metadata.description ?? "Not provided"}</strong></span>
                          <em>{descriptionAvailable ? "Apply on file" : "Already matches / unavailable"}</em>
                        </label>
                        <label className={`inbox-metadata-field${canonicalAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.canonicalUrl && canonicalAvailable} disabled={!canonicalAvailable || busyId !== null} onChange={() => toggleMetadata(bookmark.id, "canonicalUrl")} />
                          <span><small>Canonical URL</small><strong>{metadata.canonicalUrl ?? "Not provided"}</strong></span>
                          <em>{canonicalAvailable ? "Replace URL on file" : "Already matches / unavailable"}</em>
                        </label>
                        <label className={`inbox-metadata-field${iconAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.iconUrl && iconAvailable} disabled={!iconAvailable || busyId !== null} onChange={() => toggleMetadata(bookmark.id, "iconUrl")} />
                          <span><small>Favicon</small><strong>{metadata.iconUrl ?? "Not provided"}</strong></span>
                          <em>{iconAvailable ? "Apply on file" : "Already matches / unavailable"}</em>
                        </label>
                        {metadata.finalUrl && metadata.finalUrl !== bookmark.url && (
                          <div className="inbox-metadata-info">
                            <span><small>Resolved URL</small><strong>{metadata.finalUrl}</strong></span>
                            <em>Informational only · redirects are not treated as canonical</em>
                          </div>
                        )}
                        <div className="inbox-metadata-footnote">Fetched {dateLabel(metadata.fetchedAt)} · suggestions remain separate until Review &amp; file.</div>
                      </div>
                    )}
                  </section>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="inbox-empty">
            <strong>Inbox is clear.</strong>
            <span>Use the paired Dockmark extension → Save current tab or Reviewed multi-tab capture to collect the next pages.</span>
          </div>
        )}
      </section>
    </main>
  );
}
