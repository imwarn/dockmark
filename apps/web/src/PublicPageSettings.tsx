import { useEffect, useMemo, useRef, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { textMatchesQuery } from "./bookmark-search";
import { reorderBookmarks, reorderCategories } from "./reorder-api";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
}

type PublicationFilter = "all" | "published" | "unpublished";

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

function swapIds(ids: string[], leftId: string, rightId: string) {
  const left = ids.indexOf(leftId);
  const right = ids.indexOf(rightId);
  if (left < 0 || right < 0) return ids;
  const next = [...ids];
  [next[left], next[right]] = [next[right]!, next[left]!];
  return next;
}

export function PublicPageSettings({ bookmarks, categories, onChanged }: Props) {
  const [published, setPublishedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState<"publish" | "unpublish" | null>(null);
  const [sorting, setSorting] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PublicationFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectVisibleRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const activeIds = new Set(bookmarks.map((bookmark) => bookmark.id));
    setSelectedIds((current) => new Set([...current].filter((id) => activeIds.has(id))));
  }, [bookmarks]);

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const bookmarksByCategory = useMemo(() => {
    const map = new Map<string, Bookmark[]>();
    for (const bookmark of bookmarks) {
      const key = bookmark.categoryId ?? "";
      const list = map.get(key) ?? [];
      list.push(bookmark);
      map.set(key, list);
    }
    return map;
  }, [bookmarks]);

  const groups = useMemo(() => {
    const categoryGroups = categories.map((category) => ({
      id: category.id,
      name: category.name,
      bookmarks: (bookmarksByCategory.get(category.id) ?? []).filter((bookmark) => published.has(bookmark.id)),
    }));
    const uncategorized = (bookmarksByCategory.get("") ?? []).filter((bookmark) => published.has(bookmark.id));
    return [
      ...categoryGroups.filter((group) => group.bookmarks.length),
      ...(uncategorized.length ? [{ id: "", name: "Elsewhere", bookmarks: uncategorized }] : []),
    ];
  }, [bookmarksByCategory, categories, published]);

  const filteredBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => {
      const isPublished = published.has(bookmark.id);
      if (filter === "published" && !isPublished) return false;
      if (filter === "unpublished" && isPublished) return false;
      const categoryName = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "" : "Uncategorized";
      return textMatchesQuery(query, [
        bookmark.title,
        bookmark.url,
        bookmark.description ?? "",
        categoryName,
      ]);
    }),
    [bookmarks, categoryNameById, filter, published, query],
  );

  const publishedCount = published.size;
  const unpublishedCount = Math.max(0, bookmarks.length - publishedCount);
  const visibleSelectedCount = filteredBookmarks.filter((bookmark) => selectedIds.has(bookmark.id)).length;
  const allVisibleSelected = filteredBookmarks.length > 0 && visibleSelectedCount === filteredBookmarks.length;

  useEffect(() => {
    if (selectVisibleRef.current) {
      selectVisibleRef.current.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
    }
  }, [allVisibleSelected, visibleSelectedCount]);

  async function toggle(bookmark: Bookmark) {
    const nextPublished = !published.has(bookmark.id);
    setBusyId(bookmark.id);
    setError(null);
    setNotice(null);
    try {
      await setPublished(bookmark.id, nextPublished);
      setPublishedIds((current) => {
        const next = new Set(current);
        if (nextPublished) next.add(bookmark.id);
        else next.delete(bookmark.id);
        return next;
      });
      setNotice(`${nextPublished ? "Published" : "Unpublished"} “${bookmark.title}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this bookmark.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    const visibleIds = filteredBookmarks.map((bookmark) => bookmark.id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function updateSelection(nextPublished: boolean) {
    const selected = [...selectedIds];
    if (!selected.length) return;

    const idsToUpdate = selected.filter((id) => published.has(id) !== nextPublished);
    if (!idsToUpdate.length) {
      setSelectedIds(new Set());
      setNotice(nextPublished ? "Every selected bookmark is already published." : "Every selected bookmark is already unpublished.");
      return;
    }

    setBatchBusy(nextPublished ? "publish" : "unpublish");
    setError(null);
    setNotice(null);
    const failedIds = new Set<string>();
    let updated = 0;

    try {
      const chunkSize = 12;
      for (let offset = 0; offset < idsToUpdate.length; offset += chunkSize) {
        const chunk = idsToUpdate.slice(offset, offset + chunkSize);
        const results = await Promise.allSettled(chunk.map((id) => setPublished(id, nextPublished)));
        results.forEach((result, index) => {
          const id = chunk[index];
          if (!id) return;
          if (result.status === "fulfilled") updated += 1;
          else failedIds.add(id);
        });
      }

      setPublishedIds((current) => {
        const next = new Set(current);
        idsToUpdate.forEach((id) => {
          if (failedIds.has(id)) return;
          if (nextPublished) next.add(id);
          else next.delete(id);
        });
        return next;
      });
      setSelectedIds(failedIds);

      if (failedIds.size) {
        setError(`${updated} bookmark${updated === 1 ? "" : "s"} updated; ${failedIds.size} failed and remain selected for retry.`);
      } else {
        setNotice(`${nextPublished ? "Published" : "Unpublished"} ${updated} bookmark${updated === 1 ? "" : "s"}.`);
      }
    } finally {
      setBatchBusy(null);
    }
  }

  async function moveCategory(groupId: string, direction: -1 | 1) {
    if (!groupId) return;
    const publicCategoryIds = groups.map((group) => group.id).filter(Boolean);
    const index = publicCategoryIds.indexOf(groupId);
    const targetId = publicCategoryIds[index + direction];
    if (!targetId) return;
    const allIds = categories.map((category) => category.id);
    setSorting(true);
    setError(null);
    setNotice(null);
    try {
      await reorderCategories(swapIds(allIds, groupId, targetId));
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reorder public categories.");
    } finally {
      setSorting(false);
    }
  }

  async function moveBookmark(bookmark: Bookmark, direction: -1 | 1) {
    const categoryKey = bookmark.categoryId ?? "";
    const publicIds = (bookmarksByCategory.get(categoryKey) ?? [])
      .filter((candidate) => published.has(candidate.id))
      .map((candidate) => candidate.id);
    const index = publicIds.indexOf(bookmark.id);
    const targetId = publicIds[index + direction];
    if (!targetId) return;
    const allIds = (bookmarksByCategory.get(categoryKey) ?? []).map((candidate) => candidate.id);
    setSorting(true);
    setError(null);
    setNotice(null);
    try {
      await reorderBookmarks(bookmark.categoryId ?? null, swapIds(allIds, bookmark.id, targetId));
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reorder public bookmarks.");
    } finally {
      setSorting(false);
    }
  }

  const mutationBusy = Boolean(batchBusy || busyId);

  return (
    <section className="public-settings-section" aria-labelledby="public-settings-title">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">PUBLIC PAGE</p>
          <h2 id="public-settings-title">Publish and arrange the curated view.</h2>
          <p>Public groups reuse the canonical Library category and bookmark order. Reordering here updates that shared order, so Web, New Tab and the public page stay consistent instead of drifting into separate layouts.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{publishedCount} published</strong>
          <a className="text-action" href="/" target="_blank" rel="noreferrer">Open public page ↗</a>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="public-curation-layout">
        <article className="form-card public-layout-card">
          <div className="card-heading">
            <div>
              <h2>Public layout</h2>
              <p>Move published categories and links without leaving Settings.</p>
            </div>
            <span>{groups.length} groups</span>
          </div>

          <div className="public-layout-groups">
            {groups.map((group, groupIndex) => (
              <section className="public-layout-group" key={group.id || "uncategorized"}>
                <header>
                  <div>
                    <strong>{group.name}</strong>
                    <span>{group.bookmarks.length} links</span>
                  </div>
                  {group.id && (
                    <div className="public-order-actions">
                      <button className="text-action" type="button" disabled={sorting || groupIndex === 0} onClick={() => void moveCategory(group.id, -1)}>↑ Group</button>
                      <button className="text-action" type="button" disabled={sorting || groupIndex === groups.length - 1 || !groups[groupIndex + 1]?.id} onClick={() => void moveCategory(group.id, 1)}>↓ Group</button>
                    </div>
                  )}
                </header>

                <div className="public-layout-items">
                  {group.bookmarks.map((bookmark, index) => (
                    <div className="public-layout-item" key={bookmark.id}>
                      <span className="drag-handle" aria-hidden="true">⠿</span>
                      <span>
                        <strong>{bookmark.title}</strong>
                        <small>{bookmark.url}</small>
                      </span>
                      <div className="public-order-actions">
                        <button className="text-action" type="button" disabled={sorting || index === 0} onClick={() => void moveBookmark(bookmark, -1)}>↑</button>
                        <button className="text-action" type="button" disabled={sorting || index === group.bookmarks.length - 1} onClick={() => void moveBookmark(bookmark, 1)}>↓</button>
                        <button className="danger-text text-action" type="button" disabled={busyId === bookmark.id || Boolean(batchBusy)} onClick={() => void toggle(bookmark)}>Unpublish</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {!loading && !groups.length && <p className="empty-copy">Nothing is public yet. Publish bookmarks from the manager beside this preview.</p>}
            {loading && <p className="empty-copy">Loading public selection…</p>}
          </div>
        </article>

        <article className="form-card public-publish-card">
          <div className="card-heading">
            <div>
              <h2>Add to public page</h2>
              <p>Search the full library, filter by publication state, then update one bookmark or a selected batch.</p>
            </div>
            <span>{filteredBookmarks.length} shown</span>
          </div>

          <div className="public-publish-tools">
            <label className="public-publish-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter title, URL, description or category…"
                aria-label="Filter public page bookmarks"
              />
            </label>
            <div className="settings-segmented public-publish-filter" aria-label="Publication status filter">
              <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>All · {bookmarks.length}</button>
              <button className={filter === "published" ? "active" : ""} type="button" onClick={() => setFilter("published")}>Published · {publishedCount}</button>
              <button className={filter === "unpublished" ? "active" : ""} type="button" onClick={() => setFilter("unpublished")}>Unpublished · {unpublishedCount}</button>
            </div>
          </div>

          <div className="public-bulk-bar">
            <label className="public-select-visible">
              <input
                ref={selectVisibleRef}
                type="checkbox"
                checked={allVisibleSelected}
                disabled={!filteredBookmarks.length || mutationBusy}
                onChange={toggleVisibleSelection}
              />
              <span>{allVisibleSelected ? "Clear visible" : "Select visible"}</span>
            </label>
            <span className="public-selected-count">{selectedIds.size} selected</span>
            <div className="public-bulk-actions">
              <button className="secondary" type="button" disabled={!selectedIds.size || mutationBusy} onClick={() => void updateSelection(true)}>
                {batchBusy === "publish" ? "Publishing…" : "Publish"}
              </button>
              <button className="secondary" type="button" disabled={!selectedIds.size || mutationBusy} onClick={() => void updateSelection(false)}>
                {batchBusy === "unpublish" ? "Unpublishing…" : "Unpublish"}
              </button>
              <button className="text-action" type="button" disabled={!selectedIds.size || mutationBusy} onClick={() => setSelectedIds(new Set())}>Clear</button>
            </div>
          </div>

          <div className="public-bookmark-picker public-bookmark-manager">
            {filteredBookmarks.map((bookmark) => {
              const isPublished = published.has(bookmark.id);
              const categoryName = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "Uncategorized" : "Uncategorized";
              return (
                <div className={`public-bookmark-row public-bookmark-manage${isPublished ? " is-published" : ""}`} key={bookmark.id}>
                  <label className="public-bookmark-select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(bookmark.id)}
                      disabled={mutationBusy}
                      onChange={() => toggleSelected(bookmark.id)}
                    />
                    <span>
                      <strong>{bookmark.title}</strong>
                      <small>{categoryName} · {bookmark.url}</small>
                    </span>
                  </label>
                  <em>{isPublished ? "PUBLISHED" : "PRIVATE"}</em>
                  <button
                    className={isPublished ? "danger-text text-action" : "text-action"}
                    type="button"
                    disabled={mutationBusy && busyId !== bookmark.id}
                    onClick={() => void toggle(bookmark)}
                  >
                    {busyId === bookmark.id ? "Saving…" : isPublished ? "Unpublish" : "Publish"}
                  </button>
                </div>
              );
            })}
            {!loading && !filteredBookmarks.length && (
              <p className="empty-copy">{query.trim() ? "No bookmarks match this filter." : "No bookmarks match this publication state."}</p>
            )}
            {loading && <p className="empty-copy">Loading public selection…</p>}
          </div>
        </article>
      </div>
    </section>
  );
}
