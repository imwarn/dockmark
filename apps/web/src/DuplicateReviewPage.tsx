/**
 * [INPUT]: depends on useEffect, useMemo, useState from react; formatRelativeTime, HEALTH_POLICY_LABELS, HEALTH_STATUS_LABELS, ResolvedLocale from @dockmark/core; textMatchesQuery from ./bookmark-search; maintainLibraryBatch from ./library-maintenance-api; getDuplicateReview and DuplicateReview types from ./duplicate-review-api; useI18n from ./i18n; BookmarkFavicon, safeDomainLabel from ./BookmarkFavicon; ./duplicate-review.css
 * [OUTPUT]: exports DuplicateReviewPage component for side-by-side duplicate bookmark inspection, URL diff highlighting, safe reviewed archive/undo, and Library deep-linking
 * [POS]: top-level /app/duplicates workspace; never auto-mutates bookmarks and records explicit archive/restore actions in the Change Journal
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  formatRelativeTime,
  HEALTH_POLICY_LABELS,
  HEALTH_STATUS_LABELS,
  type ResolvedLocale,
} from "@dockmark/core";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import { textMatchesQuery } from "./bookmark-search";
import {
  getDuplicateReview,
  type DuplicateCandidateKind,
  type DuplicateReviewCandidate,
  type DuplicateReviewMember,
  type DuplicateReviewResult,
} from "./duplicate-review-api";
import { useI18n } from "./i18n";
import { maintainLibraryBatch } from "./library-maintenance-api";
import "./duplicate-review.css";

type TxFn = (en: string, zh: string) => string;

interface ArchiveNotice {
  archivedId: string;
  archivedTitle: string;
  keptTitle: string;
}

const KNOWN_REASON_ZH: Record<string, string> = {
  "Saved page metadata points these bookmarks at the same canonical target.":
    "已保存的页面元数据显示这两条书签指向同一个规范链接目标。",
  "Saved metadata shows these bookmarks resolving to the same final target.":
    "已保存的页面元数据显示这两条书签最终跳转到同一个目标地址。",
  "The URLs become equivalent after ignoring protocol/www, fragments, trailing slashes and known tracking parameters.":
    "忽略协议/www、文档锚点、末尾斜杠及常见追踪参数后，两条链接等价。",
};

function kindLabel(kind: DuplicateCandidateKind, tx: TxFn): string {
  switch (kind) {
    case "canonical":
      return tx("Canonical target", "规范链接");
    case "resolved":
      return tx("Resolved target", "跳转目标");
    case "normalized":
      return tx("URL variant", "URL 变体");
  }
}

function kindDescription(kind: DuplicateCandidateKind, tx: TxFn): string {
  switch (kind) {
    case "canonical":
      return tx("Strong metadata evidence", "强元数据依据");
    case "resolved":
      return tx("Redirect / final-URL evidence", "重定向 / 最终地址依据");
    case "normalized":
      return tx("Conservative URL normalization", "保守 URL 归一化");
  }
}

function localizedReason(candidate: DuplicateReviewCandidate, isZh: boolean): string {
  if (!isZh) return candidate.reason;
  return KNOWN_REASON_ZH[candidate.reason] ?? candidate.reason;
}

function healthPolicyLabel(policy: string, locale: ResolvedLocale): string {
  const labels = HEALTH_POLICY_LABELS[locale] as Record<string, string>;
  return labels[policy] ?? policy;
}

function healthStatusLabel(status: string, locale: ResolvedLocale): string {
  const labels = HEALTH_STATUS_LABELS[locale] as Record<string, string>;
  return labels[status] ?? status;
}

function formatFullDate(value: string, locale: ResolvedLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function renderUrlWithDiff(url: string, otherUrl: string): ReactNode {
  const leftChars = Array.from(url);
  const rightChars = Array.from(otherUrl);
  let prefixLen = 0;
  while (
    prefixLen < leftChars.length &&
    prefixLen < rightChars.length &&
    leftChars[prefixLen] === rightChars[prefixLen]
  ) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < leftChars.length - prefixLen &&
    suffixLen < rightChars.length - prefixLen &&
    leftChars[leftChars.length - 1 - suffixLen] === rightChars[rightChars.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const diff = leftChars.slice(prefixLen, leftChars.length - suffixLen).join("");
  if (!diff) return url;
  const prefix = leftChars.slice(0, prefixLen).join("");
  const suffix = suffixLen > 0 ? leftChars.slice(leftChars.length - suffixLen).join("") : "";

  return (
    <>
      {prefix}
      <mark className="duplicate-url-diff">{diff}</mark>
      {suffix}
    </>
  );
}

function matches(candidate: DuplicateReviewCandidate, query: string): boolean {
  return textMatchesQuery(query, [
    candidate.left.title,
    candidate.left.url,
    candidate.left.categoryName ?? "",
    candidate.right.title,
    candidate.right.url,
    candidate.right.categoryName ?? "",
    candidate.evidenceUrl ?? "",
  ]);
}

function locateInLibrary(title: string) {
  window.history.pushState({}, "", `/app/bookmarks?q=${encodeURIComponent(title)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function MemberCard({
  side,
  bookmark,
  otherUrl,
  locale,
  tx,
}: {
  side: "left" | "right";
  bookmark: DuplicateReviewMember;
  otherUrl: string;
  locale: ResolvedLocale;
  tx: TxFn;
}) {
  const timestamp = bookmark.updatedAt ?? bookmark.createdAt ?? null;
  const relativeUpdated = timestamp ? formatRelativeTime(timestamp, locale) : null;

  return (
    <article className="duplicate-member">
      <div className="duplicate-member-heading">
        <BookmarkFavicon
          iconUrl={bookmark.iconUrl ?? null}
          title={bookmark.title}
          url={bookmark.url}
          className="duplicate-member-icon"
        />
        <div className="duplicate-member-copy">
          <div className="duplicate-member-title">
            <span className="duplicate-side-badge">{side === "left" ? "A" : "B"}</span>
            <strong>{bookmark.title}</strong>
          </div>
          <div className="duplicate-member-meta">
            <span className="duplicate-meta-domain">{safeDomainLabel(bookmark.url)}</span>
            <span className={`duplicate-meta-pill${bookmark.categoryName ? " is-categorized" : " is-muted"}`}>
              {bookmark.categoryName ?? tx("Uncategorized", "未分类")}
            </span>
            <span className="duplicate-meta-pill">
              {healthPolicyLabel(bookmark.healthPolicy, locale)} · {healthStatusLabel(bookmark.healthStatus, locale)}
            </span>
            {relativeUpdated && timestamp && (
              <span className="duplicate-meta-pill" title={formatFullDate(timestamp, locale)}>
                {tx(`Updated ${relativeUpdated}`, `更新于 ${relativeUpdated}`)}
              </span>
            )}
          </div>
        </div>
      </div>

      <a className="duplicate-url" href={bookmark.url} target="_blank" rel="noreferrer" title={bookmark.url}>
        {renderUrlWithDiff(bookmark.url, otherUrl)}
      </a>
      {bookmark.description && <p>{bookmark.description}</p>}

      {(bookmark.canonicalUrl || bookmark.finalUrl || bookmark.metadataFetchedAt) && (
        <div className="duplicate-member-evidence">
          {bookmark.canonicalUrl && (
            <div>
              <span>{tx("Canonical", "规范链接")}</span>
              <code>{bookmark.canonicalUrl}</code>
            </div>
          )}
          {bookmark.finalUrl && (
            <div>
              <span>{tx("Resolved", "最终跳转")}</span>
              <code>{bookmark.finalUrl}</code>
            </div>
          )}
          {bookmark.metadataFetchedAt && (
            <small>
              {tx(
                `Metadata fetched ${formatFullDate(bookmark.metadataFetchedAt, locale)}`,
                `元数据抓取于 ${formatFullDate(bookmark.metadataFetchedAt, locale)}`,
              )}
            </small>
          )}
        </div>
      )}
    </article>
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

  async function archiveDuplicate(candidate: DuplicateReviewCandidate, keepSide: "left" | "right") {
    const kept = candidate[keepSide];
    const archived = keepSide === "left" ? candidate.right : candidate.left;
    setBusyCandidateId(candidate.id);
    setError(null);
    setRestoreNotice(null);
    try {
      await maintainLibraryBatch({ bookmarkIds: [archived.id], action: "archive" });
      setArchiveNotice({
        archivedId: archived.id,
        archivedTitle: archived.title,
        keptTitle: kept.title,
      });
      await refresh({ keepHidden: true, keepNotices: true });
    } catch (caught) {
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
      setArchiveNotice(null);
      setRestoreNotice(
        tx(
          `Restored “${target.archivedTitle}” back to your library.`,
          `已将「${target.archivedTitle}」恢复至书签库。`,
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
              "Compare saved URLs with canonical and resolved metadata evidence. Nothing mutates automatically — keep one side to safely archive the duplicate with instant undo and Change Journal tracking.",
              "结合规范链接与跳转目标元数据识别候选重复书签。不会自动修改数据，可手动保留一侧并安全归档另一侧，支持一键撤销与变更日志追踪。",
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
          <span>
            {tx(
              `Archived “${archiveNotice.archivedTitle}” (kept “${archiveNotice.keptTitle}”). Recorded in Change Journal.`,
              `已归档“${archiveNotice.archivedTitle}”（保留“${archiveNotice.keptTitle}”），记录已写入变更日志。`,
            )}
          </span>
          <div className="duplicate-action-banner-controls">
            <button
              className="secondary"
              type="button"
              disabled={undoBusy || busyCandidateId !== null}
              onClick={() => void undoArchive()}
            >
              {undoBusy ? tx("Restoring…", "撤销中…") : tx("Undo", "撤销归档")}
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
            placeholder={tx("Search title, URL, category, or Pinyin…", "搜索标题、链接、分类或拼音首字母…")}
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
          visible.map((candidate) => {
            const archiving = busyCandidateId === candidate.id;
            return (
              <article className={`duplicate-candidate kind-${candidate.kind}`} key={candidate.id}>
                <header className="duplicate-candidate-heading">
                  <div className="duplicate-candidate-copy">
                    <div className="duplicate-kind-row">
                      <span className="duplicate-kind">{kindLabel(candidate.kind, tx)}</span>
                      <small>{kindDescription(candidate.kind, tx)}</small>
                    </div>
                    <p>{localizedReason(candidate, isZh)}</p>
                    {candidate.evidenceUrl && (
                      <code className="duplicate-evidence-url">{candidate.evidenceUrl}</code>
                    )}
                  </div>
                  <button
                    className="text-action muted-action"
                    type="button"
                    onClick={() => hide(candidate.id)}
                  >
                    {tx("Hide for now", "暂时隐藏")}
                  </button>
                </header>

                <div className="duplicate-pair">
                  <MemberCard
                    side="left"
                    bookmark={candidate.left}
                    otherUrl={candidate.right.url}
                    locale={locale}
                    tx={tx}
                  />
                  <span className="duplicate-divider-badge" aria-hidden="true">≈</span>
                  <MemberCard
                    side="right"
                    bookmark={candidate.right}
                    otherUrl={candidate.left.url}
                    locale={locale}
                    tx={tx}
                  />
                </div>

                <footer className="duplicate-candidate-footer">
                  <div className="duplicate-review-actions">
                    <button
                      className="secondary duplicate-keep-btn"
                      type="button"
                      disabled={archiving || undoBusy || busyCandidateId !== null}
                      onClick={() => void archiveDuplicate(candidate, "left")}
                    >
                      {archiving ? tx("Archiving…", "归档中…") : tx("Keep A · Archive B", "保留 A · 归档 B")}
                    </button>
                    <button
                      className="secondary duplicate-keep-btn"
                      type="button"
                      disabled={archiving || undoBusy || busyCandidateId !== null}
                      onClick={() => void archiveDuplicate(candidate, "right")}
                    >
                      {archiving ? tx("Archiving…", "归档中…") : tx("Keep B · Archive A", "保留 B · 归档 A")}
                    </button>
                  </div>
                  <div className="duplicate-utility-actions">
                    <button
                      className="text-action"
                      type="button"
                      onClick={() => locateInLibrary(candidate.left.title)}
                    >
                      {tx("Locate in Library", "在书签库定位")}
                    </button>
                    <a className="text-action duplicate-open-link" href={candidate.left.url} target="_blank" rel="noreferrer">
                      {tx("Open A ↗", "打开 A ↗")}
                    </a>
                    <a className="text-action duplicate-open-link" href={candidate.right.url} target="_blank" rel="noreferrer">
                      {tx("Open B ↗", "打开 B ↗")}
                    </a>
                  </div>
                </footer>
              </article>
            );
          })
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
