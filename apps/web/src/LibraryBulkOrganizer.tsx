import { useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { parseBookmarkTags } from "./bookmark-details-api";
import { MAX_LIBRARY_BATCH, organizeLibraryBatch } from "./library-batch-api";
import "./library-bulk.css";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
}

const KEEP_CATEGORY = "__keep__";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function tagInputError(value: string) {
  try {
    parseBookmarkTags(value);
    return null;
  } catch (error) {
    return messageFrom(error);
  }
}

export function LibraryBulkOrganizer({ bookmarks, categories, onChanged }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [categoryChoice, setCategoryChoice] = useState(KEEP_CATEGORY);
  const [addTagsText, setAddTagsText] = useState("");
  const [removeTagsText, setRemoveTagsText] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visibleIds = useMemo(() => new Set(bookmarks.map((bookmark) => bookmark.id)), [bookmarks]);
  const selectedBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => selectedIds.has(bookmark.id)),
    [bookmarks, selectedIds],
  );
  const hiddenSelectedCount = useMemo(
    () => Array.from(selectedIds).filter((id) => !visibleIds.has(id)).length,
    [selectedIds, visibleIds],
  );

  const addTagsError = useMemo(() => tagInputError(addTagsText), [addTagsText]);
  const removeTagsError = useMemo(() => tagInputError(removeTagsText), [removeTagsText]);
  const overlapError = useMemo(() => {
    if (addTagsError || removeTagsError) return null;
    const addTags = parseBookmarkTags(addTagsText);
    const removeKeys = new Set(parseBookmarkTags(removeTagsText).map((tag) => tag.toLocaleLowerCase()));
    const overlap = addTags.find((tag) => removeKeys.has(tag.toLocaleLowerCase()));
    return overlap ? `Tag “${overlap}” cannot be added and removed in the same review.` : null;
  }, [addTagsError, addTagsText, removeTagsError, removeTagsText]);

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
    setSelectedIds(new Set(bookmarks.slice(0, MAX_LIBRARY_BATCH).map((bookmark) => bookmark.id)));
    setNotice(bookmarks.length > MAX_LIBRARY_BATCH ? `Selected the first ${MAX_LIBRARY_BATCH} visible bookmarks.` : null);
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
    if (categoryChoice === KEEP_CATEGORY) return "Keep current categories";
    if (categoryChoice === "") return "Move to Uncategorized";
    return `Move to ${categories.find((category) => category.id === categoryChoice)?.name ?? "selected category"}`;
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
      setNotice(`Applied reviewed organization to ${result.applied} bookmark${result.applied === 1 ? "" : "s"}.`);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setApplying(false);
    }
  }

  const addTags = !addTagsError ? parseBookmarkTags(addTagsText) : [];
  const removeTags = !removeTagsError ? parseBookmarkTags(removeTagsText) : [];

  return (
    <section className="form-card library-bulk-card" aria-label="Reviewed bulk organization">
      <div className="library-bulk-heading">
        <div>
          <h2>Bulk organize</h2>
          <p>V5 starts with explicit multi-select organization. Category and tag changes are reviewed first, then committed atomically.</p>
        </div>
        <div className="library-bulk-selection">
          <strong>{selectedIds.size} selected</strong>
          <button className="text-action" type="button" disabled={reviewing || applying || !bookmarks.length} onClick={selectVisible}>
            {bookmarks.length > MAX_LIBRARY_BATCH ? `Select first ${MAX_LIBRARY_BATCH}` : "Select visible"}
          </button>
          <button className="text-action muted-action" type="button" disabled={applying || !selectedIds.size} onClick={clearSelection}>Clear</button>
        </div>
      </div>

      {hiddenSelectedCount > 0 && (
        <div className="inline-form-feedback" role="status">
          {hiddenSelectedCount} selected bookmark{hiddenSelectedCount === 1 ? " is" : "s are"} outside the current filter. Clear selection before changing filters if you want the batch to stay visible-only.
        </div>
      )}

      <div className="library-bulk-picker" aria-label="Bookmarks available for bulk organization">
        {bookmarks.slice(0, 100).map((bookmark) => (
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
        {!bookmarks.length && <p className="empty-copy">No bookmarks are visible under the current Library filter.</p>}
        {bookmarks.length > 100 && <p className="library-bulk-help">Showing the first 100 visible bookmarks in the picker. Narrow the Library filter to target a different set.</p>}
      </div>

      <div className="library-bulk-grid">
        <label>
          <span>Category</span>
          <select value={categoryChoice} disabled={reviewing || applying} onChange={(event) => { setCategoryChoice(event.target.value); resetReview(); }}>
            <option value={KEEP_CATEGORY}>Keep current categories</option>
            <option value="">Move to Uncategorized</option>
            {categories.map((category) => <option key={category.id} value={category.id}>Move to {category.name}</option>)}
          </select>
        </label>
        <label className={addTagsError ? "field-error" : undefined}>
          <span>Add tags</span>
          <input
            value={addTagsText}
            disabled={reviewing || applying}
            onChange={(event) => { setAddTagsText(event.target.value); resetReview(); }}
            placeholder="dev, docs"
            aria-invalid={Boolean(addTagsError)}
          />
          {addTagsError && <small className="library-bulk-error" role="alert">{addTagsError}</small>}
        </label>
        <label className={removeTagsError ? "field-error" : undefined}>
          <span>Remove tags</span>
          <input
            value={removeTagsText}
            disabled={reviewing || applying}
            onChange={(event) => { setRemoveTagsText(event.target.value); resetReview(); }}
            placeholder="old, later"
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
            Review {selectedIds.size || ""} change{selectedIds.size === 1 ? "" : "s"}
          </button>
          <span className="library-bulk-help">Maximum {MAX_LIBRARY_BATCH} bookmarks per reviewed batch. Titles, URLs, descriptions and HealthPolicy are never changed here.</span>
        </div>
      ) : (
        <div className="library-bulk-review">
          <div>
            <strong>Review before apply</strong>
            <p>{selectedIds.size} bookmark{selectedIds.size === 1 ? "" : "s"} will be updated in one D1 batch. If validation fails, none are changed.</p>
          </div>
          <div className="library-bulk-review-summary">
            <span>{categoryLabel()}</span>
            {addTags.length > 0 && <span>Add {addTags.map((tag) => `#${tag}`).join(" ")}</span>}
            {removeTags.length > 0 && <span>Remove {removeTags.map((tag) => `#${tag}`).join(" ")}</span>}
          </div>
          <div className="library-bulk-review-list">
            {selectedBookmarks.slice(0, 8).map((bookmark) => <span key={bookmark.id}>{bookmark.title}</span>)}
            {selectedIds.size > 8 && <span>+{selectedIds.size - 8} more</span>}
          </div>
          <div className="library-bulk-actions">
            <button className="primary" type="button" disabled={applying} onClick={() => void applyReviewedChanges()}>
              {applying ? "Applying…" : `Apply to ${selectedIds.size}`}
            </button>
            <button className="secondary" type="button" disabled={applying} onClick={() => setReviewing(false)}>Back</button>
          </div>
        </div>
      )}
    </section>
  );
}
