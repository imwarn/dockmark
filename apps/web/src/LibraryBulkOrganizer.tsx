/**
 * [INPUT]: depends on Bookmark, Category from @dockmark/core; parseBookmarkTags from ./bookmark-details-api; bookmarkMatchesQuery from ./bookmark-search; MAX_LIBRARY_BATCH, organizeLibraryBatch from ./library-batch-api; useI18n from ./i18n
 * [OUTPUT]: exports LibraryBulkOrganizer component
 * [POS]: reviewed multi-select category and tag batch organizer used in BookmarkManager and SmartCollectionsPage
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { parseBookmarkTags } from "./bookmark-details-api";
import { bookmarkMatchesQuery } from "./bookmark-search";
import { useI18n } from "./i18n";
import { MAX_LIBRARY_BATCH, organizeLibraryBatch } from "./library-batch-api";
import "./library-bulk.css";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  bookmarkTags: Record<string, string[]>;
  onChanged: () => Promise<void>;
  contextLabel?: string;
  preselectMatches?: boolean;
}

const KEEP_CATEGORY = "__keep__";

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function tagInputError(value: string, fallback: string) {
  try {
    parseBookmarkTags(value);
    return null;
  } catch (error) {
    return messageFrom(error, fallback);
  }
}

export function LibraryBulkOrganizer({
  bookmarks,
  categories,
  bookmarkTags,
  onChanged,
  contextLabel,
  preselectMatches = false,
}: Props) {
  const { tx } = useI18n();
  const genericError = tx("Something went wrong.", "操作失败，请重试。");
  const uncategorizedLabel = tx("Uncategorized", "未分类");

  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(preselectMatches ? bookmarks.slice(0, MAX_LIBRARY_BATCH).map((bookmark) => bookmark.id) : []),
  );
  const [categoryChoice, setCategoryChoice] = useState(KEEP_CATEGORY);
  const [addTagsText, setAddTagsText] = useState("");
  const [removeTagsText, setRemoveTagsText] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    () => preselectMatches && bookmarks.length > MAX_LIBRARY_BATCH
      ? tx(
          `Selected the first ${MAX_LIBRARY_BATCH} of ${bookmarks.length} handed-off matches.`,
          `已预选前 ${MAX_LIBRARY_BATCH} 个匹配书签（共 ${bookmarks.length} 个）。`,
        )
      : null,
  );

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const candidates = useMemo(
    () => bookmarks.filter((bookmark) => {
      const category = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "" : uncategorizedLabel;
      return bookmarkMatchesQuery(bookmark, category, bookmarkTags[bookmark.id] ?? [], query);
    }),
    [bookmarkTags, bookmarks, categoryNameById, query, uncategorizedLabel],
  );
  const visibleIds = useMemo(() => new Set(candidates.map((bookmark) => bookmark.id)), [candidates]);
  const selectedBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => selectedIds.has(bookmark.id)),
    [bookmarks, selectedIds],
  );
  const hiddenSelectedCount = useMemo(
    () => Array.from(selectedIds).filter((id) => !visibleIds.has(id)).length,
    [selectedIds, visibleIds],
  );

  const addTagsError = useMemo(() => tagInputError(addTagsText, genericError), [addTagsText, genericError]);
  const removeTagsError = useMemo(() => tagInputError(removeTagsText, genericError), [removeTagsText, genericError]);
  const overlapError = useMemo(() => {
    if (addTagsError || removeTagsError) return null;
    const addTags = parseBookmarkTags(addTagsText);
    const removeKeys = new Set(parseBookmarkTags(removeTagsText).map((tag) => tag.toLocaleLowerCase()));
    const overlap = addTags.find((tag) => removeKeys.has(tag.toLocaleLowerCase()));
    return overlap
      ? tx(
          `Tag “${overlap}” cannot be added and removed in the same review.`,
          `标签「${overlap}」不能在同一批次中同时添加和移除。`,
        )
      : null;
  }, [addTagsError, addTagsText, removeTagsError, removeTagsText, tx]);

  const hasChanges = categoryChoice !== KEEP_CATEGORY || Boolean(addTagsText.trim()) || Boolean(removeTagsText.trim());
  const validationError = addTagsError || removeTagsError || overlapError;
  const canReview = selectedIds.size > 0 && selectedIds.size <= MAX_LIBRARY_BATCH && hasChanges && !validationError && !applying;

  function resetReview() {
    setReviewing(false);
    setError(null);
    setNotice(null);
  }

  function toggleBookmark(id: string) {
    if (reviewing || applying) return;
    setNotice(null);
    setError(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_LIBRARY_BATCH) next.add(id);
      return next;
    });
  }

  function selectVisible() {
    if (reviewing || applying) return;
    setSelectedIds(new Set(candidates.slice(0, MAX_LIBRARY_BATCH).map((bookmark) => bookmark.id)));
    setNotice(
      candidates.length > MAX_LIBRARY_BATCH
        ? tx(`Selected the first ${MAX_LIBRARY_BATCH} matching bookmarks.`, `已选择前 ${MAX_LIBRARY_BATCH} 个匹配书签。`)
        : null,
    );
    setError(null);
  }

  function clearSelection() {
    if (applying) return;
    setSelectedIds(new Set());
    setReviewing(false);
    setError(null);
    setNotice(null);
  }

  function categoryLabel() {
    if (categoryChoice === KEEP_CATEGORY) return tx("Keep current categories", "保持当前分类");
    if (categoryChoice === "") return tx("Move to Uncategorized", "移至未分类");
    const targetName = categories.find((category) => category.id === categoryChoice)?.name ?? tx("selected category", "所选分类");
    return tx(`Move to ${targetName}`, `移至「${targetName}」`);
  }

  async function applyReviewedChanges() {
    if (!canReview) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const addTags = parseBookmarkTags(addTagsText);
      const removeTags = parseBookmarkTags(removeTagsText);
      const result = await organizeLibraryBatch({
        bookmarkIds: Array.from(selectedIds),
        ...(categoryChoice === KEEP_CATEGORY ? {} : { categoryId: categoryChoice || null }),
        ...(addTags.length ? { addTags } : {}),
        ...(removeTags.length ? { removeTags } : {}),
      });
      await onChanged();
      setSelectedIds(new Set());
      setCategoryChoice(KEEP_CATEGORY);
      setAddTagsText("");
      setRemoveTagsText("");
      setReviewing(false);
      setNotice(tx(
        `Applied reviewed organization to ${result.applied} bookmark${result.applied === 1 ? "" : "s"}.`,
        `已批量整理 ${result.applied} 个书签。`,
      ));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
    } finally {
      setApplying(false);
    }
  }

  const addTags = !addTagsError ? parseBookmarkTags(addTagsText) : [];
  const removeTags = !removeTagsError ? parseBookmarkTags(removeTagsText) : [];

  return (
    <section className="management library-bulk-management" aria-label={tx("Reviewed bulk organization", "批量整理")}>
      <div className="form-card library-bulk-card">
        <div className="library-bulk-heading">
          <div>
            <h2>{tx("Bulk organize", "批量整理")}</h2>
            <p>
              {contextLabel ? (
                <>
                  {tx("Scoped from ", "当前范围来自 ")}
                  <strong>{contextLabel}</strong>
                  {tx(". Review category and tag changes before committing atomically.", "。核对分类和标签变更后再一次性原子提交。")}
                </>
              ) : (
                tx("Select bookmarks, preview category and tag edits, then commit the batch atomically.", "多选书签并预览分类与标签修改，确认后一次性原子提交。")
              )}
            </p>
          </div>
          <div className="library-bulk-selection">
            <strong>{tx(`${selectedIds.size} selected`, `已选 ${selectedIds.size} 项`)}</strong>
            <button className="text-action" type="button" disabled={reviewing || applying || !candidates.length} onClick={selectVisible}>
              {candidates.length > MAX_LIBRARY_BATCH
                ? tx(`Select first ${MAX_LIBRARY_BATCH}`, `全选前 ${MAX_LIBRARY_BATCH} 项`)
                : tx("Select matches", "选择匹配项")}
            </button>
            <button className="text-action muted-action" type="button" disabled={applying || !selectedIds.size} onClick={clearSelection}>
              {tx("Clear", "清空")}
            </button>
          </div>
        </div>

        <div className="library-bulk-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            disabled={reviewing || applying}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={contextLabel
              ? tx("Narrow collection by title, URL, description, category, or #tag…", "按标题、网址、描述、分类或 #标签进一步筛选…")
              : tx("Filter bulk candidates by title, URL, description, category, or #tag…", "按标题、网址、描述、分类或 #标签筛选书签…")}
            aria-label={tx("Filter bookmarks for bulk organization", "筛选待批量整理的书签")}
          />
          <strong>{tx(`${candidates.length} match${candidates.length === 1 ? "" : "es"}`, `${candidates.length} 个匹配`)}</strong>
        </div>

        {hiddenSelectedCount > 0 && (
          <div className="inline-form-feedback" role="status">
            {tx(
              `${hiddenSelectedCount} selected bookmark${hiddenSelectedCount === 1 ? " is" : "s are"} outside the current filter. Clear selection to keep this review filter-only.`,
              `有 ${hiddenSelectedCount} 个已选书签不在当前筛选结果中。如需仅处理当前结果，请先清空选择。`,
            )}
          </div>
        )}

        <div className="library-bulk-picker" aria-label={tx("Bookmarks available for bulk organization", "可批量整理的书签")}>
          {candidates.slice(0, 100).map((bookmark) => (
            <label className={`library-bulk-bookmark${selectedIds.has(bookmark.id) ? " selected" : ""}`} key={bookmark.id}>
              <input
                type="checkbox"
                checked={selectedIds.has(bookmark.id)}
                disabled={reviewing || applying || (!selectedIds.has(bookmark.id) && selectedIds.size >= MAX_LIBRARY_BATCH)}
                onChange={() => toggleBookmark(bookmark.id)}
              />
              <span><strong>{bookmark.title}</strong><small>{bookmark.url}</small></span>
            </label>
          ))}
          {!candidates.length && <p className="empty-copy">{tx("No bookmarks match this filter.", "没有符合当前筛选条件的书签。")}</p>}
          {candidates.length > 100 && (
            <p className="library-bulk-help">
              {tx("Showing the first 100 matches. Narrow the filter to target another set.", "仅展示前 100 个匹配项，请缩小筛选范围以定位其他书签。")}
            </p>
          )}
        </div>

        <div className="library-bulk-grid">
          <label>
            <span>{tx("Category", "分类")}</span>
            <select value={categoryChoice} disabled={reviewing || applying} onChange={(event) => { setCategoryChoice(event.target.value); resetReview(); }}>
              <option value={KEEP_CATEGORY}>{tx("Keep current categories", "保持当前分类")}</option>
              <option value="">{tx("Move to Uncategorized", "移至未分类")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{tx(`Move to ${category.name}`, `移至「${category.name}」`)}</option>
              ))}
            </select>
          </label>
          <label className={addTagsError ? "field-error" : undefined}>
            <span>{tx("Add tags", "添加标签")}</span>
            <input
              value={addTagsText}
              disabled={reviewing || applying}
              onChange={(event) => { setAddTagsText(event.target.value); resetReview(); }}
              placeholder={tx("dev, docs", "dev, docs")}
              aria-invalid={Boolean(addTagsError)}
            />
            {addTagsError && <small className="library-bulk-error" role="alert">{addTagsError}</small>}
          </label>
          <label className={removeTagsError ? "field-error" : undefined}>
            <span>{tx("Remove tags", "移除标签")}</span>
            <input
              value={removeTagsText}
              disabled={reviewing || applying}
              onChange={(event) => { setRemoveTagsText(event.target.value); resetReview(); }}
              placeholder={tx("old, later", "old, 待看")}
              aria-invalid={Boolean(removeTagsError)}
            />
            {removeTagsError && <small className="library-bulk-error" role="alert">{removeTagsError}</small>}
          </label>
        </div>

        {overlapError && <div className="inline-form-feedback error" role="alert">{overlapError}</div>}
        {error && <div className="inline-form-feedback error" role="alert">{error}</div>}
        {notice && <div className="inline-form-feedback success" role="status">{notice}</div>}

        {!reviewing ? (
          <div className="library-bulk-actions">
            <button className="primary" type="button" disabled={!canReview} onClick={() => setReviewing(true)}>
              {selectedIds.size
                ? tx(`Review ${selectedIds.size} change${selectedIds.size === 1 ? "" : "s"}`, `复核 ${selectedIds.size} 项变更`)
                : tx("Review changes", "复核变更")}
            </button>
            <span className="library-bulk-help">
              {tx(
                `Up to ${MAX_LIBRARY_BATCH} bookmarks per batch. Titles, URLs, descriptions, and health policies are never modified here.`,
                `单次最多处理 ${MAX_LIBRARY_BATCH} 个书签。不会改动标题、网址、描述或健康策略。`,
              )}
            </span>
          </div>
        ) : (
          <div className="library-bulk-review">
            <div>
              <strong>{tx("Review before apply", "应用前确认")}</strong>
              <p>
                {tx(
                  `${selectedIds.size} bookmark${selectedIds.size === 1 ? "" : "s"} will be updated in one transaction. If validation fails, nothing changes.`,
                  `将在单次事务中更新 ${selectedIds.size} 个书签；若校验失败，不会产生部分修改。`,
                )}
              </p>
            </div>
            <div className="library-bulk-review-summary">
              <span>{categoryLabel()}</span>
              {addTags.length > 0 && <span>{tx("Add", "添加")} {addTags.map((tag) => `#${tag}`).join(" ")}</span>}
              {removeTags.length > 0 && <span>{tx("Remove", "移除")} {removeTags.map((tag) => `#${tag}`).join(" ")}</span>}
            </div>
            <div className="library-bulk-review-list">
              {selectedBookmarks.slice(0, 8).map((bookmark) => <span key={bookmark.id}>{bookmark.title}</span>)}
              {selectedIds.size > 8 && <span>{tx(`+${selectedIds.size - 8} more`, `另有 ${selectedIds.size - 8} 项`)}</span>}
            </div>
            <div className="library-bulk-actions">
              <button className="primary" type="button" disabled={applying} onClick={() => void applyReviewedChanges()}>
                {applying
                  ? tx("Applying…", "应用中…")
                  : tx(`Apply to ${selectedIds.size}`, `应用到 ${selectedIds.size} 项`)}
              </button>
              <button className="secondary" type="button" disabled={applying} onClick={() => setReviewing(false)}>
                {tx("Back", "返回")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
