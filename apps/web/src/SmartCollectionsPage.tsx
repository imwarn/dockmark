/**
 * [INPUT]: depends on useEffect, useMemo, useState, FormEvent from react; HEALTH_STATUS_LABELS, Bookmark, Category, HealthStatus, ResolvedLocale from @dockmark/core; listBookmarks, listCategories from ./api; listInbox from ./inbox-api; LibraryBulkOrganizer from ./LibraryBulkOrganizer; MAX_LIBRARY_BATCH from ./library-batch-api; listBookmarkTags from ./tag-api; matchesSmartCollection from ./smart-collection-match; createSmartCollection, deleteSmartCollection, listSmartCollections, updateSmartCollection, SmartCollection, SmartCollectionFilters from ./smart-collections-api; useI18n from ./i18n; BookmarkFavicon, safeDomainLabel from ./BookmarkFavicon; ./smart-collections.css
 * [OUTPUT]: exports SmartCollectionsPage component for authoring, previewing, and handing off live Smart Collection views
 * [POS]: top-level /app/collections workspace; evaluates saved filter rules client-side and hands matched sets into LibraryBulkOrganizer
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  HEALTH_STATUS_LABELS,
  type Bookmark,
  type Category,
  type HealthStatus,
  type ResolvedLocale,
} from "@dockmark/core";
import { listBookmarks, listCategories } from "./api";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import { useI18n } from "./i18n";
import { listInbox } from "./inbox-api";
import { LibraryBulkOrganizer } from "./LibraryBulkOrganizer";
import { MAX_LIBRARY_BATCH } from "./library-batch-api";
import { matchesSmartCollection } from "./smart-collection-match";
import {
  createSmartCollection,
  deleteSmartCollection,
  listSmartCollections,
  updateSmartCollection,
  type SmartCollection,
  type SmartCollectionFilters,
} from "./smart-collections-api";
import { listBookmarkTags } from "./tag-api";
import "./smart-collections.css";

const HEALTH_STATUSES: HealthStatus[] = [
  "unknown",
  "healthy",
  "redirected",
  "auth-required",
  "forbidden",
  "rate-limited",
  "timeout",
  "dns-error",
  "tls-error",
  "unavailable",
  "local-only",
  "ignored",
];

type CategoryDraft = "any" | "uncategorized" | string;
type InboxDraft = "any" | "inbox" | "library";
type TxFn = (en: string, zh: string) => string;

interface Draft {
  name: string;
  category: CategoryDraft;
  tagsText: string;
  domain: string;
  healthStatus: "any" | HealthStatus;
  inbox: InboxDraft;
}

const emptyDraft: Draft = {
  name: "",
  category: "any",
  tagsText: "",
  domain: "",
  healthStatus: "any",
  inbox: "any",
};

function tagsFromText(value: string, tx: TxFn): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[;,\n]/)) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) {
      throw new Error(
        tx(
          "Each Smart Collection tag must be 40 characters or fewer.",
          "智能合集的单个标签长度不能超过 40 个字符。",
        ),
      );
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > 8) {
    throw new Error(
      tx(
        "A Smart Collection can require at most 8 tags.",
        "每个智能合集最多支持 8 个必选标签。",
      ),
    );
  }
  return tags;
}

function filtersFromDraft(draft: Draft, tx: TxFn): SmartCollectionFilters {
  const filters: SmartCollectionFilters = {};
  if (draft.category === "uncategorized") filters.categoryId = null;
  else if (draft.category !== "any") filters.categoryId = draft.category;
  const tags = tagsFromText(draft.tagsText, tx);
  if (tags.length) filters.tags = tags;
  if (draft.domain.trim()) {
    filters.domain = draft.domain.trim().toLocaleLowerCase().replace(/^\.+|\.+$/g, "");
  }
  if (draft.healthStatus !== "any") filters.healthStatus = draft.healthStatus;
  if (draft.inbox !== "any") filters.inbox = draft.inbox;
  return filters;
}

function filterSignature(filters: SmartCollectionFilters): string {
  return JSON.stringify({
    category: Object.prototype.hasOwnProperty.call(filters, "categoryId") ? filters.categoryId : "__any__",
    tags: filters.tags ?? [],
    domain: filters.domain ?? "",
    healthStatus: filters.healthStatus ?? "",
    inbox: filters.inbox ?? "any",
  });
}

function draftFromCollection(collection: SmartCollection): Draft {
  const { filters } = collection;
  return {
    name: collection.name,
    category: Object.prototype.hasOwnProperty.call(filters, "categoryId")
      ? filters.categoryId === null
        ? "uncategorized"
        : filters.categoryId ?? "any"
      : "any",
    tagsText: (filters.tags ?? []).join(", "),
    domain: filters.domain ?? "",
    healthStatus: filters.healthStatus ?? "any",
    inbox: filters.inbox ?? "any",
  };
}

function formatCollectionFilterLabels(
  filters: SmartCollectionFilters,
  categoryById: Map<string, string>,
  locale: ResolvedLocale,
  tx: TxFn,
): string[] {
  const labels: string[] = [];
  if (Object.prototype.hasOwnProperty.call(filters, "categoryId")) {
    labels.push(
      filters.categoryId === null
        ? tx("Uncategorized", "未分类")
        : categoryById.get(filters.categoryId ?? "") ?? tx("Unknown category", "未知分类"),
    );
  }
  for (const tag of filters.tags ?? []) labels.push(`#${tag}`);
  if (filters.domain) labels.push(filters.domain);
  if (filters.healthStatus) {
    labels.push(HEALTH_STATUS_LABELS[locale][filters.healthStatus]);
  }
  if (filters.inbox === "inbox") labels.push(tx("Inbox only", "仅收件箱"));
  if (filters.inbox === "library") labels.push(tx("Filed library", "已归档书签库"));
  return labels;
}

function selectedCollectionFromLocation(): string | null {
  const value = new URLSearchParams(window.location.search).get("collection");
  return value?.trim() || null;
}

function syncCollectionLocation(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("collection", id);
  else url.searchParams.delete("collection");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

export function SmartCollectionsPage() {
  const { locale, tx } = useI18n();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bookmarkTags, setBookmarkTags] = useState<Record<string, string[]>>({});
  const [inboxIds, setInboxIds] = useState<Set<string>>(() => new Set());
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => selectedCollectionFromLocation());
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [showBulkOrganizer, setShowBulkOrganizer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const selected = useMemo(
    () => collections.find((collection) => collection.id === selectedId) ?? null,
    [collections, selectedId],
  );

  const draftFilters = useMemo(() => {
    try {
      return filtersFromDraft(draft, tx);
    } catch {
      return {} as SmartCollectionFilters;
    }
  }, [draft, tx]);

  const draftFilterChips = useMemo(
    () => formatCollectionFilterLabels(draftFilters, categoryById, locale, tx),
    [categoryById, draftFilters, locale, tx],
  );

  const preview = useMemo(
    () => bookmarks.filter((bookmark) => matchesSmartCollection(bookmark, draftFilters, bookmarkTags[bookmark.id] ?? [], inboxIds)),
    [bookmarkTags, bookmarks, draftFilters, inboxIds],
  );

  const selectedMatches = useMemo(
    () => selected
      ? bookmarks.filter((bookmark) => matchesSmartCollection(bookmark, selected.filters, bookmarkTags[bookmark.id] ?? [], inboxIds))
      : [],
    [bookmarkTags, bookmarks, inboxIds, selected],
  );

  const draftMatchesSaved = useMemo(() => {
    if (!selected || draft.name.trim() !== selected.name) return false;
    try {
      return filterSignature(filtersFromDraft(draft, tx)) === filterSignature(selected.filters);
    } catch {
      return false;
    }
  }, [draft, selected, tx]);

  const counts = useMemo(
    () =>
      new Map(
        collections.map((collection) => [
          collection.id,
          bookmarks.filter((bookmark) =>
            matchesSmartCollection(bookmark, collection.filters, bookmarkTags[bookmark.id] ?? [], inboxIds),
          ).length,
        ]),
      ),
    [bookmarkTags, bookmarks, collections, inboxIds],
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextBookmarks, nextCategories, nextTags, nextInbox, nextCollections] = await Promise.all([
        listBookmarks(),
        listCategories(),
        listBookmarkTags(),
        listInbox(),
        listSmartCollections(),
      ]);
      setBookmarks(nextBookmarks);
      setCategories(nextCategories);
      setBookmarkTags(nextTags);
      setInboxIds(new Set(nextInbox.map((bookmark) => bookmark.id)));
      setCollections(nextCollections);
      if (selectedId) {
        const current = nextCollections.find((collection) => collection.id === selectedId);
        if (current) setDraft(draftFromCollection(current));
        else {
          setSelectedId(null);
          setDraft(emptyDraft);
          setShowBulkOrganizer(false);
          syncCollectionLocation(null);
        }
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not load Smart Collections.", "无法加载智能合集。"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (showBulkOrganizer && !draftMatchesSaved) setShowBulkOrganizer(false);
  }, [draftMatchesSaved, showBulkOrganizer]);

  function choose(collection: SmartCollection) {
    setSelectedId(collection.id);
    setDraft(draftFromCollection(collection));
    setShowBulkOrganizer(false);
    syncCollectionLocation(collection.id);
    setError(null);
    setNotice(null);
  }

  function newCollection() {
    setSelectedId(null);
    setDraft(emptyDraft);
    setShowBulkOrganizer(false);
    syncCollectionLocation(null);
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    let filters: SmartCollectionFilters;
    try {
      filters = filtersFromDraft(draft, tx);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Invalid filters.", "筛选条件无效。"));
      return;
    }
    if (!draft.name.trim()) {
      setError(tx("Choose a Smart Collection name.", "请输入智能合集名称。"));
      return;
    }
    setBusy(true);
    try {
      const saved = selected
        ? await updateSmartCollection(selected.id, draft.name.trim(), filters)
        : await createSmartCollection(draft.name.trim(), filters);
      await refresh();
      setSelectedId(saved.id);
      setDraft(draftFromCollection(saved));
      setShowBulkOrganizer(false);
      syncCollectionLocation(saved.id);
      setNotice(
        selected
          ? tx("Smart Collection updated.", "智能合集已更新。")
          : tx("Smart Collection saved.", "智能合集已保存。"),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not save Smart Collection.", "无法保存智能合集。"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !selected ||
      !window.confirm(
        tx(
          `Delete Smart Collection “${selected.name}”? Bookmarks are not deleted.`,
          `确定删除智能合集「${selected.name}」吗？其中的书签不会被删除。`,
        ),
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteSmartCollection(selected.id);
      setSelectedId(null);
      setDraft(emptyDraft);
      setShowBulkOrganizer(false);
      syncCollectionLocation(null);
      await refresh();
      setNotice(tx("Smart Collection deleted. Bookmarks were untouched.", "智能合集已删除，书签未受影响。"));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not delete Smart Collection.", "无法删除智能合集。"),
      );
    } finally {
      setBusy(false);
    }
  }

  const bulkButtonLabel = !selected
    ? tx("Bulk organize matches", "批量整理匹配项")
    : !draftMatchesSaved
      ? tx("Save changes to bulk organize", "保存更改后可批量整理")
      : showBulkOrganizer
        ? tx("Close bulk organizer", "收起批量整理")
        : selectedMatches.length > MAX_LIBRARY_BATCH
          ? tx(`Bulk organize first ${MAX_LIBRARY_BATCH}`, `批量整理前 ${MAX_LIBRARY_BATCH} 项`)
          : tx(
              `Bulk organize ${selectedMatches.length} match${selectedMatches.length === 1 ? "" : "es"}`,
              `批量整理 ${selectedMatches.length} 项匹配`,
            );

  return (
    <main className="smart-shell">
      <header className="smart-hero">
        <div className="smart-hero-copy">
          <h1>{tx("Smart Collections", "智能合集")}</h1>
          <p>
            {tx(
              "Reusable live filter views over your bookmark library. Collections never move, duplicate, or mutate bookmarks.",
              "基于现有书签库的实时筛选视图，不会移动、复制或修改任何书签。",
            )}
          </p>
        </div>
        <div className="smart-hero-pills">
          <span className="smart-stat-pill">
            <strong>{collections.length}</strong>
            <span>{tx("collections", "个智能合集")}</span>
          </span>
          <span className="smart-stat-pill muted">
            <strong>{bookmarks.length}</strong>
            <span>{tx("bookmarks", "条书签")}</span>
          </span>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="smart-grid">
        <aside className="smart-list panel">
          <div className="smart-list-heading">
            <div>
              <strong>{tx("Collections", "合集列表")}</strong>
              <span>{tx("Counts reflect live library state.", "数量随书签库实时更新。")}</span>
            </div>
            <button className="secondary" type="button" onClick={newCollection}>
              {tx("New", "新建")}
            </button>
          </div>
          {loading ? (
            <div className="smart-empty">{tx("Loading…", "加载中…")}</div>
          ) : collections.length ? (
            collections.map((collection) => {
              const labels = formatCollectionFilterLabels(collection.filters, categoryById, locale, tx);
              return (
                <button
                  className={`smart-list-row${selectedId === collection.id ? " active" : ""}`}
                  type="button"
                  key={collection.id}
                  onClick={() => choose(collection)}
                >
                  <span>
                    <strong>{collection.name}</strong>
                    <small>
                      {labels.length ? labels.join(" · ") : tx("All bookmarks", "全部书签")}
                    </small>
                  </span>
                  <em>{counts.get(collection.id) ?? 0}</em>
                </button>
              );
            })
          ) : (
            <div className="smart-empty">
              {tx("No Smart Collections yet.", "还没有智能合集。")}
            </div>
          )}
        </aside>

        <section className="smart-editor panel">
          <form onSubmit={save}>
            <div className="smart-editor-heading">
              <div>
                <h2>{selected ? selected.name : tx("New Smart Collection", "新建智能合集")}</h2>
                <span>
                  {selected
                    ? tx("Edit filters and preview live matches.", "调整筛选条件并实时预览匹配书签。")
                    : tx("Combine rules to build a reusable view.", "组合筛选条件创建可复用的实时视图。")}
                </span>
              </div>
              <div className="smart-actions">
                {selected && (
                  <button
                    className="text-action danger-text"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {tx("Delete", "删除")}
                  </button>
                )}
                <button className="primary" disabled={busy || !draft.name.trim()}>
                  {busy
                    ? tx("Saving…", "保存中…")
                    : selected
                      ? tx("Save changes", "保存更改")
                      : tx("Save collection", "保存合集")}
                </button>
              </div>
            </div>

            <div className="smart-filter-grid">
              <label>
                <span>{tx("Name", "名称")}</span>
                <input
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder={tx("Dev docs", "开发文档")}
                />
              </label>

              <label>
                <span>{tx("Category", "分类")}</span>
                <select
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                >
                  <option value="any">{tx("Any category", "全部分类")}</option>
                  <option value="uncategorized">{tx("Uncategorized", "未分类")}</option>
                  {categories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>{tx("Required tags", "必选标签")}</span>
                <input
                  value={draft.tagsText}
                  onChange={(event) => setDraft({ ...draft, tagsText: event.target.value })}
                  placeholder={tx("dev, docs", "dev, 文档")}
                />
                <small>{tx("All listed tags must match.", "需同时包含列出的全部标签。")}</small>
              </label>

              <label>
                <span>{tx("Domain", "域名")}</span>
                <input
                  value={draft.domain}
                  onChange={(event) => setDraft({ ...draft, domain: event.target.value })}
                  placeholder="github.com"
                />
                <small>{tx("Includes matching subdomains.", "同时匹配该域名的子域名。")}</small>
              </label>

              <label>
                <span>{tx("Health", "健康检查")}</span>
                <select
                  value={draft.healthStatus}
                  onChange={(event) => setDraft({ ...draft, healthStatus: event.target.value as Draft["healthStatus"] })}
                >
                  <option value="any">{tx("Any health status", "全部健康状态")}</option>
                  {HEALTH_STATUSES.map((status) => (
                    <option value={status} key={status}>
                      {HEALTH_STATUS_LABELS[locale][status]}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>{tx("Inbox state", "收件箱状态")}</span>
                <select
                  value={draft.inbox}
                  onChange={(event) => setDraft({ ...draft, inbox: event.target.value as InboxDraft })}
                >
                  <option value="any">{tx("Inbox + Library", "收件箱与书签库")}</option>
                  <option value="inbox">{tx("Inbox only", "仅收件箱")}</option>
                  <option value="library">{tx("Filed library", "已归档书签库")}</option>
                </select>
              </label>
            </div>
          </form>

          <div className="smart-preview-heading">
            <div>
              <strong>{tx("Live preview", "实时预览")}</strong>
              <span>
                {tx(
                  `${preview.length} of ${bookmarks.length} bookmarks`,
                  `共 ${bookmarks.length} 条书签中匹配 ${preview.length} 条`,
                )}
              </span>
            </div>
            <div className="smart-preview-actions">
              {selected && (
                <button
                  className="secondary"
                  type="button"
                  disabled={loading || !draftMatchesSaved || !selectedMatches.length}
                  {...(!draftMatchesSaved
                    ? {
                        title: tx(
                          "Save the collection before handing its matches into bulk organization.",
                          "将匹配项送入批量整理前，请先保存合集更改。",
                        ),
                      }
                    : {})}
                  onClick={() => setShowBulkOrganizer((current) => !current)}
                >
                  {bulkButtonLabel}
                </button>
              )}
              <button className="text-action" type="button" disabled={loading} onClick={() => void refresh()}>
                {tx("Refresh data", "刷新数据")}
              </button>
            </div>
          </div>

          <div className="smart-filter-chips" aria-label={tx("Active filters", "当前筛选条件")}>
            {draftFilterChips.length ? (
              draftFilterChips.map((chip) => (
                <span className="smart-filter-chip" key={chip}>
                  {chip}
                </span>
              ))
            ) : (
              <span className="smart-filter-chip is-all">{tx("All bookmarks", "全部书签")}</span>
            )}
          </div>

          <div className="smart-preview-list">
            {preview.slice(0, 100).map((bookmark) => (
              <article className="smart-bookmark" key={bookmark.id}>
                <div className="smart-bookmark-main">
                  <BookmarkFavicon
                    iconUrl={bookmark.iconUrl ?? null}
                    title={bookmark.title}
                    url={bookmark.url}
                    className="smart-bookmark-icon"
                  />
                  <div className="smart-bookmark-copy">
                    <a href={bookmark.url} target="_blank" rel="noreferrer">
                      <strong>{bookmark.title}</strong>
                    </a>
                    <small>
                      {safeDomainLabel(bookmark.url)} ·{" "}
                      {bookmark.categoryId
                        ? categoryById.get(bookmark.categoryId) ?? tx("Unknown category", "未知分类")
                        : tx("Uncategorized", "未分类")}
                    </small>
                    {bookmark.description && <p>{bookmark.description}</p>}
                  </div>
                </div>
                <div className="smart-bookmark-meta">
                  <span>{HEALTH_STATUS_LABELS[locale][bookmark.healthStatus]}</span>
                  {inboxIds.has(bookmark.id) && <span className="is-inbox">{tx("Inbox", "收件箱")}</span>}
                  {(bookmarkTags[bookmark.id] ?? []).slice(0, 4).map((tag) => (
                    <span key={tag.toLocaleLowerCase()}>#{tag}</span>
                  ))}
                </div>
              </article>
            ))}
            {!preview.length && (
              <div className="smart-empty">
                {tx("No bookmarks match this filter combination.", "没有书签匹配当前的筛选条件。")}
              </div>
            )}
            {preview.length > 100 && (
              <div className="smart-empty">
                {tx(
                  `Showing the first 100 of ${preview.length} matches.`,
                  `已显示前 100 条，共匹配 ${preview.length} 条。`,
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {showBulkOrganizer && selected && draftMatchesSaved && (
        <div className="smart-bulk-handoff">
          <div className="smart-bulk-handoff-heading">
            <div>
              <h2>{tx(`Bulk organize · ${selected.name}`, `批量整理 · ${selected.name}`)}</h2>
            </div>
            <span>
              {tx(
                `${selectedMatches.length} live match${selectedMatches.length === 1 ? "" : "es"} · up to ${MAX_LIBRARY_BATCH} per batch`,
                `实时匹配 ${selectedMatches.length} 项 · 单批最多选择 ${MAX_LIBRARY_BATCH} 项`,
              )}
            </span>
          </div>
          <LibraryBulkOrganizer
            key={selected.id}
            bookmarks={selectedMatches}
            categories={categories}
            bookmarkTags={bookmarkTags}
            onChanged={refresh}
            contextLabel={tx(`Smart Collection “${selected.name}”`, `智能合集「${selected.name}」`)}
            preselectMatches
          />
        </div>
      )}
    </main>
  );
}
