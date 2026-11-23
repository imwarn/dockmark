/**
 * [INPUT]: depends on useEffect, useMemo, useState from react; type HealthPolicy from @dockmark/core; updateBookmarkWithTags from ./bookmark-details-api; textMatchesQuery from ./bookmark-search; computeDuplicateMerge, DuplicateCandidateCard from ./DuplicateCandidateCard; getDuplicateReview and DuplicateReview types from ./duplicate-review-api; useI18n from ./i18n; maintainLibraryBatch from ./library-maintenance-api; ./duplicate-review.css
 * [OUTPUT]: exports DuplicateReviewPage component for side-by-side duplicate bookmark inspection, optional tag/description merging before archive, atomic-style undo, and Library deep-linking
 * [POS]: top-level /app/duplicates workspace; never auto-mutates bookmarks and supports reversible tag/description merge + archive with Change Journal tracking
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState } from "react";
import type { HealthPolicy } from "@dockmark/core";
import { updateBookmarkWithTags } from "./bookmark-details-api";
import { textMatchesQuery } from "./bookmark-search";
import { computeDuplicateMerge, DuplicateCandidateCard } from "./DuplicateCandidateCard";
import {
  getDuplicateReview,
  type DuplicateCandidateKind,
  type DuplicateReviewCandidate,
  type DuplicateReviewResult,
} from "./duplicate-review-api";
import { useI18n } from "./i18n";
import { maintainLibraryBatch } from "./library-maintenance-api";
import "./duplicate-review.css";

type TxFn = (en: string, zh: string) => string;

interface KeeperSnapshot {
  id: string;
  title: string;
  url: string;
  description: string | null;
  categoryId: string | null;
  healthPolicy: HealthPolicy;
  tags: string[];
}

interface ArchiveNotice {
  archivedId: string;
  archivedTitle: string;
  keptTitle: string;
  mergedTagCount: number;
  mergedDescription: boolean;
  keeperSnapshot: KeeperSnapshot | null;
}

function matches(candidate: DuplicateReviewCandidate, query: string): boolean {
  return textMatchesQuery(query, [
    candidate.left.title,
    candidate.left.url,
    candidate.left.categoryName ?? "",
    ...(candidate.left.tags ?? []),
    candidate.right.title,
    candidate.right.url,
    candidate.right.categoryName ?? "",
    ...(candidate.right.tags ?? []),
    candidate.evidenceUrl ?? "",
  ]);
}

function locateInLibrary(title: string) {
  window.history.pushState({}, "", `/app/bookmarks?q=${encodeURIComponent(title)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatArchiveNotice(notice: ArchiveNotice, tx: TxFn): string {
  const { archivedTitle, keptTitle, mergedTagCount, mergedDescription } = notice;
  if (mergedTagCount > 0 && mergedDescription) {
    const tagWord = mergedTagCount === 1 ? "tag" : "tags";
    return tx(
      `Kept “${keptTitle}” and archived “${archivedTitle}” (merged ${mergedTagCount} unique ${tagWord} and description).`,
      `已保留“${keptTitle}”并归档“${archivedTitle}”（已合并 ${mergedTagCount} 个独有标签与描述）。`,
    );
  }
  if (mergedTagCount > 0) {
    const tagWord = mergedTagCount === 1 ? "tag" : "tags";
    return tx(
      `Kept “${keptTitle}” and archived “${archivedTitle}” (merged ${mergedTagCount} unique ${tagWord}).`,
      `已保留“${keptTitle}”并归档“${archivedTitle}”（已合并 ${mergedTagCount} 个独有标签）。`,
    );
  }
  if (mergedDescription) {
    return tx(
      `Kept “${keptTitle}” and archived “${archivedTitle}” (merged missing description).`,
      `已保留“${keptTitle}”并归档“${archivedTitle}”（已合并缺失描述）。`,
    );
  }
  return tx(
    `Archived “${archivedTitle}” (kept “${keptTitle}”). Recorded in Change Journal.`,
    `已归档“${archivedTitle}”（保留“${keptTitle}”），记录已写入变更日志。`,
  );
}

export function DuplicateReviewPage() {
  const { locale, isZh, tx } = useI18n();
  const [result, setResult] = useState<DuplicateReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | DuplicateCandidateKind>("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<ArchiveNotice | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);

  async function refresh(options?: { keepHidden?: boolean; keepNotices?: boolean }) {
    setLoading(true);
    setError(null);
    if (!options?.keepNotices) {
      setArchiveNotice(null);
      setRestoreNotice(null);
    }
    try {
      setResult(await getDuplicateReview());
      if (!options?.keepHidden) setHiddenIds(new Set());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not load duplicate review.", "无法加载重复项审查。"),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const visible = useMemo(
    () =>
      (result?.candidates ?? []).filter(
        (candidate) =>
          !hiddenIds.has(candidate.id) &&
          (kind === "all" || candidate.kind === kind) &&
          matches(candidate, query),
      ),
    [hiddenIds, kind, query, result],
  );

  function hide(id: string) {
    setHiddenIds((current) => new Set(current).add(id));
  }

  async function archiveDuplicate(
    candidate: DuplicateReviewCandidate,
    keepSide: "left" | "right",
    mergeEnabled: boolean,
  ) {
    const keeper = candidate[keepSide];
    const archived = keepSide === "left" ? candidate.right : candidate.left;
    const mergePlan = computeDuplicateMerge(keeper, archived);
    const shouldMerge = mergeEnabled && mergePlan.hasMergeableData;
    let keeperSnapshot: KeeperSnapshot | null = null;
    let keeperMutated = false;

    setBusyCandidateId(candidate.id);
    setError(null);
    setRestoreNotice(null);
    try {
      if (shouldMerge) {
        keeperSnapshot = {
          id: keeper.id,
          title: keeper.title,
          url: keeper.url,
          description: keeper.description ?? null,
          categoryId: keeper.categoryId,
          healthPolicy: keeper.healthPolicy as HealthPolicy,
          tags: [...(keeper.tags ?? [])],
        };
        await updateBookmarkWithTags(keeper.id, {
          title: keeper.title,
          url: keeper.url,
          description: mergePlan.adoptDescription ?? keeper.description ?? null,
          categoryId: keeper.categoryId,
          healthPolicy: keeper.healthPolicy as HealthPolicy,
          tags: [...(keeper.tags ?? []), ...mergePlan.tagsToAdd],
        });
        keeperMutated = true;
      }

      await maintainLibraryBatch({ bookmarkIds: [archived.id], action: "archive" });
      setArchiveNotice({
        archivedId: archived.id,
        archivedTitle: archived.title,
        keptTitle: keeper.title,
        mergedTagCount: shouldMerge ? mergePlan.tagsToAdd.length : 0,
        mergedDescription: shouldMerge ? mergePlan.adoptDescription !== null : false,
        keeperSnapshot,
      });
      await refresh({ keepHidden: true, keepNotices: true });
    } catch (caught) {
      if (keeperMutated && keeperSnapshot) {
        const { id, ...revertInput } = keeperSnapshot;
        await updateBookmarkWithTags(id, revertInput).catch(() => {});
      }
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not archive the duplicate bookmark.", "无法归档该重复书签。"),
      );
    } finally {
      setBusyCandidateId(null);
    }
  }

  async function undoArchive() {
    if (!archiveNotice) return;
    const target = archiveNotice;
    setUndoBusy(true);
    setError(null);
    try {
      await maintainLibraryBatch({ bookmarkIds: [target.archivedId], action: "restore" });
      if (target.keeperSnapshot) {
        const { id, ...revertInput } = target.keeperSnapshot;
        await updateBookmarkWithTags(id, revertInput);
      }
      setArchiveNotice(null);
      setRestoreNotice(
        target.keeperSnapshot
          ? tx(
              `Restored “${target.archivedTitle}” and reverted merged metadata on “${target.keptTitle}”.`,
              `已恢复“${target.archivedTitle}”，并撤销对“${target.keptTitle}”的合并改动。`,
            )
          : tx(
              `Restored “${target.archivedTitle}” back to your library.`,
              `已将“${target.archivedTitle}”恢复至书签库。`,
            ),
      );
      await refresh({ keepHidden: true, keepNotices: true });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not restore the archived bookmark.", "无法撤销归档该书签。"),
      );
    } finally {
      setUndoBusy(false);
    }
  }

  const stats = result?.stats;
  const kindOptions: Array<{ id: "all" | DuplicateCandidateKind; label: string; count: number }> = [
    { id: "all", label: tx("All", "全部"), count: stats?.totalCandidates ?? 0 },
    { id: "canonical", label: tx("Canonical", "规范链接"), count: stats?.canonicalCandidates ?? 0 },
    { id: "resolved", label: tx("Resolved", "跳转目标"), count: stats?.resolvedCandidates ?? 0 },
    { id: "normalized", label: tx("URL variants", "URL 变体"), count: stats?.normalizedCandidates ?? 0 },
  ];

  return (
    <main className="duplicate-shell">
      <header className="duplicate-hero">
        <div className="duplicate-hero-copy">
          <h1>{tx("Duplicate Review", "重复项审查")}</h1>
          <p>
            {tx(
              "Compare saved URLs with canonical and resolved metadata evidence. Nothing mutates automatically — keep one side to optionally merge unique tags and missing description before safely archiving the duplicate with instant undo.",
              "结合规范链接与跳转目标元数据识别候选重复书签。不会自动修改数据，可手动保留一侧并在归档前合并独有标签与缺失描述，支持一键完整撤销。",
            )}
          </p>
        </div>
        <div className="duplicate-hero-actions">
          <span className="duplicate-stat-pill">
            <strong>{stats?.totalCandidates ?? 0}</strong>
            <span>{tx("pairs", "组候选")}</span>
          </span>
          <button
            className="secondary"
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? tx("Analyzing…", "分析中…") : tx("Refresh review", "重新分析")}
          </button>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {archiveNotice && (
        <div className="duplicate-action-banner" role="status">
          <span>{formatArchiveNotice(archiveNotice, tx)}</span>
          <div className="duplicate-action-banner-controls">
            <button
              className="secondary"
              type="button"
              disabled={undoBusy || busyCandidateId !== null}
              onClick={() => void undoArchive()}
            >
              {undoBusy ? tx("Undoing…", "撤销中…") : tx("Undo", "撤销")}
            </button>
            <button
              className="command-clear"
              type="button"
              aria-label={tx("Dismiss notice", "关闭提示")}
              onClick={() => setArchiveNotice(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {restoreNotice && (
        <div className="duplicate-action-banner" role="status">
          <span>{restoreNotice}</span>
          <button
            className="command-clear"
            type="button"
            aria-label={tx("Dismiss notice", "关闭提示")}
            onClick={() => setRestoreNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      <section className="duplicate-stats" aria-label={tx("Duplicate review summary", "重复项审查摘要")}>
        <div>
          <strong>{stats?.totalCandidates ?? 0}</strong>
          <span>{tx("Candidate pairs", "候选重复组")}</span>
        </div>
        <div>
          <strong>{stats?.canonicalCandidates ?? 0}</strong>
          <span>{tx("Canonical", "规范链接")}</span>
        </div>
        <div>
          <strong>{stats?.resolvedCandidates ?? 0}</strong>
          <span>{tx("Resolved", "跳转目标")}</span>
        </div>
        <div>
          <strong>{stats?.normalizedCandidates ?? 0}</strong>
          <span>{tx("URL variants", "URL 变体")}</span>
        </div>
        <div>
          <strong>
            {stats?.metadataBookmarks ?? 0}/{stats?.analyzedBookmarks ?? 0}
          </strong>
          <span>{tx("With metadata", "已含元数据")}</span>
        </div>
      </section>

      {(stats?.bookmarkAnalysisTruncated || stats?.candidateListTruncated) && (
        <div className="duplicate-truncation-notice" role="status">
          {stats.bookmarkAnalysisTruncated && (
            <span>
              {tx(
                `Analysis is limited to the most recently updated ${stats.analyzedBookmarks} bookmarks. `,
                `本次分析仅覆盖最近更新的 ${stats.analyzedBookmarks} 条书签。`,
              )}
            </span>
          )}
          {stats.candidateListTruncated && (
            <span>
              {tx(
                `Showing the first ${result?.candidates.length ?? 0} of ${stats.totalCandidates} candidate pairs.`,
                `当前显示前 ${result?.candidates.length ?? 0} 组，共检测到 ${stats.totalCandidates} 组候选重复。`,
              )}
            </span>
          )}
        </div>
      )}

      <section className="duplicate-toolbar" aria-label={tx("Filter duplicate candidates", "筛选重复项候选")}>
        <div className="duplicate-search-box">
          <span className="duplicate-search-icon" aria-hidden="true">⌕</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tx("Search title, URL, category, tag, or Pinyin…", "搜索标题、链接、分类、标签或拼音首字母…")}
            aria-label={tx("Search review queue", "搜索审查列表")}
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

        <div className="duplicate-kind-pills" role="group" aria-label={tx("Evidence type", "依据类型")}>
          {kindOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`duplicate-kind-pill${kind === option.id ? " is-active" : ""}`}
              aria-pressed={kind === option.id}
              onClick={() => setKind(option.id)}
            >
              <span>{option.label}</span>
              <small>{option.count}</small>
            </button>
          ))}
        </div>

        <div className="duplicate-toolbar-state">
          <strong>{tx(`${visible.length} visible`, `显示 ${visible.length} 组`)}</strong>
          {hiddenIds.size > 0 && (
            <button
              className="text-action"
              type="button"
              onClick={() => setHiddenIds(new Set())}
            >
              {tx(`Restore ${hiddenIds.size} hidden`, `恢复已隐藏 (${hiddenIds.size})`)}
            </button>
          )}
        </div>
      </section>

      <section className="duplicate-list">
        {loading && !result ? (
          <div className="duplicate-empty">
            {tx("Analyzing saved bookmark and metadata evidence…", "正在分析书签与页面元数据依据…")}
          </div>
        ) : (
          visible.map((candidate) => (
            <DuplicateCandidateCard
              key={candidate.id}
              candidate={candidate}
              locale={locale}
              isZh={isZh}
              tx={tx}
              archiving={busyCandidateId === candidate.id}
              actionsDisabled={undoBusy || busyCandidateId !== null}
              onHide={hide}
              onArchive={(target, keepSide, mergeEnabled) => {
                void archiveDuplicate(target, keepSide, mergeEnabled);
              }}
              onLocate={locateInLibrary}
            />
          ))
        )}

        {!loading && result && visible.length === 0 && (
          <div className="duplicate-empty">
            <strong>
              {result.stats.totalCandidates
                ? tx("No candidates match this filter.", "当前筛选条件下没有匹配的候选重复项。")
                : tx("No duplicate candidates found.", "未发现重复项候选。")}
            </strong>
            <span>
              {result.stats.metadataBookmarks < result.stats.analyzedBookmarks
                ? tx(
                    "Fetching metadata for public bookmarks can reveal additional canonical or resolved-target evidence.",
                    "为公开书签抓取页面元数据可发现更多规范链接或跳转目标依据。",
                  )
                : tx(
                    "Current URL and metadata evidence does not suggest duplicate pairs.",
                    "根据当前链接与页面元数据，未检测到疑似重复的书签组合。",
                  )}
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
