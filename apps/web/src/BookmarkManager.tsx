import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import type { Bookmark, Category, CreateBookmarkInput, HealthPolicy, HealthStatus } from "@dockmark/core";
import {
  checkBookmarkHealth,
  createCategory,
  deleteBookmark,
  deleteCategory,
  updateCategory,
} from "./api";
import {
  createBookmarkWithTags,
  parseBookmarkTags,
  updateBookmarkWithTags,
} from "./bookmark-details-api";
import { bookmarkMatchesQuery } from "./bookmark-search";
import { reorderBookmarks, reorderCategories } from "./reorder-api";
import "./health.css";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  bookmarkTags: Record<string, string[]>;
  loading: boolean;
  onChanged: () => Promise<void>;
}

type DraftPolicy = HealthPolicy | "auto";

interface BookmarkDraft {
  title: string;
  url: string;
  description: string;
  categoryId: string;
  healthPolicy: DraftPolicy;
  tagsText: string;
}

interface BookmarkGroup {
  categoryId: string | null;
  name: string;
  bookmarks: Bookmark[];
}

const emptyDraft: BookmarkDraft = {
  title: "",
  url: "",
  description: "",
  categoryId: "",
  healthPolicy: "auto",
  tagsText: "",
};

const healthLabels: Record<HealthStatus, string> = {
  unknown: "Unchecked",
  healthy: "Healthy",
  redirected: "Redirected",
  "auth-required": "Auth required",
  forbidden: "Forbidden",
  "rate-limited": "Rate limited",
  timeout: "Timeout",
  "dns-error": "DNS error",
  "tls-error": "TLS error",
  unavailable: "Unavailable",
  "local-only": "Local only",
  ignored: "Ignored",
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function moveId(ids: string[], movingId: string, targetId: string) {
  if (movingId === targetId) return ids;
  const sourceIndex = ids.indexOf(movingId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return ids;
  const next = ids.filter((id) => id !== movingId);
  const targetIndexAfterRemoval = next.indexOf(targetId);
  if (targetIndexAfterRemoval < 0) return ids;
  const insertIndex = sourceIndex < targetIndex ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
  next.splice(insertIndex, 0, movingId);
  return next;
}

function moveByOffset(ids: string[], id: string, offset: -1 | 1) {
  const index = ids.indexOf(id);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const moving = ids[index];
  const displaced = ids[target];
  if (moving === undefined || displaced === undefined) return ids;
  const next = [...ids];
  next[index] = displaced;
  next[target] = moving;
  return next;
}

function HealthBadge({ bookmark }: { bookmark: Bookmark }) {
  const status = bookmark.healthPolicy === "local-only"
    ? "local-only"
    : bookmark.healthPolicy === "ignore"
      ? "ignored"
      : bookmark.healthStatus;

  return (
    <span className={`health-badge status-${status} policy-${bookmark.healthPolicy}`}>
      {bookmark.healthPolicy === "manual" && status === "unknown" ? "Manual" : healthLabels[status]}
    </span>
  );
}

function BookmarkFields({
  draft,
  categories,
  onChange,
  allowAuto,
}: {
  draft: BookmarkDraft;
  categories: Category[];
  onChange: (draft: BookmarkDraft) => void;
  allowAuto: boolean;
}) {
  return (
    <div className="field-grid bookmark-field-grid">
      <label>
        <span>Title</span>
        <input required maxLength={200} value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} placeholder="GitHub" />
      </label>
      <label>
        <span>URL</span>
        <input required value={draft.url} onChange={(event) => onChange({ ...draft, url: event.target.value })} placeholder="github.com" inputMode="url" />
      </label>
      <label>
        <span>Category</span>
        <select value={draft.categoryId} onChange={(event) => onChange({ ...draft, categoryId: event.target.value })}>
          <option value="">Uncategorized</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      <label>
        <span>Health policy</span>
        <select value={draft.healthPolicy} onChange={(event) => onChange({ ...draft, healthPolicy: event.target.value as DraftPolicy })}>
          {allowAuto && <option value="auto">Auto detect</option>}
          <option value="normal">Normal</option>
          <option value="local-only">Local only</option>
          <option value="ignore">Ignore</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      <label className="field-span-2">
        <span>Description</span>
        <textarea maxLength={2000} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="Optional notes or a concise description used by search." />
      </label>
      <label className="field-span-2">
        <span>Tags</span>
        <input value={draft.tagsText} onChange={(event) => onChange({ ...draft, tagsText: event.target.value })} placeholder="dev, docs, self-hosted" />
        <small className="field-help">Comma, semicolon or newline separated · up to 12 tags · 40 characters each. Invalid input is rejected instead of truncated.</small>
      </label>
    </div>
  );
}

export function BookmarkManager({ bookmarks, categories, bookmarkTags, loading, onChanged }: Props) {
  const [draft, setDraft] = useState<BookmarkDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BookmarkDraft>(emptyDraft);
  const [newCategory, setNewCategory] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set());
  const [bulkChecking, setBulkChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [draggedBookmark, setDraggedBookmark] = useState<{ id: string; categoryId: string | null } | null>(null);

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const tagSummary = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const tags of Object.values(bookmarkTags)) {
      for (const tag of tags) {
        const key = tag.toLocaleLowerCase();
        const current = counts.get(key);
        counts.set(key, { name: current?.name ?? tag, count: (current?.count ?? 0) + 1 });
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [bookmarkTags]);

  const eligibleForAutomaticCheck = useMemo(
    () => bookmarks.filter((bookmark) => bookmark.healthPolicy === "normal"),
    [bookmarks],
  );

  const filteredBookmarks = useMemo(() => bookmarks.filter((bookmark) => {
    const tags = bookmarkTags[bookmark.id] ?? [];
    if (activeTag && !tags.some((tag) => tag.toLocaleLowerCase() === activeTag.toLocaleLowerCase())) return false;
    const categoryName = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "" : "Uncategorized";
    return bookmarkMatchesQuery(bookmark, categoryName, tags, query);
  }), [activeTag, bookmarkTags, bookmarks, categoryNameById, query]);

  const filtering = Boolean(query.trim() || activeTag);

  const bookmarkGroups = useMemo<BookmarkGroup[]>(() => {
    const groups: BookmarkGroup[] = categories.map((category) => ({
      categoryId: category.id,
      name: category.name,
      bookmarks: filteredBookmarks
        .filter((bookmark) => bookmark.categoryId === category.id)
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    }));
    groups.push({
      categoryId: null,
      name: "Uncategorized",
      bookmarks: filteredBookmarks
        .filter((bookmark) => !bookmark.categoryId)
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    });
    return groups.filter((group) => group.bookmarks.length > 0);
  }, [filteredBookmarks, categories]);

  async function refreshAfter(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    let actionError: unknown = null;
    try {
      await action();
    } catch (caught) {
      actionError = caught;
      setError(messageFrom(caught));
    }
    try {
      await onChanged();
    } catch (caught) {
      if (!actionError) setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  async function persistCategoryOrder(ids: string[]) {
    setReordering(true);
    setError(null);
    setNotice(null);
    try {
      await reorderCategories(ids);
      await onChanged();
      setNotice("Category order saved.");
    } catch (caught) {
      setError(messageFrom(caught));
      await onChanged();
    } finally {
      setReordering(false);
    }
  }

  async function persistBookmarkOrder(categoryId: string | null, ids: string[]) {
    if (filtering) return;
    setReordering(true);
    setError(null);
    setNotice(null);
    try {
      await reorderBookmarks(categoryId, ids);
      await onChanged();
      setNotice("Bookmark order saved.");
    } catch (caught) {
      setError(messageFrom(caught));
      await onChanged();
    } finally {
      setReordering(false);
    }
  }

  function beginEdit(bookmark: Bookmark) {
    setEditingId(bookmark.id);
    setEditDraft({
      title: bookmark.title,
      url: bookmark.url,
      description: bookmark.description ?? "",
      categoryId: bookmark.categoryId ?? "",
      healthPolicy: bookmark.healthPolicy,
      tagsText: (bookmarkTags[bookmark.id] ?? []).join(", "),
    });
  }

  async function checkOne(bookmark: Bookmark) {
    if (bookmark.healthPolicy === "ignore" || bookmark.healthPolicy === "local-only") return;
    setError(null);
    setNotice(null);
    setCheckingIds((current) => new Set(current).add(bookmark.id));
    try {
      await checkBookmarkHealth(bookmark.id);
      await onChanged();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setCheckingIds((current) => {
        const next = new Set(current);
        next.delete(bookmark.id);
        return next;
      });
    }
  }

  async function checkEligible() {
    if (!eligibleForAutomaticCheck.length) return;
    setBulkChecking(true);
    setError(null);
    setNotice(null);
    let checked = 0;
    let failed = 0;
    const chunkSize = 4;

    try {
      for (let offset = 0; offset < eligibleForAutomaticCheck.length; offset += chunkSize) {
        const chunk = eligibleForAutomaticCheck.slice(offset, offset + chunkSize);
        setCheckingIds((current) => new Set([...current, ...chunk.map((bookmark) => bookmark.id)]));
        const results = await Promise.allSettled(chunk.map((bookmark) => checkBookmarkHealth(bookmark.id)));
        results.forEach((result) => result.status === "fulfilled" ? checked += 1 : failed += 1);
        setCheckingIds((current) => {
          const next = new Set(current);
          chunk.forEach((bookmark) => next.delete(bookmark.id));
          return next;
        });
      }
      await onChanged();
      setNotice(`Checked ${checked} bookmark${checked === 1 ? "" : "s"}${failed ? `; ${failed} failed to check` : ""}.`);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setCheckingIds(new Set());
      setBulkChecking(false);
    }
  }

  async function submitBookmark(event: FormEvent) {
    event.preventDefault();
    const input: CreateBookmarkInput = {
      title: draft.title,
      url: draft.url,
      categoryId: draft.categoryId || null,
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.healthPolicy !== "auto" ? { healthPolicy: draft.healthPolicy } : {}),
    };
    await refreshAfter(async () => {
      const tags = parseBookmarkTags(draft.tagsText);
      await createBookmarkWithTags(input, tags);
      setDraft(emptyDraft);
      setNotice("Bookmark and tags added atomically.");
    });
  }

  async function submitEdit(event: FormEvent, id: string) {
    event.preventDefault();
    const healthPolicy = editDraft.healthPolicy;
    if (healthPolicy === "auto") return;
    await refreshAfter(async () => {
      const tags = parseBookmarkTags(editDraft.tagsText);
      await updateBookmarkWithTags(id, {
        title: editDraft.title,
        url: editDraft.url,
        description: editDraft.description.trim() || null,
        categoryId: editDraft.categoryId || null,
        healthPolicy,
        tags,
      });
      setEditingId(null);
      setNotice("Bookmark details and tags saved atomically.");
    });
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    await refreshAfter(async () => {
      await createCategory({ name });
      setNewCategory("");
    });
  }

  async function submitCategoryEdit(event: FormEvent, id: string) {
    event.preventDefault();
    const name = editingCategoryName.trim();
    if (!name) return;
    await refreshAfter(async () => {
      await updateCategory(id, { name });
      setEditingCategoryId(null);
      setEditingCategoryName("");
    });
  }

  function categoryDrop(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    if (!draggedCategoryId || draggedCategoryId === targetId || reordering) return;
    const ids = moveId(categories.map((category) => category.id), draggedCategoryId, targetId);
    setDraggedCategoryId(null);
    void persistCategoryOrder(ids);
  }

  function bookmarkDrop(event: DragEvent<HTMLElement>, categoryId: string | null, targetId: string, ids: string[]) {
    event.preventDefault();
    if (filtering || !draggedBookmark || draggedBookmark.categoryId !== categoryId || draggedBookmark.id === targetId || reordering) return;
    const next = moveId(ids, draggedBookmark.id, targetId);
    setDraggedBookmark(null);
    void persistBookmarkOrder(categoryId, next);
  }

  return (
    <section className="management">
      <div className="management-heading">
        <div>
          <p className="eyebrow">BOOKMARK LIBRARY</p>
          <h1>Keep the useful parts<br />of your browser portable.</h1>
        </div>
        <div className="management-summary">
          <span className="library-count">{bookmarks.length} bookmarks · {tagSummary.length} tags</span>
          <button className="secondary" type="button" disabled={bulkChecking || !eligibleForAutomaticCheck.length} onClick={() => void checkEligible()}>
            {bulkChecking ? "Checking…" : `Check ${eligibleForAutomaticCheck.length} eligible`}
          </button>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner health-feedback" role="status">{notice}</div>}

      <div className="management-grid">
        <aside className="manager-sidebar bookmark-sidebar">
          <div className="form-card">
            <div className="card-heading"><h2>Categories</h2><span>{categories.length}</span></div>
            <form className="compact-form" onSubmit={submitCategory}>
              <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="New category" maxLength={80} aria-label="New category name" />
              <button className="secondary" disabled={busy || !newCategory.trim()}>Add</button>
            </form>
            <div className="category-list">
              {categories.map((category, index) => (
                <div
                  className={`category-row reorder-row${draggedCategoryId === category.id ? " is-dragging" : ""}`}
                  key={category.id}
                  draggable={editingCategoryId !== category.id && !reordering}
                  onDragStart={() => setDraggedCategoryId(category.id)}
                  onDragEnd={() => setDraggedCategoryId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => categoryDrop(event, category.id)}
                >
                  {editingCategoryId === category.id ? (
                    <form className="category-edit" onSubmit={(event) => submitCategoryEdit(event, category.id)}>
                      <input autoFocus value={editingCategoryName} onChange={(event) => setEditingCategoryName(event.target.value)} aria-label={`Rename ${category.name}`} />
                      <button className="text-action" disabled={busy}>Save</button>
                      <button className="text-action muted-action" type="button" onClick={() => setEditingCategoryId(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                      <span>{category.icon ?? "#"}</span><strong>{category.name}</strong>
                      <div className="row-actions">
                        <button className="text-action reorder-action" type="button" disabled={reordering || index === 0} aria-label={`Move ${category.name} up`} onClick={() => void persistCategoryOrder(moveByOffset(categories.map((item) => item.id), category.id, -1))}>↑</button>
                        <button className="text-action reorder-action" type="button" disabled={reordering || index === categories.length - 1} aria-label={`Move ${category.name} down`} onClick={() => void persistCategoryOrder(moveByOffset(categories.map((item) => item.id), category.id, 1))}>↓</button>
                        <button className="text-action" type="button" onClick={() => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); }}>Rename</button>
                        <button className="text-action danger-text" type="button" onClick={() => { if (window.confirm(`Delete category “${category.name}”? Its bookmarks will become uncategorized.`)) void refreshAfter(() => deleteCategory(category.id)); }}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {!categories.length && <p className="empty-copy">No categories yet.</p>}
            </div>
          </div>

          <div className="form-card tag-browser-card">
            <div className="card-heading"><div><h2>Tags</h2><p>Filter the library or use #tag in search.</p></div><span>{tagSummary.length}</span></div>
            {activeTag && (
              <button className="active-tag-filter" type="button" onClick={() => setActiveTag(null)}>
                <span>#{activeTag}</span><strong>×</strong>
              </button>
            )}
            <div className="tag-browser-list">
              {tagSummary.map((tag) => (
                <button
                  className={`tag-filter-chip${activeTag?.toLocaleLowerCase() === tag.name.toLocaleLowerCase() ? " active" : ""}`}
                  type="button"
                  key={tag.name.toLocaleLowerCase()}
                  onClick={() => setActiveTag((current) => current?.toLocaleLowerCase() === tag.name.toLocaleLowerCase() ? null : tag.name)}
                >
                  <span>#{tag.name}</span><strong>{tag.count}</strong>
                </button>
              ))}
              {!tagSummary.length && <p className="empty-copy">No tags yet. Add them while editing a bookmark or accept AI suggestions.</p>}
            </div>
          </div>
        </aside>

        <div className="manager-main">
          <div className="form-card bookmark-search-card">
            <div className="bookmark-search-heading">
              <div><strong>Find bookmarks</strong><span>{filteredBookmarks.length} of {bookmarks.length}</span></div>
              {filtering && <button className="text-action" type="button" onClick={() => { setQuery(""); setActiveTag(null); }}>Clear filters</button>}
            </div>
            <div className="bookmark-search-input">
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, URL, description, category or #tag…" aria-label="Search bookmark library" />
            </div>
            <p className="bookmark-search-help">Space-separated terms use AND matching across Library, Launcher and New Tab. Example: <code>github #dev</code>. Reordering is paused while a filter is active.</p>
          </div>

          <form className="form-card bookmark-form" onSubmit={submitBookmark}>
            <div className="card-heading">
              <div><h2>Add bookmark</h2><p>Bare local URLs are automatically protected as local-only. Description and tags become searchable immediately.</p></div>
              <button className="primary" disabled={busy || loading}>Add bookmark</button>
            </div>
            <BookmarkFields draft={draft} categories={categories} onChange={setDraft} allowAuto />
          </form>

          <div className="bookmark-list grouped-bookmark-list">
            {bookmarkGroups.map((group) => {
              const ids = group.bookmarks.map((bookmark) => bookmark.id);
              return (
                <section className="bookmark-group" key={group.categoryId ?? "uncategorized"}>
                  <div className="bookmark-group-heading">
                    <strong>{group.name}</strong>
                    <span>{group.bookmarks.length}</span>
                  </div>
                  <div className="bookmark-group-items">
                    {group.bookmarks.map((bookmark, index) => {
                      const tags = bookmarkTags[bookmark.id] ?? [];
                      return (
                        <article
                          className={`bookmark-card reorder-row${draggedBookmark?.id === bookmark.id ? " is-dragging" : ""}`}
                          key={bookmark.id}
                          draggable={editingId !== bookmark.id && !reordering && !filtering}
                          onDragStart={() => setDraggedBookmark({ id: bookmark.id, categoryId: group.categoryId })}
                          onDragEnd={() => setDraggedBookmark(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => bookmarkDrop(event, group.categoryId, bookmark.id, ids)}
                        >
                          {editingId === bookmark.id ? (
                            <form onSubmit={(event) => submitEdit(event, bookmark.id)}>
                              <BookmarkFields draft={editDraft} categories={categories} onChange={setEditDraft} allowAuto={false} />
                              <div className="edit-actions">
                                <button className="primary" disabled={busy}>Save changes</button>
                                <button className="secondary" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <span className="drag-handle bookmark-drag-handle" aria-hidden="true">⋮⋮</span>
                              <div className="bookmark-icon">{bookmark.title.slice(0, 1).toUpperCase()}</div>
                              <div className="bookmark-details">
                                <div className="bookmark-title-line">
                                  <a href={bookmark.url} target="_blank" rel="noreferrer"><strong>{bookmark.title}</strong></a>
                                  <HealthBadge bookmark={bookmark} />
                                </div>
                                <small>{bookmark.url}</small>
                                {bookmark.description && <p className="bookmark-description">{bookmark.description}</p>}
                                <div className="bookmark-meta-line">
                                  <span className="bookmark-category">{group.name}</span>
                                  {tags.length > 0 && (
                                    <span className="bookmark-tags">
                                      {tags.map((tag) => (
                                        <button type="button" key={tag.toLocaleLowerCase()} onClick={() => setActiveTag(tag)}>#{tag}</button>
                                      ))}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="bookmark-actions">
                                <button className="secondary reorder-button" type="button" disabled={filtering || reordering || index === 0} aria-label={`Move ${bookmark.title} up`} onClick={() => void persistBookmarkOrder(group.categoryId, moveByOffset(ids, bookmark.id, -1))}>↑</button>
                                <button className="secondary reorder-button" type="button" disabled={filtering || reordering || index === group.bookmarks.length - 1} aria-label={`Move ${bookmark.title} down`} onClick={() => void persistBookmarkOrder(group.categoryId, moveByOffset(ids, bookmark.id, 1))}>↓</button>
                                {(bookmark.healthPolicy === "normal" || bookmark.healthPolicy === "manual") && (
                                  <button className="secondary health-check-button" type="button" disabled={checkingIds.has(bookmark.id)} onClick={() => void checkOne(bookmark)}>
                                    {checkingIds.has(bookmark.id) ? "Checking…" : "Check"}
                                  </button>
                                )}
                                <button className="secondary" type="button" onClick={() => beginEdit(bookmark)}>Edit</button>
                                <button className="danger-button" type="button" onClick={() => { if (window.confirm(`Delete “${bookmark.title}”?`)) void refreshAfter(() => deleteBookmark(bookmark.id)); }}>Delete</button>
                              </div>
                            </>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {!loading && !bookmarks.length && (
              <div className="empty-state"><strong>No bookmarks yet.</strong><span>Add the first URL above or import a browser bookmark file.</span></div>
            )}
            {!loading && bookmarks.length > 0 && !filteredBookmarks.length && (
              <div className="empty-state"><strong>No bookmarks match this filter.</strong><span>Try another term, remove the active tag, or clear filters.</span></div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
