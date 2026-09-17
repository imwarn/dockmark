import { useEffect, useMemo, useState } from "react";
import type { Bookmark, HealthPolicy } from "@dockmark/core";
import { listBookmarks } from "./api";
import { bookmarkMatchesQuery } from "./bookmark-search";
import {
  maintainLibraryBatch,
  MAX_LIBRARY_MAINTENANCE_BATCH,
  type LibraryMaintenanceAction,
} from "./library-maintenance-api";
import "./library-bulk.css";

interface Props {
  bookmarks: Bookmark[];
  bookmarkTags: Record<string, string[]>;
  categoryNameById: Map<string, string>;
  onChanged: () => Promise<void>;
}

type Scope = "active" | "archived";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function LibraryBulkMaintenance({ bookmarks, bookmarkTags, categoryNameById, onChanged }: Props) {
  const [scope, setScope] = useState<Scope>("active");
  const [archived, setArchived] = useState<Bookmark[]>([]);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [action, setAction] = useState<LibraryMaintenanceAction>("set-health-policy");
  const [healthPolicy, setHealthPolicy] = useState<HealthPolicy>("normal");
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshArchived() {
    setArchived(await listBookmarks("archived"));
  }

  useEffect(() => {
    void refreshArchived().catch((caught) => setError(messageFrom(caught)));
  }, []);

  const source = scope === "active" ? bookmarks : archived;
  const candidates = useMemo(() => source.filter((bookmark) => {
    const category = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "" : "Uncategorized";
    return bookmarkMatchesQuery(bookmark, category, bookmarkTags[bookmark.id] ?? [], query);
  }), [bookmarkTags, categoryNameById, query, source]);
  const selected = useMemo(() => source.filter((bookmark) => selectedIds.has(bookmark.id)), [selectedIds, source]);

  useEffect(() => {
    setSelectedIds(new Set());
    setReviewing(false);
    setDeleteConfirmation("");
    setError(null);
    setNotice(null);
    setAction(scope === "active" ? "set-health-policy" : "restore");
  }, [scope]);

  const validAction = scope === "active"
    ? action === "set-health-policy" || action === "archive"
    : action === "restore" || action === "delete";
  const canReview = selectedIds.size > 0 && selectedIds.size <= MAX_LIBRARY_MAINTENANCE_BATCH && validAction && !applying;
  const deleteReady = action !== "delete" || deleteConfirmation === "DELETE";

  function toggle(id: string) {
    if (reviewing || applying) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_LIBRARY_MAINTENANCE_BATCH) next.add(id);
      return next;
    });
  }

  function selectMatches() {
    setSelectedIds(new Set(candidates.slice(0, MAX_LIBRARY_MAINTENANCE_BATCH).map((bookmark) => bookmark.id)));
    setNotice(candidates.length > MAX_LIBRARY_MAINTENANCE_BATCH
      ? `Selected the first ${MAX_LIBRARY_MAINTENANCE_BATCH} matches.`
      : null);
  }

  async function applyReviewed() {
    if (!canReview || !deleteReady) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const result = await maintainLibraryBatch({
        bookmarkIds: Array.from(selectedIds),
        action,
        ...(action === "set-health-policy" ? { healthPolicy } : {}),
        ...(action === "delete" ? { confirmation: deleteConfirmation } : {}),
      });
      await onChanged();
      await refreshArchived();
      setSelectedIds(new Set());
      setReviewing(false);
      setDeleteConfirmation("");
      const verb = action === "set-health-policy" ? `Updated HealthPolicy to ${healthPolicy} for`
        : action === "archive" ? "Archived"
          : action === "restore" ? "Restored"
            : "Permanently deleted";
      setNotice(`${verb} ${result.applied} bookmark${result.applied === 1 ? "" : "s"}.`);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="management library-bulk-management" aria-label="Reviewed bulk maintenance">
      <div className="form-card library-bulk-card">
        <div className="library-bulk-heading">
          <div>
            <p className="eyebrow">V5 · REVIEWED MAINTENANCE</p>
            <h2>Bulk maintain</h2>
            <p>HealthPolicy and destructive lifecycle changes stay behind an explicit review gate. Archive is reversible; permanent delete is archive-only.</p>
          </div>
          <div className="library-bulk-selection">
            <strong>{selectedIds.size} selected</strong>
            <button className="text-action" type="button" disabled={reviewing || applying || !candidates.length} onClick={selectMatches}>Select matches</button>
            <button className="text-action muted-action" type="button" disabled={applying || !selectedIds.size} onClick={() => { setSelectedIds(new Set()); setReviewing(false); }}>Clear</button>
          </div>
        </div>

        <div className="library-bulk-actions">
          <button className={scope === "active" ? "primary" : "secondary"} type="button" disabled={applying} onClick={() => setScope("active")}>Active ({bookmarks.length})</button>
          <button className={scope === "archived" ? "primary" : "secondary"} type="button" disabled={applying} onClick={() => setScope("archived")}>Archived ({archived.length})</button>
        </div>

        <div className="library-bulk-search">
          <span>⌕</span>
          <input value={query} disabled={reviewing || applying} onChange={(event) => setQuery(event.target.value)} placeholder={`Filter ${scope} bookmarks…`} />
          <strong>{candidates.length} match{candidates.length === 1 ? "" : "es"}</strong>
        </div>

        <div className="library-bulk-picker">
          {candidates.slice(0, 100).map((bookmark) => (
            <label className={`library-bulk-bookmark${selectedIds.has(bookmark.id) ? " selected" : ""}`} key={bookmark.id}>
              <input type="checkbox" checked={selectedIds.has(bookmark.id)} disabled={reviewing || applying || (!selectedIds.has(bookmark.id) && selectedIds.size >= MAX_LIBRARY_MAINTENANCE_BATCH)} onChange={() => toggle(bookmark.id)} />
              <span><strong>{bookmark.title}</strong><small>{bookmark.url}</small></span>
              <small>{bookmark.healthPolicy}</small>
            </label>
          ))}
          {!candidates.length && <p className="empty-copy">No {scope} bookmarks match this filter.</p>}
        </div>

        <div className="library-bulk-grid">
          <label>
            <span>Action</span>
            <select value={action} disabled={reviewing || applying} onChange={(event) => { setAction(event.target.value as LibraryMaintenanceAction); setReviewing(false); setDeleteConfirmation(""); }}>
              {scope === "active" ? <>
                <option value="set-health-policy">Set HealthPolicy</option>
                <option value="archive">Archive</option>
              </> : <>
                <option value="restore">Restore to Library</option>
                <option value="delete">Permanent delete</option>
              </>}
            </select>
          </label>
          {action === "set-health-policy" && <label>
            <span>HealthPolicy</span>
            <select value={healthPolicy} disabled={reviewing || applying} onChange={(event) => setHealthPolicy(event.target.value as HealthPolicy)}>
              <option value="normal">Normal</option>
              <option value="ignore">Ignore</option>
              <option value="local-only">Local only</option>
              <option value="manual">Manual</option>
            </select>
          </label>}
        </div>

        {error && <div className="inline-form-feedback error" role="alert">{error}</div>}
        {notice && <div className="inline-form-feedback success" role="status">{notice}</div>}

        {!reviewing ? <div className="library-bulk-actions">
          <button className="primary" type="button" disabled={!canReview} onClick={() => setReviewing(true)}>Review {selectedIds.size || ""} maintenance change{selectedIds.size === 1 ? "" : "s"}</button>
          <span className="library-bulk-help">Maximum {MAX_LIBRARY_MAINTENANCE_BATCH} bookmarks per reviewed batch.</span>
        </div> : <div className="library-bulk-review">
          <div>
            <strong>Review before apply</strong>
            <p>{selectedIds.size} bookmark{selectedIds.size === 1 ? "" : "s"} selected. {action === "archive" ? "Archive removes them from active Library, Inbox and public selection without deleting data." : action === "delete" ? "Permanent delete cannot be undone and is allowed only from Archived." : "The batch is applied atomically after validation."}</p>
          </div>
          <div className="library-bulk-review-summary">
            <span>{action === "set-health-policy" ? `Set HealthPolicy → ${healthPolicy}` : action === "archive" ? "Archive selected bookmarks" : action === "restore" ? "Restore selected bookmarks" : "Permanently delete selected bookmarks"}</span>
          </div>
          <div className="library-bulk-review-list">
            {selected.slice(0, 8).map((bookmark) => <span key={bookmark.id}>{bookmark.title}</span>)}
            {selected.length > 8 && <span>+{selected.length - 8} more</span>}
          </div>
          {action === "delete" && <label>
            <span>Type DELETE to confirm permanent deletion</span>
            <input value={deleteConfirmation} disabled={applying} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" />
          </label>}
          <div className="library-bulk-actions">
            <button className="primary" type="button" disabled={applying || !deleteReady} onClick={() => void applyReviewed()}>{applying ? "Applying…" : action === "delete" ? `Delete ${selectedIds.size} permanently` : `Apply to ${selectedIds.size}`}</button>
            <button className="secondary" type="button" disabled={applying} onClick={() => setReviewing(false)}>Back</button>
          </div>
        </div>}
      </div>
    </section>
  );
}
