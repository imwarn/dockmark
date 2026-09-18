import { useEffect, useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { reorderBookmarks, reorderCategories } from "./reorder-api";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
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
  const [sorting, setSorting] = useState(false);
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

  const unpublished = useMemo(
    () => bookmarks.filter((bookmark) => !published.has(bookmark.id)),
    [bookmarks, published],
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

  async function moveCategory(groupId: string, direction: -1 | 1) {
    if (!groupId) return;
    const publicCategoryIds = groups.map((group) => group.id).filter(Boolean);
    const index = publicCategoryIds.indexOf(groupId);
    const targetId = publicCategoryIds[index + direction];
    if (!targetId) return;
    const allIds = categories.map((category) => category.id);
    setSorting(true);
    setError(null);
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
    try {
      await reorderBookmarks(bookmark.categoryId ?? null, swapIds(allIds, bookmark.id, targetId));
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reorder public bookmarks.");
    } finally {
      setSorting(false);
    }
  }

  return (
    <section className="public-settings-section" aria-labelledby="public-settings-title">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">PUBLIC PAGE</p>
          <h2 id="public-settings-title">Publish and arrange the curated view.</h2>
          <p>Public groups reuse the canonical Library category and bookmark order. Reordering here updates that shared order, so Web, New Tab and the public page stay consistent instead of drifting into separate layouts.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{published.size} published</strong>
          <a className="text-action" href="/" target="_blank" rel="noreferrer">Open public page ↗</a>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

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
                        <button className="danger-text text-action" type="button" disabled={busyId === bookmark.id} onClick={() => void toggle(bookmark)}>Unpublish</button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {!loading && !groups.length && <p className="empty-copy">Nothing is public yet. Publish bookmarks from the list beside this preview.</p>}
            {loading && <p className="empty-copy">Loading public selection…</p>}
          </div>
        </article>

        <article className="form-card public-publish-card">
          <div className="card-heading">
            <div>
              <h2>Add to public page</h2>
              <p>Private bookmarks remain private until explicitly published.</p>
            </div>
            <span>{unpublished.length}</span>
          </div>
          <div className="public-bookmark-picker">
            {unpublished.map((bookmark) => (
              <button
                className="public-bookmark-row public-bookmark-add"
                type="button"
                key={bookmark.id}
                disabled={loading || busyId === bookmark.id}
                onClick={() => void toggle(bookmark)}
              >
                <span>
                  <strong>{bookmark.title}</strong>
                  <small>{categories.find((category) => category.id === bookmark.categoryId)?.name ?? "Uncategorized"} · {bookmark.url}</small>
                </span>
                <em>＋ PUBLISH</em>
              </button>
            ))}
            {!loading && !unpublished.length && <p className="empty-copy">Every active bookmark is currently published.</p>}
          </div>
        </article>
      </div>
    </section>
  );
}
