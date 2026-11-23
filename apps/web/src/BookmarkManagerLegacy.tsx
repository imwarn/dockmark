/**
 * [INPUT]: depends on useEffect, useMemo, useState from react; Bookmark, Category, CreateBookmarkInput from @dockmark/core; bookmark/category APIs from ./api, ./bookmark-details-api, ./bookmark-search, ./reorder-api; useI18n from ./i18n; BookmarkFavicon, BookmarkFields, HealthBadge, BookmarkCategorySidebar
 * [OUTPUT]: exports BookmarkManager component (library CRUD, ?q= deep-linked search filtering, drag-and-drop reordering, and quick health checks)
 * [POS]: main Library tab body rendered inside BookmarkManager.tsx
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import type { Bookmark, Category, CreateBookmarkInput } from "@dockmark/core";
import {
  checkBookmarkHealth,
  createCategory,
  deleteBookmark,
  deleteCategory,
  updateCategory,
} from "./api";
import { BookmarkCategorySidebar } from "./BookmarkCategorySidebar";
import {
  BookmarkDetailsApiError,
  createBookmarkWithTags,
  parseBookmarkTags,
  updateBookmarkWithTags,
} from "./bookmark-details-api";
import { BookmarkFavicon } from "./BookmarkFavicon";
import { BookmarkFields, emptyDraft, HealthBadge, type BookmarkDraft } from "./BookmarkFormFields";
import { bookmarkMatchesQuery } from "./bookmark-search";
import { useI18n } from "./i18n";
import { reorderBookmarks, reorderCategories } from "./reorder-api";
import "./health.css";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  bookmarkTags: Record<string, string[]>;
  loading: boolean;
  onChanged: () => Promise<void>;
}

interface BookmarkGroup {
  categoryId: string | null;
  name: string;
  bookmarks: Bookmark[];
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function tagValidationMessage(value: string, fallback: string) {
  try {
    parseBookmarkTags(value);
    return null;
  } catch (error) {
    return messageFrom(error, fallback);
  }
}

function duplicateUrlMessage(error: unknown) {
  return error instanceof BookmarkDetailsApiError && error.code === "bookmark_exists"
    ? error.message
    : null;
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

function readInitialQueryParam(): string {
  try {
    return new URLSearchParams(window.location.search).get("q") ?? "";
  } catch {
    return "";
  }
}

function clearQueryParamFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("q")) return;
    url.searchParams.delete("q");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore invalid location environments.
  }
}

export function BookmarkManager({ bookmarks, categories, bookmarkTags, loading, onChanged }: Props) {
  const { tx } = useI18n();
  const [draft, setDraft] = useState<BookmarkDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BookmarkDraft>(emptyDraft);
  const [newCategory, setNewCategory] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [query, setQuery] = useState<string>(() => readInitialQueryParam());

  useEffect(() => {
    clearQueryParamFromUrl();
    const onPopState = () => {
      const next = readInitialQueryParam();
      if (!next) return;
      setQuery(next);
      clearQueryParamFromUrl();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingBookmark, setCreatingBookmark] = useState(false);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [createUrlError, setCreateUrlError] = useState<string | null>(null);
  const [editUrlError, setEditUrlError] = useState<string | null>(null);
  const [createSubmitError, setCreateSubmitError] = useState<string | null>(null);
  const [editSubmitError, setEditSubmitError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [savedBookmarkId, setSavedBookmarkId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(() => new Set());
  const [bulkChecking, setBulkChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [draggedBookmark, setDraggedBookmark] = useState<{ id: string; categoryId: string | null } | null>(null);

  const genericError = tx("Something went wrong.", "操作失败，请重试。");
  const uncategorizedLabel = tx("Uncategorized", "未分类");

  const createTagError = useMemo(() => tagValidationMessage(draft.tagsText, genericError), [draft.tagsText, genericError]);
  const editTagError = useMemo(() => tagValidationMessage(editDraft.tagsText, genericError), [editDraft.tagsText, genericError]);

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
    const categoryName = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "" : uncategorizedLabel;
    return bookmarkMatchesQuery(bookmark, categoryName, tags, query);
  }), [activeTag, bookmarkTags, bookmarks, categoryNameById, query, uncategorizedLabel]);

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
      name: uncategorizedLabel,
      bookmarks: filteredBookmarks
        .filter((bookmark) => !bookmark.categoryId)
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    });
    return groups.filter((group) => group.bookmarks.length > 0);
  }, [filteredBookmarks, categories, uncategorizedLabel]);

  async function refreshAfter(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    let actionError: unknown = null;
    try {
      await action();
    } catch (caught) {
      actionError = caught;
      setError(messageFrom(caught, genericError));
    }
    try {
      await onChanged();
    } catch (caught) {
      if (!actionError) setError(messageFrom(caught, genericError));
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
      setNotice(tx("Category order saved.", "已保存分类顺序。"));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
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
      setNotice(tx("Bookmark order saved.", "已保存书签顺序。"));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
      await onChanged();
    } finally {
      setReordering(false);
    }
  }

  function changeCreateDraft(next: BookmarkDraft) {
    if (next.url !== draft.url) setCreateUrlError(null);
    setCreateSubmitError(null);
    setCreateStatus(null);
    setDraft(next);
  }

  function changeEditDraft(next: BookmarkDraft) {
    if (next.url !== editDraft.url) setEditUrlError(null);
    setEditSubmitError(null);
    setEditDraft(next);
  }

  function beginEdit(bookmark: Bookmark) {
    setEditingId(bookmark.id);
    setEditUrlError(null);
    setEditSubmitError(null);
    setSavedBookmarkId(null);
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
      setError(messageFrom(caught, genericError));
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
      setNotice(tx(
        `Checked ${checked} bookmark${checked === 1 ? "" : "s"}${failed ? `; ${failed} failed to check` : ""}.`,
        `已完成 ${checked} 个书签健康检查${failed ? `；${failed} 个检查失败` : ""}。`,
      ));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
    } finally {
      setCheckingIds(new Set());
      setBulkChecking(false);
    }
  }

  async function submitBookmark(event: FormEvent) {
    event.preventDefault();
    if (createTagError || createUrlError) return;

    const input: CreateBookmarkInput = {
      title: draft.title,
      url: draft.url,
      categoryId: draft.categoryId || null,
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.healthPolicy !== "auto" ? { healthPolicy: draft.healthPolicy } : {}),
    };

    setCreatingBookmark(true);
    setCreateSubmitError(null);
    setCreateStatus(null);
    setError(null);
    setNotice(null);
    try {
      const tags = parseBookmarkTags(draft.tagsText);
      const result = await createBookmarkWithTags(input, tags);
      setDraft(emptyDraft);
      setCreateUrlError(null);
      setCreateStatus(tx(`Saved “${result.bookmark.title}”.`, `已保存「${result.bookmark.title}」。`));
      try {
        await onChanged();
      } catch (refreshError) {
        setCreateSubmitError(tx(
          `Saved, but the library could not refresh: ${messageFrom(refreshError, genericError)}`,
          `已保存，但书签库刷新失败：${messageFrom(refreshError, genericError)}`,
        ));
      }
    } catch (caught) {
      const urlMessage = duplicateUrlMessage(caught);
      if (urlMessage) setCreateUrlError(urlMessage);
      else setCreateSubmitError(messageFrom(caught, genericError));
    } finally {
      setCreatingBookmark(false);
    }
  }

  async function submitEdit(event: FormEvent, id: string) {
    event.preventDefault();
    const healthPolicy = editDraft.healthPolicy;
    if (healthPolicy === "auto" || editTagError || editUrlError) return;

    setSavingEditId(id);
    setEditSubmitError(null);
    setError(null);
    setNotice(null);
    try {
      const tags = parseBookmarkTags(editDraft.tagsText);
      await updateBookmarkWithTags(id, {
        title: editDraft.title,
        url: editDraft.url,
        description: editDraft.description.trim() || null,
        categoryId: editDraft.categoryId || null,
        healthPolicy,
        tags,
      });
      setSavedBookmarkId(id);
      setEditingId(null);
      setEditUrlError(null);
      setEditSubmitError(null);
      try {
        await onChanged();
      } catch (refreshError) {
        setError(tx(
          `Bookmark was saved, but the library could not refresh: ${messageFrom(refreshError, genericError)}`,
          `书签已保存，但书签库刷新失败：${messageFrom(refreshError, genericError)}`,
        ));
      }
    } catch (caught) {
      const urlMessage = duplicateUrlMessage(caught);
      if (urlMessage) setEditUrlError(urlMessage);
      else setEditSubmitError(messageFrom(caught, genericError));
    } finally {
      setSavingEditId(null);
    }
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
    <section className="management bookmark-library-view">
      <div className="management-heading compact-manager-heading">
        <div>
          <h1>{tx("Bookmark Library", "书签库")}</h1>
          <p className="manager-subtitle">
            {tx("Add, categorize, tag, and reorder bookmarks synced across your browsers.", "添加、分类、标记并排序你的全部书签。")}
          </p>
        </div>
        <div className="management-summary">
          <span className="library-count">
            {tx(`${bookmarks.length} bookmarks · ${tagSummary.length} tags`, `${bookmarks.length} 个书签 · ${tagSummary.length} 个标签`)}
          </span>
          <button
            className="secondary"
            type="button"
            disabled={bulkChecking || !eligibleForAutomaticCheck.length}
            onClick={() => void checkEligible()}
          >
            {bulkChecking
              ? tx("Checking…", "检查中…")
              : tx(`Check ${eligibleForAutomaticCheck.length} eligible`, `检查 ${eligibleForAutomaticCheck.length} 个可检书签`)}
          </button>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner health-feedback" role="status">{notice}</div>}

      <div className="management-grid">
        <BookmarkCategorySidebar
          categories={categories}
          tagSummary={tagSummary}
          activeTag={activeTag}
          newCategory={newCategory}
          editingCategoryId={editingCategoryId}
          editingCategoryName={editingCategoryName}
          draggedCategoryId={draggedCategoryId}
          busy={busy}
          reordering={reordering}
          onNewCategoryChange={setNewCategory}
          onSubmitCategory={submitCategory}
          onStartEditCategory={(category) => { setEditingCategoryId(category.id); setEditingCategoryName(category.name); }}
          onCancelEditCategory={() => setEditingCategoryId(null)}
          onEditingCategoryNameChange={setEditingCategoryName}
          onSubmitCategoryEdit={submitCategoryEdit}
          onDeleteCategory={(category) => {
            if (window.confirm(tx(
              `Delete category “${category.name}”? Its bookmarks will become uncategorized.`,
              `删除分类「${category.name}」？其中的书签将变为未分类。`,
            ))) {
              void refreshAfter(() => deleteCategory(category.id));
            }
          }}
          onDragStartCategory={setDraggedCategoryId}
          onDragEndCategory={() => setDraggedCategoryId(null)}
          onDropCategory={categoryDrop}
          onMoveCategory={(id, offset) => void persistCategoryOrder(moveByOffset(categories.map((item) => item.id), id, offset))}
          onSelectTag={setActiveTag}
        />

        <div className="manager-main">
          <div className="form-card bookmark-search-card">
            <div className="bookmark-search-heading">
              <div>
                <strong>{tx("Find bookmarks", "查找书签")}</strong>
                <span>{tx(`${filteredBookmarks.length} of ${bookmarks.length}`, `${filteredBookmarks.length} / ${bookmarks.length}`)}</span>
              </div>
              {filtering && (
                <button className="text-action" type="button" onClick={() => { setQuery(""); setActiveTag(null); }}>
                  {tx("Clear filters", "清除筛选")}
                </button>
              )}
            </div>
            <div className="bookmark-search-input">
              <span aria-hidden="true">⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tx("Search title, URL, description, category, or #tag…", "搜索标题、网址、描述、分类或 #标签…")}
                aria-label={tx("Search bookmark library", "搜索书签库")}
              />
              {query && (
                <button
                  className="command-clear"
                  type="button"
                  aria-label={tx("Clear search", "清空搜索")}
                  onClick={() => setQuery("")}
                >
                  ×
                </button>
              )}
            </div>
            <p className="bookmark-search-help">
              {tx(
                "Space-separated terms use AND matching across Library, Launcher, and New Tab (e.g. ",
                "空格分隔的关键词按 AND 匹配，并同步用于书签库、启动台与新标签页（例如 ",
              )}
              <code>github #dev</code>
              {tx("). Reordering pauses while filtered.", "）。筛选期间暂停拖拽排序。")}
            </p>
          </div>

          <form className="form-card bookmark-form" onSubmit={submitBookmark}>
            <div className="card-heading">
              <div>
                <h2>{tx("Add bookmark", "添加书签")}</h2>
                <p>
                  {tx(
                    "Local URLs are automatically protected as local-only. Description and tags become searchable immediately.",
                    "本地地址会自动设为「仅本地」。描述与标签保存后即可检索。",
                  )}
                </p>
              </div>
              <button
                className="primary"
                disabled={busy || creatingBookmark || loading || Boolean(createTagError) || Boolean(createUrlError)}
              >
                {creatingBookmark
                  ? tx("Saving…", "保存中…")
                  : createTagError || createUrlError
                    ? tx("Fix errors", "请修正错误")
                    : tx("Add bookmark", "添加书签")}
              </button>
            </div>
            <BookmarkFields
              draft={draft}
              categories={categories}
              onChange={changeCreateDraft}
              allowAuto
              idPrefix="bookmark-create"
              urlError={createUrlError}
              tagsError={createTagError}
            />
            {createSubmitError && <div className="inline-form-feedback error" role="alert">{createSubmitError}</div>}
            {createStatus && <div className="inline-form-feedback success" role="status">{createStatus}</div>}
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
                      const savingThisBookmark = savingEditId === bookmark.id;
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
                              <BookmarkFields
                                draft={editDraft}
                                categories={categories}
                                onChange={changeEditDraft}
                                allowAuto={false}
                                idPrefix={`bookmark-edit-${bookmark.id}`}
                                urlError={editUrlError}
                                tagsError={editTagError}
                              />
                              {editSubmitError && <div className="inline-form-feedback error" role="alert">{editSubmitError}</div>}
                              <div className="edit-actions">
                                <button
                                  className="primary"
                                  disabled={busy || savingThisBookmark || Boolean(editTagError) || Boolean(editUrlError)}
                                >
                                  {savingThisBookmark
                                    ? tx("Saving…", "保存中…")
                                    : editTagError || editUrlError
                                      ? tx("Fix errors", "请修正错误")
                                      : tx("Save changes", "保存更改")}
                                </button>
                                <button
                                  className="secondary"
                                  type="button"
                                  disabled={savingThisBookmark}
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditUrlError(null);
                                    setEditSubmitError(null);
                                  }}
                                >
                                  {tx("Cancel", "取消")}
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <span className="drag-handle bookmark-drag-handle" aria-hidden="true">⋮⋮</span>
                              <BookmarkFavicon
                                iconUrl={bookmark.iconUrl}
                                title={bookmark.title}
                                url={bookmark.url}
                                className="bookmark-icon"
                              />
                              <div className="bookmark-details">
                                <div className="bookmark-title-line">
                                  <a href={bookmark.url} target="_blank" rel="noreferrer"><strong>{bookmark.title}</strong></a>
                                  <HealthBadge bookmark={bookmark} />
                                  {savedBookmarkId === bookmark.id && (
                                    <span className="bookmark-save-confirmation" role="status">{tx("Saved", "已保存")}</span>
                                  )}
                                </div>
                                <small title={bookmark.url}>{bookmark.url}</small>
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
                                <button
                                  className="secondary reorder-button"
                                  type="button"
                                  disabled={filtering || reordering || index === 0}
                                  aria-label={tx(`Move ${bookmark.title} up`, `将 ${bookmark.title} 上移`)}
                                  onClick={() => void persistBookmarkOrder(group.categoryId, moveByOffset(ids, bookmark.id, -1))}
                                >
                                  ↑
                                </button>
                                <button
                                  className="secondary reorder-button"
                                  type="button"
                                  disabled={filtering || reordering || index === group.bookmarks.length - 1}
                                  aria-label={tx(`Move ${bookmark.title} down`, `将 ${bookmark.title} 下移`)}
                                  onClick={() => void persistBookmarkOrder(group.categoryId, moveByOffset(ids, bookmark.id, 1))}
                                >
                                  ↓
                                </button>
                                {(bookmark.healthPolicy === "normal" || bookmark.healthPolicy === "manual") && (
                                  <button
                                    className="secondary health-check-button"
                                    type="button"
                                    disabled={checkingIds.has(bookmark.id)}
                                    onClick={() => void checkOne(bookmark)}
                                  >
                                    {checkingIds.has(bookmark.id) ? tx("Checking…", "检查中…") : tx("Check", "检查")}
                                  </button>
                                )}
                                <button className="secondary" type="button" onClick={() => beginEdit(bookmark)}>
                                  {tx("Edit", "编辑")}
                                </button>
                                <button
                                  className="danger-button"
                                  type="button"
                                  onClick={() => {
                                    if (window.confirm(tx(`Delete “${bookmark.title}”?`, `确认删除「${bookmark.title}」？`))) {
                                      void refreshAfter(() => deleteBookmark(bookmark.id));
                                    }
                                  }}
                                >
                                  {tx("Delete", "删除")}
                                </button>
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
              <div className="empty-state">
                <strong>{tx("No bookmarks yet.", "暂无书签。")}</strong>
                <span>{tx("Add your first URL above or import a browser bookmark file.", "在上方添加首个书签，或前往导入导出页导入浏览器书签。")}</span>
              </div>
            )}
            {!loading && bookmarks.length > 0 && !filteredBookmarks.length && (
              <div className="empty-state">
                <strong>{tx("No bookmarks match this filter.", "没有符合筛选条件的书签。")}</strong>
                <span>{tx("Try another keyword, remove the active tag, or clear filters.", "尝试其他关键词、取消当前标签或清除筛选。")}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
