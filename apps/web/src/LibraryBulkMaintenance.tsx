/**
 * [INPUT]: depends on Bookmark, HealthPolicy, HEALTH_POLICY_LABELS from @dockmark/core; bookmarkMatchesQuery from ./bookmark-search; listArchivedBookmarks, maintainLibraryBatch, MAX_LIBRARY_MAINTENANCE_BATCH from ./library-maintenance-api; useI18n from ./i18n
 * [OUTPUT]: exports LibraryBulkMaintenance component
 * [POS]: reviewed bulk health-policy, archive, restore, and permanent-delete workflow inside the Health tab
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState } from "react";
import { HEALTH_POLICY_LABELS, type Bookmark, type HealthPolicy } from "@dockmark/core";
import { bookmarkMatchesQuery } from "./bookmark-search";
import { useI18n } from "./i18n";
import {
  listArchivedBookmarks,
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

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function LibraryBulkMaintenance({ bookmarks, bookmarkTags, categoryNameById, onChanged }: Props) {
  const { locale, tx } = useI18n();
  const policyLabels = HEALTH_POLICY_LABELS[locale];
  const genericError = tx("Something went wrong.", "操作失败，请重试。");
  const uncategorizedLabel = tx("Uncategorized", "未分类");

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
    setArchived(await listArchivedBookmarks());
  }

  useEffect(() => {
    void refreshArchived().catch((caught) => setError(messageFrom(caught, genericError)));
  }, []);

  const source = scope === "active" ? bookmarks : archived;
  const candidates = useMemo(() => source.filter((bookmark) => {
    const category = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "" : uncategorizedLabel;
    return bookmarkMatchesQuery(bookmark, category, bookmarkTags[bookmark.id] ?? [], query);
  }), [bookmarkTags, categoryNameById, query, source, uncategorizedLabel]);
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
    setNotice(
      candidates.length > MAX_LIBRARY_MAINTENANCE_BATCH
        ? tx(`Selected the first ${MAX_LIBRARY_MAINTENANCE_BATCH} matches.`, `已选择前 ${MAX_LIBRARY_MAINTENANCE_BATCH} 个匹配项。`)
        : null,
    );
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
      if (action === "set-health-policy") {
        setNotice(tx(
          `Updated health policy to ${policyLabels[healthPolicy]} for ${result.applied} bookmark${result.applied === 1 ? "" : "s"}.`,
          `已将 ${result.applied} 个书签的健康策略更新为「${policyLabels[healthPolicy]}」。`,
        ));
      } else if (action === "archive") {
        setNotice(tx(`Archived ${result.applied} bookmark${result.applied === 1 ? "" : "s"}.`, `已归档 ${result.applied} 个书签。`));
      } else if (action === "restore") {
        setNotice(tx(`Restored ${result.applied} bookmark${result.applied === 1 ? "" : "s"}.`, `已恢复 ${result.applied} 个书签。`));
      } else {
        setNotice(tx(`Permanently deleted ${result.applied} bookmark${result.applied === 1 ? "" : "s"}.`, `已永久删除 ${result.applied} 个书签。`));
      }
    } catch (caught) {
      setError(messageFrom(caught, genericError));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="management library-bulk-management" aria-label={tx("Reviewed bulk maintenance", "批量维护")}>
      <div className="form-card library-bulk-card">
        <div className="library-bulk-heading">
          <div>
            <h2>{tx("Bulk maintain", "批量维护与归档")}</h2>
            <p>
              {tx(
                "Health policy and lifecycle actions require explicit review. Archiving is reversible; permanent deletion is only available from Archive.",
                "健康策略调整与归档删除均需复核确认。归档可随时恢复；仅已归档书签支持永久删除。",
              )}
            </p>
          </div>
          <div className="library-bulk-selection">
            <strong>{tx(`${selectedIds.size} selected`, `已选 ${selectedIds.size} 项`)}</strong>
            <button className="text-action" type="button" disabled={reviewing || applying || !candidates.length} onClick={selectMatches}>
              {tx("Select matches", "选择匹配项")}
            </button>
            <button
              className="text-action muted-action"
              type="button"
              disabled={applying || !selectedIds.size}
              onClick={() => { setSelectedIds(new Set()); setReviewing(false); }}
            >
              {tx("Clear", "清空")}
            </button>
          </div>
        </div>

        <div className="library-bulk-actions">
          <button className={scope === "active" ? "primary" : "secondary"} type="button" disabled={applying} onClick={() => setScope("active")}>
            {tx(`Active (${bookmarks.length})`, `活跃书签 (${bookmarks.length})`)}
          </button>
          <button className={scope === "archived" ? "primary" : "secondary"} type="button" disabled={applying} onClick={() => setScope("archived")}>
            {tx(`Archived (${archived.length})`, `已归档 (${archived.length})`)}
          </button>
        </div>

        <div className="library-bulk-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            disabled={reviewing || applying}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={scope === "active"
              ? tx("Filter active bookmarks…", "筛选活跃书签…")
              : tx("Filter archived bookmarks…", "筛选已归档书签…")}
          />
          <strong>{tx(`${candidates.length} match${candidates.length === 1 ? "" : "es"}`, `${candidates.length} 个匹配`)}</strong>
        </div>

        <div className="library-bulk-picker">
          {candidates.slice(0, 100).map((bookmark) => (
            <label className={`library-bulk-bookmark library-bulk-bookmark-policy${selectedIds.has(bookmark.id) ? " selected" : ""}`} key={bookmark.id}>
              <input
                type="checkbox"
                checked={selectedIds.has(bookmark.id)}
                disabled={reviewing || applying || (!selectedIds.has(bookmark.id) && selectedIds.size >= MAX_LIBRARY_MAINTENANCE_BATCH)}
                onChange={() => toggle(bookmark.id)}
              />
              <span><strong>{bookmark.title}</strong><small>{bookmark.url}</small></span>
              <small className="library-bulk-policy-pill">{policyLabels[bookmark.healthPolicy]}</small>
            </label>
          ))}
          {!candidates.length && (
            <p className="empty-copy">
              {scope === "active"
                ? tx("No active bookmarks match this filter.", "没有匹配的活跃书签。")
                : tx("No archived bookmarks match this filter.", "没有匹配的已归档书签。")}
            </p>
          )}
        </div>

        <div className="library-bulk-grid">
          <label>
            <span>{tx("Action", "操作")}</span>
            <select
              value={action}
              disabled={reviewing || applying}
              onChange={(event) => {
                setAction(event.target.value as LibraryMaintenanceAction);
                setReviewing(false);
                setDeleteConfirmation("");
              }}
            >
              {scope === "active" ? (
                <>
                  <option value="set-health-policy">{tx("Set health policy", "设置健康策略")}</option>
                  <option value="archive">{tx("Archive", "归档")}</option>
                </>
              ) : (
                <>
                  <option value="restore">{tx("Restore to Library", "恢复到书签库")}</option>
                  <option value="delete">{tx("Permanent delete", "永久删除")}</option>
                </>
              )}
            </select>
          </label>
          {action === "set-health-policy" && (
            <label>
              <span>{tx("Health policy", "健康检查策略")}</span>
              <select
                value={healthPolicy}
                disabled={reviewing || applying}
                onChange={(event) => setHealthPolicy(event.target.value as HealthPolicy)}
              >
                <option value="normal">{policyLabels.normal}</option>
                <option value="ignore">{policyLabels.ignore}</option>
                <option value="local-only">{policyLabels["local-only"]}</option>
                <option value="manual">{policyLabels.manual}</option>
              </select>
            </label>
          )}
        </div>

        {error && <div className="inline-form-feedback error" role="alert">{error}</div>}
        {notice && <div className="inline-form-feedback success" role="status">{notice}</div>}

        {!reviewing ? (
          <div className="library-bulk-actions">
            <button className="primary" type="button" disabled={!canReview} onClick={() => setReviewing(true)}>
              {selectedIds.size
                ? tx(`Review ${selectedIds.size} maintenance change${selectedIds.size === 1 ? "" : "s"}`, `复核 ${selectedIds.size} 项维护变更`)
                : tx("Review maintenance changes", "复核维护变更")}
            </button>
            <span className="library-bulk-help">
              {tx(`Up to ${MAX_LIBRARY_MAINTENANCE_BATCH} bookmarks per reviewed batch.`, `单次最多复核 ${MAX_LIBRARY_MAINTENANCE_BATCH} 个书签。`)}
            </span>
          </div>
        ) : (
          <div className="library-bulk-review">
            <div>
              <strong>{tx("Review before apply", "应用前确认")}</strong>
              <p>
                {tx(`${selectedIds.size} bookmark${selectedIds.size === 1 ? "" : "s"} selected. `, `已选择 ${selectedIds.size} 个书签。`)}
                {action === "archive"
                  ? tx("Archiving removes them from active Library, Inbox, and public selection without deleting data.", "归档会将其移出活跃书签库、收件箱和公开主页，不会删除数据。")
                  : action === "delete"
                    ? tx("Permanent deletion cannot be undone and is allowed only from Archive.", "永久删除不可撤销，且仅限对已归档书签执行。")
                    : tx("The batch is applied atomically after validation.", "校验通过后将一次性原子提交。")}
              </p>
            </div>
            <div className="library-bulk-review-summary">
              <span>
                {action === "set-health-policy"
                  ? tx(`Set health policy → ${policyLabels[healthPolicy]}`, `设置健康策略 → ${policyLabels[healthPolicy]}`)
                  : action === "archive"
                    ? tx("Archive selected bookmarks", "归档所选书签")
                    : action === "restore"
                      ? tx("Restore selected bookmarks", "恢复所选书签")
                      : tx("Permanently delete selected bookmarks", "永久删除所选书签")}
              </span>
            </div>
            <div className="library-bulk-review-list">
              {selected.slice(0, 8).map((bookmark) => <span key={bookmark.id}>{bookmark.title}</span>)}
              {selected.length > 8 && <span>{tx(`+${selected.length - 8} more`, `另有 ${selected.length - 8} 项`)}</span>}
            </div>
            {action === "delete" && (
              <label className="library-bulk-confirm-field">
                <span>{tx("Type DELETE to confirm permanent deletion", "输入 DELETE 确认永久删除")}</span>
                <input
                  value={deleteConfirmation}
                  disabled={applying}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </label>
            )}
            <div className="library-bulk-actions">
              <button
                className={action === "delete" ? "danger-button" : "primary"}
                type="button"
                disabled={applying || !deleteReady}
                onClick={() => void applyReviewed()}
              >
                {applying
                  ? tx("Applying…", "应用中…")
                  : action === "delete"
                    ? tx(`Delete ${selectedIds.size} permanently`, `永久删除 ${selectedIds.size} 项`)
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
