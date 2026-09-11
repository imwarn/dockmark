import { useState, type FormEvent } from "react";
import type { Bookmark, Category, CreateBookmarkInput, HealthPolicy } from "@dockmark/core";
import {
  createBookmark,
  createCategory,
  deleteBookmark,
  deleteCategory,
  updateBookmark,
  updateCategory,
} from "./api";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  loading: boolean;
  onChanged: () => Promise<void>;
}

type DraftPolicy = HealthPolicy | "auto";

interface BookmarkDraft {
  title: string;
  url: string;
  categoryId: string;
  healthPolicy: DraftPolicy;
}

const emptyDraft: BookmarkDraft = {
  title: "",
  url: "",
  categoryId: "",
  healthPolicy: "auto",
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function HealthBadge({ bookmark }: { bookmark: Bookmark }) {
  const text = bookmark.healthPolicy === "local-only"
    ? "Local only"
    : bookmark.healthPolicy === "ignore"
      ? "Ignored"
      : bookmark.healthPolicy === "manual"
        ? "Manual"
        : bookmark.healthStatus === "healthy"
          ? "Healthy"
          : "Unchecked";

  return <span className={`health-badge health-${bookmark.healthPolicy}`}>{text}</span>;
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
    <div className="field-grid">
      <label>
        <span>Title</span>
        <input
          required
          maxLength={200}
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="GitHub"
        />
      </label>
      <label>
        <span>URL</span>
        <input
          required
          value={draft.url}
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
          placeholder="github.com"
          inputMode="url"
        />
      </label>
      <label>
        <span>Category</span>
        <select
          value={draft.categoryId}
          onChange={(event) => onChange({ ...draft, categoryId: event.target.value })}
        >
          <option value="">Uncategorized</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Health policy</span>
        <select
          value={draft.healthPolicy}
          onChange={(event) =>
            onChange({ ...draft, healthPolicy: event.target.value as DraftPolicy })
          }
        >
          {allowAuto && <option value="auto">Auto detect</option>}
          <option value="normal">Normal</option>
          <option value="local-only">Local only</option>
          <option value="ignore">Ignore</option>
          <option value="manual">Manual</option>
        </select>
      </label>
    </div>
  );
}

export function BookmarkManager({ bookmarks, categories, loading, onChanged }: Props) {
  const [draft, setDraft] = useState<BookmarkDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<BookmarkDraft>(emptyDraft);
  const [newCategory, setNewCategory] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(bookmark: Bookmark) {
    setEditingId(bookmark.id);
    setEditDraft({
      title: bookmark.title,
      url: bookmark.url,
      categoryId: bookmark.categoryId ?? "",
      healthPolicy: bookmark.healthPolicy,
    });
  }

  async function submitBookmark(event: FormEvent) {
    event.preventDefault();
    const input: CreateBookmarkInput = {
      title: draft.title,
      url: draft.url,
      categoryId: draft.categoryId || null,
      ...(draft.healthPolicy !== "auto" ? { healthPolicy: draft.healthPolicy } : {}),
    };

    await run(async () => {
      await createBookmark(input);
      setDraft(emptyDraft);
    });
  }

  async function submitEdit(event: FormEvent, id: string) {
    event.preventDefault();
    const healthPolicy = editDraft.healthPolicy;
    if (healthPolicy === "auto") return;

    await run(async () => {
      await updateBookmark(id, {
        title: editDraft.title,
        url: editDraft.url,
        categoryId: editDraft.categoryId || null,
        healthPolicy,
      });
      setEditingId(null);
    });
  }

  async function submitCategory(event: FormEvent) {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    await run(async () => {
      await createCategory({ name });
      setNewCategory("");
    });
  }

  async function submitCategoryEdit(event: FormEvent, id: string) {
    event.preventDefault();
    const name = editingCategoryName.trim();
    if (!name) return;
    await run(async () => {
      await updateCategory(id, { name });
      setEditingCategoryId(null);
      setEditingCategoryName("");
    });
  }

  return (
    <section className="management">
      <div className="management-heading">
        <div>
          <p className="eyebrow">BOOKMARK LIBRARY</p>
          <h1>Keep the useful parts<br />of your browser portable.</h1>
        </div>
        <span className="library-count">{bookmarks.length} bookmarks</span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="management-grid">
        <aside className="manager-sidebar">
          <div className="form-card">
            <div className="card-heading">
              <h2>Categories</h2>
              <span>{categories.length}</span>
            </div>

            <form className="compact-form" onSubmit={submitCategory}>
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                placeholder="New category"
                maxLength={80}
                aria-label="New category name"
              />
              <button className="secondary" disabled={busy || !newCategory.trim()}>Add</button>
            </form>

            <div className="category-list">
              {categories.map((category) => (
                <div className="category-row" key={category.id}>
                  {editingCategoryId === category.id ? (
                    <form
                      className="category-edit"
                      onSubmit={(event) => submitCategoryEdit(event, category.id)}
                    >
                      <input
                        autoFocus
                        value={editingCategoryName}
                        onChange={(event) => setEditingCategoryName(event.target.value)}
                        aria-label={`Rename ${category.name}`}
                      />
                      <button className="text-action" disabled={busy}>Save</button>
                      <button
                        className="text-action muted-action"
                        type="button"
                        onClick={() => setEditingCategoryId(null)}
                      >Cancel</button>
                    </form>
                  ) : (
                    <>
                      <span>{category.icon ?? "#"}</span>
                      <strong>{category.name}</strong>
                      <div className="row-actions">
                        <button
                          className="text-action"
                          type="button"
                          onClick={() => {
                            setEditingCategoryId(category.id);
                            setEditingCategoryName(category.name);
                          }}
                        >Rename</button>
                        <button
                          className="text-action danger-text"
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete category “${category.name}”? Its bookmarks will become uncategorized.`)) {
                              void run(() => deleteCategory(category.id));
                            }
                          }}
                        >Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {!categories.length && <p className="empty-copy">No categories yet.</p>}
            </div>
          </div>
        </aside>

        <div className="manager-main">
          <form className="form-card bookmark-form" onSubmit={submitBookmark}>
            <div className="card-heading">
              <div>
                <h2>Add bookmark</h2>
                <p>Bare local URLs are automatically protected as local-only.</p>
              </div>
              <button className="primary" disabled={busy || loading}>Add bookmark</button>
            </div>
            <BookmarkFields
              draft={draft}
              categories={categories}
              onChange={setDraft}
              allowAuto
            />
          </form>

          <div className="bookmark-list">
            {bookmarks.map((bookmark) => (
              <article className="bookmark-card" key={bookmark.id}>
                {editingId === bookmark.id ? (
                  <form onSubmit={(event) => submitEdit(event, bookmark.id)}>
                    <BookmarkFields
                      draft={editDraft}
                      categories={categories}
                      onChange={setEditDraft}
                      allowAuto={false}
                    />
                    <div className="edit-actions">
                      <button className="primary" disabled={busy}>Save changes</button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => setEditingId(null)}
                      >Cancel</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="bookmark-icon">{bookmark.title.slice(0, 1).toUpperCase()}</div>
                    <div className="bookmark-details">
                      <div className="bookmark-title-line">
                        <a href={bookmark.url} target="_blank" rel="noreferrer">
                          <strong>{bookmark.title}</strong>
                        </a>
                        <HealthBadge bookmark={bookmark} />
                      </div>
                      <small>{bookmark.url}</small>
                      <span className="bookmark-category">
                        {categories.find((category) => category.id === bookmark.categoryId)?.name ?? "Uncategorized"}
                      </span>
                    </div>
                    <div className="bookmark-actions">
                      <button className="secondary" type="button" onClick={() => beginEdit(bookmark)}>Edit</button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete “${bookmark.title}”?`)) {
                            void run(() => deleteBookmark(bookmark.id));
                          }
                        }}
                      >Delete</button>
                    </div>
                  </>
                )}
              </article>
            ))}

            {!loading && !bookmarks.length && (
              <div className="empty-state">
                <strong>No bookmarks yet.</strong>
                <span>Add the first URL above. Import comes next.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
