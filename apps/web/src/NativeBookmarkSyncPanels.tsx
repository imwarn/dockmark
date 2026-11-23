/**
 * [INPUT]: depends on Bookmark, BookmarkConflictPreference, ResolvedLocale from @dockmark/core; ImportCandidate from ./bookmark-transfer; NativeMappingRow, NativeMappingState from ./native-bookmark-sync; useI18n from ./i18n
 * [OUTPUT]: exports NativeImportCandidate, folderCategory, conflictPreferenceLabel, NativeMappingPreviewPanel, and NativeImportTreePanel
 * [POS]: presentation panels extracted from NativeBookmarkImport.tsx to keep both files well under 800 lines
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import type { Bookmark, BookmarkConflictPreference, ResolvedLocale } from "@dockmark/core";
import type { ImportCandidate } from "./bookmark-transfer";
import { useI18n } from "./i18n";
import type { NativeMappingRow, NativeMappingState } from "./native-bookmark-sync";

export interface NativeImportCandidate extends ImportCandidate {
  browserBookmarkId: string;
  folderPath: string[];
  existingBookmarkId?: string;
  mappedDockmarkBookmarkId?: string | undefined;
}

export function folderCategory(path: string[]) {
  const cleaned = path.map((part) => part.trim()).filter(Boolean);
  if (!cleaned.length) return undefined;
  const joined = cleaned.join(" / ");
  return joined.length <= 80 ? joined : `…${joined.slice(-79)}`;
}

export function conflictPreferenceLabel(preference: BookmarkConflictPreference, locale: ResolvedLocale) {
  if (preference === "browser") return locale === "zh-CN" ? "优先浏览器" : "Prefer Browser";
  if (preference === "dockmark") return locale === "zh-CN" ? "优先 Dockmark" : "Prefer Dockmark";
  return locale === "zh-CN" ? "每次询问" : "Ask every time";
}

function localizedMappingStateLabel(state: NativeMappingState, locale: ResolvedLocale) {
  if (locale === "zh-CN") {
    switch (state) {
      case "synced": return "已同步";
      case "native-changed": return "浏览器已更新";
      case "native-missing": return "浏览器已移除";
      case "cloud-missing": return "Dockmark 缺失";
      case "mapping-stale": return "映射过期";
      case "cloud-changed": return "Dockmark 已更新";
      case "conflict": return "待复核";
    }
  }
  switch (state) {
    case "synced": return "Synced";
    case "native-changed": return "Browser changed";
    case "native-missing": return "Browser missing";
    case "cloud-missing": return "Dockmark missing";
    case "mapping-stale": return "Mapping stale";
    case "cloud-changed": return "Dockmark changed";
    case "conflict": return "Review";
  }
}

function localizedReviewDescription(state: NativeMappingState, locale: ResolvedLocale) {
  if (locale === "zh-CN") {
    switch (state) {
      case "cloud-missing":
        return "映射指向的 Dockmark 书签不在活跃书签库中（可能已归档或已删除），因此安全应用不会自动重建。请在书签库恢复，或解除该过期映射后重新导入。";
      case "cloud-changed":
        return "自建立映射基线后 Dockmark 端发生了变化。可保留 Dockmark 版本、采用浏览器版本，或重新关联到其他书签。";
      case "conflict":
        return "双方均有改动，或浏览器文件夹与 Dockmark 分类不一致。请选择以此映射的哪一侧为准。";
      default:
        return "此映射无需人工冲突复核。";
    }
  }
  switch (state) {
    case "cloud-missing":
      return "The mapped Dockmark bookmark is not in the active Library. It may be archived or deleted, so Safe Apply will not recreate it. Restore it in Library or unlink this stale mapping.";
    case "cloud-changed":
      return "Dockmark changed after this mapping baseline. Keep Dockmark, use the browser version, or re-link the browser bookmark.";
    case "conflict":
      return "Both sides changed, or the browser folder and Dockmark category diverged. Choose which state should become authoritative.";
    default:
      return "This mapping does not require manual conflict review.";
  }
}

interface MappingPanelProps {
  conflictPreference: BookmarkConflictPreference;
  mappingRows: NativeMappingRow[];
  preferredReviewCount: number;
  mappingStats: {
    total: number;
    synced: number;
    safe: number;
    conflicts: number;
    missing: number;
  };
  categoryNames: Map<string, string>;
  relinkOptions: Bookmark[];
  relinkTargets: Record<string, string>;
  writebackCapable: boolean;
  busy: boolean;
  policyApplying: boolean;
  onApplyPreferred: () => void;
  onApplySafe: () => void;
  onUseBrowser: (row: NativeMappingRow) => void;
  onKeepDockmark: (row: NativeMappingRow) => void;
  onWriteDockmarkToBrowser: (row: NativeMappingRow) => void;
  onRelinkTargetChange: (browserBookmarkId: string, value: string) => void;
  onRelinkMapping: (row: NativeMappingRow) => void;
  onUnlinkMapping: (browserBookmarkId: string) => void;
}

export function NativeMappingPreviewPanel({
  conflictPreference,
  mappingRows,
  preferredReviewCount,
  mappingStats,
  categoryNames,
  relinkOptions,
  relinkTargets,
  writebackCapable,
  busy,
  policyApplying,
  onApplyPreferred,
  onApplySafe,
  onUseBrowser,
  onKeepDockmark,
  onWriteDockmarkToBrowser,
  onRelinkTargetChange,
  onRelinkMapping,
  onUnlinkMapping,
}: MappingPanelProps) {
  const { locale, tx } = useI18n();
  const uncategorized = tx("Uncategorized", "未分类");

  return (
    <section className="mapping-preview">
      <div className="preview-heading">
        <div>
          <h2>{tx("Native ↔ Dockmark mappings", "浏览器 ↔ Dockmark 书签映射")}</h2>
          <p className="native-preview-meta">
            {tx("Conflict policy:", "冲突偏好：")} {conflictPreferenceLabel(conflictPreference, locale)}
          </p>
        </div>
        <div className="preview-actions">
          {conflictPreference !== "ask" && (
            <button
              className="secondary"
              type="button"
              onClick={onApplyPreferred}
              disabled={busy || policyApplying || !preferredReviewCount}
            >
              {policyApplying
                ? tx("Applying policy…", "应用策略中…")
                : tx(`Apply preferred (${preferredReviewCount})`, `按偏好应用 (${preferredReviewCount})`)}
            </button>
          )}
          <button
            className="primary"
            type="button"
            onClick={onApplySafe}
            disabled={busy || policyApplying || !mappingStats.safe}
          >
            {busy
              ? tx("Applying…", "应用中…")
              : tx(`Apply safe changes (${mappingStats.safe})`, `应用安全变更 (${mappingStats.safe})`)}
          </button>
        </div>
      </div>

      <div className="mapping-stats">
        <span><strong>{mappingStats.total}</strong>{tx("Mapped", "已映射")}</span>
        <span><strong>{mappingStats.synced}</strong>{tx("Synced", "已同步")}</span>
        <span><strong>{mappingStats.safe}</strong>{tx("Safe changes", "安全变更")}</span>
        <span><strong>{mappingStats.conflicts}</strong>{tx("Review", "待复核")}</span>
        <span><strong>{mappingStats.missing}</strong>{tx("Missing side", "单侧缺失")}</span>
      </div>

      {conflictPreference !== "ask" && (
        <p className="mapping-note">
          {tx(
            `${conflictPreferenceLabel(conflictPreference, locale)} highlights a suggested action for Review rows. “Apply preferred” remains explicit and only batches one-sided Dockmark changes; two-sided conflicts stay individual decisions.`,
            `当前「${conflictPreferenceLabel(conflictPreference, locale)}」仅作复核建议。「按偏好应用」仍需手动触发且仅批量处理单侧 Dockmark 变更；双向冲突需逐项确认。`,
          )}
        </p>
      )}

      <div className="mapping-list">
        {mappingRows.slice(0, 500).map((row) => {
          const needsReview = row.state === "cloud-changed" || row.state === "conflict";
          const selectedTarget = relinkTargets[row.mapping.browserBookmarkId] ?? "";
          const recommendedAction = !needsReview || conflictPreference === "ask"
            ? null
            : conflictPreference === "browser"
              ? "browser"
              : writebackCapable
                ? "writeback"
                : "keep";

          return (
            <div className={`mapping-row ${needsReview ? "mapping-row-review" : ""} mapping-${row.state}`} key={row.mapping.browserBookmarkId}>
              <div className="mapping-row-main">
                <span className="mapping-copy">
                  <strong>{row.native?.title ?? row.cloud?.title ?? row.mapping.url}</strong>
                  <small>{tx("Browser", "浏览器")} · {row.native?.url ?? tx("bookmark removed", "书签已移除")}</small>
                  <small>Dockmark · {row.cloud?.url ?? tx("bookmark missing", "书签缺失")}</small>
                </span>
                <span className={`mapping-status mapping-status-${row.state}`}>
                  {localizedMappingStateLabel(row.state, locale)}
                </span>
                {!needsReview && (
                  <button
                    className="text-action muted-action"
                    type="button"
                    disabled={busy || policyApplying}
                    onClick={() => onUnlinkMapping(row.mapping.browserBookmarkId)}
                  >
                    {tx("Unlink", "解除映射")}
                  </button>
                )}
              </div>

              {needsReview && row.native && row.cloud && (
                <div className="mapping-review-panel">
                  <p>{localizedReviewDescription(row.state, locale)}</p>
                  {recommendedAction && (
                    <small className="mapping-review-note">
                      {tx("Policy recommendation:", "策略推荐：")}{" "}
                      {recommendedAction === "browser"
                        ? tx("Use Browser", "采用浏览器版本")
                        : recommendedAction === "writeback"
                          ? tx("Write Dockmark → Browser", "将 Dockmark 写回浏览器")
                          : tx("Keep Dockmark", "保留 Dockmark 版本")}
                      {tx(". Nothing runs until you click.", "。点击按钮后才会执行。")}
                    </small>
                  )}
                  <div className="mapping-review-sides">
                    <div>
                      <span>{tx("Browser", "浏览器")}</span>
                      <strong>{row.native.title || row.native.url}</strong>
                      <small>{row.native.url}</small>
                      <small>{folderCategory(row.native.folderPath) ?? uncategorized}</small>
                    </div>
                    <div>
                      <span>Dockmark</span>
                      <strong>{row.cloud.title}</strong>
                      <small>{row.cloud.url}</small>
                      <small>{row.cloud.categoryId ? categoryNames.get(row.cloud.categoryId) ?? tx("Unknown category", "未知分类") : uncategorized}</small>
                    </div>
                  </div>
                  <div className="mapping-review-actions">
                    <button
                      className={recommendedAction === "browser" ? "primary" : "secondary"}
                      type="button"
                      disabled={busy || policyApplying}
                      onClick={() => onUseBrowser(row)}
                    >
                      {tx("Use Browser", "采用浏览器")}
                    </button>
                    <button
                      className={recommendedAction === "keep" ? "primary" : "secondary"}
                      type="button"
                      disabled={busy || policyApplying}
                      onClick={() => onKeepDockmark(row)}
                    >
                      {tx("Keep Dockmark", "保留 Dockmark")}
                    </button>
                    {writebackCapable && (
                      <button
                        className={recommendedAction === "writeback" ? "primary" : "secondary"}
                        type="button"
                        disabled={busy || policyApplying}
                        onClick={() => onWriteDockmarkToBrowser(row)}
                      >
                        {tx("Write Dockmark → Browser", "写回浏览器")}
                      </button>
                    )}
                    <div className="mapping-relink-control">
                      <select
                        aria-label={tx("Re-link browser bookmark to Dockmark bookmark", "重新关联到其他 Dockmark 书签")}
                        value={selectedTarget}
                        disabled={busy || policyApplying}
                        onChange={(event) => onRelinkTargetChange(row.mapping.browserBookmarkId, event.target.value)}
                      >
                        <option value="">{tx("Choose Dockmark bookmark…", "选择目标 Dockmark 书签…")}</option>
                        {relinkOptions.filter((bookmark) => bookmark.id !== row.cloud?.id).map((bookmark) => (
                          <option value={bookmark.id} key={bookmark.id}>{bookmark.title} — {bookmark.url}</option>
                        ))}
                      </select>
                      <button
                        className="secondary"
                        type="button"
                        disabled={busy || policyApplying || !selectedTarget}
                        onClick={() => onRelinkMapping(row)}
                      >
                        {tx("Re-link", "重新关联")}
                      </button>
                    </div>
                    <button
                      className="text-action muted-action"
                      type="button"
                      disabled={busy || policyApplying}
                      onClick={() => onUnlinkMapping(row.mapping.browserBookmarkId)}
                    >
                      {tx("Unlink", "解除映射")}
                    </button>
                  </div>
                  <small className="mapping-review-note">
                    {tx(
                      "Use Browser updates Dockmark title, URL, and category. Keep Dockmark accepts the difference. Write Dockmark → Browser updates only the mapped browser title + URL without moving folders. Re-link updates only the local mapping.",
                      "「采用浏览器」会更新 Dockmark 的标题、网址与分类；「保留 Dockmark」将当前差异设为新基线；「写回浏览器」仅更新该浏览器书签的标题与网址，不移动文件夹；「重新关联」仅变更本地映射关系。",
                    )}
                  </small>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mapping-note">
        {tx(
          "Safe Apply remains browser → Dockmark only. Browser deletions unlink the mapping while keeping the Dockmark bookmark.",
          "安全应用仅支持「浏览器 → Dockmark」单向同步；浏览器端删除书签只会解除映射，不会删除 Dockmark 中的书签。",
        )}
      </p>
    </section>
  );
}

interface ImportTreePanelProps {
  items: NativeImportCandidate[];
  stats: {
    total: number;
    selected: number;
    newCloud: number;
    linkExisting: number;
    mapped: number;
    local: number;
    invalid: number;
  };
  busy: boolean;
  policyApplying: boolean;
  onSelectAll: (selected: boolean) => void;
  onImportSelected: () => void;
  onToggleItem: (browserBookmarkId: string) => void;
}

export function NativeImportTreePanel({
  items,
  stats,
  busy,
  policyApplying,
  onSelectAll,
  onImportSelected,
  onToggleItem,
}: ImportTreePanelProps) {
  const { tx } = useI18n();

  function statusLabel(item: NativeImportCandidate) {
    if (item.mappedDockmarkBookmarkId) return tx("Mapped", "已映射");
    if (item.status === "invalid") return tx("Invalid", "无效");
    if (item.existingBookmarkId) return tx("Link", "关联已有");
    if (item.status === "duplicate") return tx("Dedup", "去重");
    if (item.healthPolicy === "local-only") return tx("Local only", "仅本地");
    return tx("New", "新增");
  }

  return (
    <section className="import-preview native-import-preview">
      <div className="preview-heading">
        <div>
          <h2>{tx("Native bookmark tree", "浏览器书签树预览")}</h2>
        </div>
        <div className="preview-actions">
          <button className="text-action" type="button" onClick={() => onSelectAll(true)}>
            {tx("Select unmapped", "选择未映射项")}
          </button>
          <button className="text-action muted-action" type="button" onClick={() => onSelectAll(false)}>
            {tx("Clear", "清空")}
          </button>
          <button className="primary" type="button" onClick={onImportSelected} disabled={busy || policyApplying || !stats.selected}>
            {busy
              ? tx("Importing…", "导入中…")
              : tx(`Import / map (${stats.selected})`, `导入 / 映射 (${stats.selected})`)}
          </button>
        </div>
      </div>

      <div className="import-stats native-stats">
        <span><strong>{stats.total}</strong>{tx("Total", "总计")}</span>
        <span><strong>{stats.newCloud}</strong>{tx("New URLs", "新增网址")}</span>
        <span><strong>{stats.linkExisting}</strong>{tx("Link URLs", "关联已有")}</span>
        <span><strong>{stats.mapped}</strong>{tx("Mapped", "已映射")}</span>
        <span><strong>{stats.local}</strong>{tx("Local only", "仅本地")}</span>
        <span><strong>{stats.invalid}</strong>{tx("Invalid", "无效")}</span>
      </div>

      <div className="import-list">
        {items.slice(0, 500).map((item) => (
          <label
            className={`import-row ${item.mappedDockmarkBookmarkId ? "status-mapped" : `status-${item.status}`}`}
            key={item.browserBookmarkId}
          >
            <input
              type="checkbox"
              checked={item.selected}
              disabled={item.status === "invalid" || Boolean(item.mappedDockmarkBookmarkId) || busy || policyApplying}
              onChange={() => onToggleItem(item.browserBookmarkId)}
            />
            <span className="import-copy">
              <strong>{item.title}</strong>
              <small>{item.normalizedUrl ?? item.url}</small>
              <span>{item.categoryName ?? tx("Uncategorized", "未分类")}</span>
            </span>
            <span className={`import-status policy-${item.healthPolicy ?? "none"}`}>{statusLabel(item)}</span>
          </label>
        ))}
      </div>
      {items.length > 500 && (
        <p className="preview-limit">
          {tx(
            `Showing the first 500 of ${items.length} browser entries; selected hidden entries are still included.`,
            `仅显示前 500 条浏览器书签（共 ${items.length} 条）；未展示的已选项仍会一并处理。`,
          )}
        </p>
      )}
    </section>
  );
}
