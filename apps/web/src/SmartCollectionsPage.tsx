import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Bookmark, Category, HealthStatus } from "@dockmark/core";
import { listBookmarks, listCategories } from "./api";
import { listInbox } from "./inbox-api";
import { listBookmarkTags } from "./tag-api";
import { matchesSmartCollection } from "./smart-collection-match";
import {
  createSmartCollection,
  deleteSmartCollection,
  listSmartCollections,
  updateSmartCollection,
  type SmartCollection,
  type SmartCollectionFilters,
} from "./smart-collections-api";
import "./smart-collections.css";

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

const healthStatuses = Object.keys(healthLabels) as HealthStatus[];

type CategoryDraft = "any" | "uncategorized" | string;
type InboxDraft = "any" | "inbox" | "library";

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

function tagsFromText(value: string) {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[;,\n]/)) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) throw new Error("Each Smart Collection tag must be 40 characters or fewer.");
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > 8) throw new Error("A Smart Collection can require at most 8 tags.");
  return tags;
}

function filtersFromDraft(draft: Draft): SmartCollectionFilters {
  const filters: SmartCollectionFilters = {};
  if (draft.category === "uncategorized") filters.categoryId = null;
  else if (draft.category !== "any") filters.categoryId = draft.category;
  const tags = tagsFromText(draft.tagsText);
  if (tags.length) filters.tags = tags;
  if (draft.domain.trim()) filters.domain = draft.domain.trim().toLocaleLowerCase().replace(/^\.+|\.+$/g, "");
  if (draft.healthStatus !== "any") filters.healthStatus = draft.healthStatus;
  if (draft.inbox !== "any") filters.inbox = draft.inbox;
  return filters;
}

function draftFromCollection(collection: SmartCollection): Draft {
  const { filters } = collection;
  return {
    name: collection.name,
    category: Object.prototype.hasOwnProperty.call(filters, "categoryId")
      ? filters.categoryId === null ? "uncategorized" : filters.categoryId ?? "any"
      : "any",
    tagsText: (filters.tags ?? []).join(", "),
    domain: filters.domain ?? "",
    healthStatus: filters.healthStatus ?? "any",
    inbox: filters.inbox ?? "any",
  };
}

function hostLabel(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function selectedCollectionFromLocation() {
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
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bookmarkTags, setBookmarkTags] = useState<Record<string, string[]>>({});
  const [inboxIds, setInboxIds] = useState<Set<string>>(() => new Set());
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => selectedCollectionFromLocation());
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const selected = useMemo(() => collections.find((collection) => collection.id === selectedId) ?? null, [collections, selectedId]);

  const draftFilters = useMemo(() => {
    try { return filtersFromDraft(draft); } catch { return {} as SmartCollectionFilters; }
  }, [draft]);

  const preview = useMemo(
    () => bookmarks.filter((bookmark) => matchesSmartCollection(bookmark, draftFilters, bookmarkTags[bookmark.id] ?? [], inboxIds)),
    [bookmarkTags, bookmarks, draftFilters, inboxIds],
  );

  const counts = useMemo(() => new Map(collections.map((collection) => [
    collection.id,
    bookmarks.filter((bookmark) => matchesSmartCollection(bookmark, collection.filters, bookmarkTags[bookmark.id] ?? [], inboxIds)).length,
  ])), [bookmarkTags, bookmarks, collections, inboxIds]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextBookmarks, nextCategories, nextTags, nextInbox, nextCollections] = await Promise.all([
        listBookmarks(), listCategories(), listBookmarkTags(), listInbox(), listSmartCollections(),
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
          syncCollectionLocation(null);
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Smart Collections.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  function choose(collection: SmartCollection) {
    setSelectedId(collection.id);
    setDraft(draftFromCollection(collection));
    syncCollectionLocation(collection.id);
    setError(null);
    setNotice(null);
  }

  function newCollection() {
    setSelectedId(null);
    setDraft(emptyDraft);
    syncCollectionLocation(null);
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    let filters: SmartCollectionFilters;
    try { filters = filtersFromDraft(draft); } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid filters.");
      return;
    }
    if (!draft.name.trim()) { setError("Choose a Smart Collection name."); return; }
    setBusy(true);
    try {
      const saved = selected
        ? await updateSmartCollection(selected.id, draft.name.trim(), filters)
        : await createSmartCollection(draft.name.trim(), filters);
      await refresh();
      setSelectedId(saved.id);
      setDraft(draftFromCollection(saved));
      syncCollectionLocation(saved.id);
      setNotice(selected ? "Smart Collection updated." : "Smart Collection saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Smart Collection.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete Smart Collection “${selected.name}”? Bookmarks are not deleted.`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteSmartCollection(selected.id);
      setSelectedId(null);
      setDraft(emptyDraft);
      syncCollectionLocation(null);
      await refresh();
      setNotice("Smart Collection deleted. Bookmarks were untouched.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete Smart Collection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="smart-shell">
      <section className="smart-hero">
        <div><p className="eyebrow">SMART LIBRARY</p><h1>Saved filters,<br />live results.</h1><p>Smart Collections are reusable views over your existing bookmarks. They never move, duplicate or mutate a bookmark.</p></div>
        <div className="smart-summary"><strong>{collections.length}</strong><span>saved collections</span></div>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="smart-grid">
        <aside className="smart-list panel">
          <div className="smart-list-heading"><div><strong>Collections</strong><span>Counts update from current library state.</span></div><button className="secondary" type="button" onClick={newCollection}>New</button></div>
          {loading ? <div className="smart-empty">Loading…</div> : collections.length ? collections.map((collection) => (
            <button className={`smart-list-row${selectedId === collection.id ? " active" : ""}`} type="button" key={collection.id} onClick={() => choose(collection)}>
              <span><strong>{collection.name}</strong><small>{Object.keys(collection.filters).length ? "Filtered view" : "All bookmarks"}</small></span><em>{counts.get(collection.id) ?? 0}</em>
            </button>
          )) : <div className="smart-empty">No Smart Collections yet.</div>}
        </aside>

        <section className="smart-editor panel">
          <form onSubmit={save}>
            <div className="smart-editor-heading"><div><p className="eyebrow">{selected ? "EDIT COLLECTION" : "NEW COLLECTION"}</p><h2>{selected ? selected.name : "Build a saved view"}</h2></div><div className="smart-actions">{selected && <button className="text-action danger-text" type="button" disabled={busy} onClick={() => void remove()}>Delete</button>}<button className="primary" disabled={busy || !draft.name.trim()}>{busy ? "Saving…" : selected ? "Save changes" : "Save collection"}</button></div></div>
            <div className="smart-filter-grid">
              <label><span>Name</span><input maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Dev docs" /></label>
              <label><span>Category</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option value="any">Any category</option><option value="uncategorized">Uncategorized</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
              <label><span>Required tags</span><input value={draft.tagsText} onChange={(event) => setDraft({ ...draft, tagsText: event.target.value })} placeholder="dev, docs" /><small>All listed tags must match.</small></label>
              <label><span>Domain</span><input value={draft.domain} onChange={(event) => setDraft({ ...draft, domain: event.target.value })} placeholder="github.com" /><small>Includes matching subdomains.</small></label>
              <label><span>Health</span><select value={draft.healthStatus} onChange={(event) => setDraft({ ...draft, healthStatus: event.target.value as Draft["healthStatus"] })}><option value="any">Any health status</option>{healthStatuses.map((status) => <option value={status} key={status}>{healthLabels[status]}</option>)}</select></label>
              <label><span>Inbox state</span><select value={draft.inbox} onChange={(event) => setDraft({ ...draft, inbox: event.target.value as InboxDraft })}><option value="any">Inbox + Library</option><option value="inbox">Inbox only</option><option value="library">Filed library only</option></select></label>
            </div>
          </form>

          <div className="smart-preview-heading"><div><strong>Live preview</strong><span>{preview.length} of {bookmarks.length} bookmarks</span></div><button className="text-action" type="button" disabled={loading} onClick={() => void refresh()}>Refresh data</button></div>
          <div className="smart-preview-list">
            {preview.slice(0, 100).map((bookmark) => (
              <article className="smart-bookmark" key={bookmark.id}>
                <div><a href={bookmark.url} target="_blank" rel="noreferrer"><strong>{bookmark.title}</strong></a><small>{hostLabel(bookmark.url)} · {bookmark.categoryId ? categoryById.get(bookmark.categoryId) ?? "Unknown category" : "Uncategorized"}</small>{bookmark.description && <p>{bookmark.description}</p>}</div>
                <div className="smart-bookmark-meta"><span>{healthLabels[bookmark.healthStatus]}</span>{inboxIds.has(bookmark.id) && <span>Inbox</span>}{(bookmarkTags[bookmark.id] ?? []).slice(0, 4).map((tag) => <span key={tag.toLocaleLowerCase()}>#{tag}</span>)}</div>
              </article>
            ))}
            {!preview.length && <div className="smart-empty">No bookmarks match this filter combination.</div>}
            {preview.length > 100 && <div className="smart-empty">Showing the first 100 of {preview.length} matches.</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
