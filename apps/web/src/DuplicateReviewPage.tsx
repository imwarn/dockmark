/**
 * [INPUT]: depends on useEffect, useMemo, useState from react; HEALTH_POLICY_LABELS, HEALTH_STATUS_LABELS, ResolvedLocale from @dockmark/core; getDuplicateReview, DuplicateCandidateKind, DuplicateReviewCandidate, DuplicateReviewMember, DuplicateReviewResult from ./duplicate-review-api; useI18n from ./i18n; BookmarkFavicon, safeDomainLabel from ./BookmarkFavicon; ./duplicate-review.css
 * [OUTPUT]: exports DuplicateReviewPage component for read-only side-by-side inspection of conservative duplicate bookmark pairs
 * [POS]: top-level /app/duplicates workspace; displays URL/metadata evidence without mutating bookmarks
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState } from "react";
import {
  HEALTH_POLICY_LABELS,
  HEALTH_STATUS_LABELS,
  type ResolvedLocale,
} from "@dockmark/core";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import {
  getDuplicateReview,
  type DuplicateCandidateKind,
  type DuplicateReviewCandidate,
  type DuplicateReviewMember,
  type DuplicateReviewResult,
} from "./duplicate-review-api";
import { useI18n } from "./i18n";
import "./duplicate-review.css";

type TxFn = (en: string, zh: string) => string;

const KNOWN_REASON_ZH: Record<string, string> = {
  "Saved page metadata points these bookmarks at the same canonical target.":
    "已保存的页面元数据显示这两条书签指向同一个规范链接目标。",
  "Saved metadata shows these bookmarks resolving to the same final target.":
    "已保存的页面元数据显示这两条书签最终跳转到同一个目标地址。",
  "The URLs become equivalent after ignoring protocol/www, fragments, trailing slashes and known tracking parameters.":
    "忽略协议/www、锚点片段、末尾斜杠及常见追踪参数后，两条链接等价。",
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

function formatFetchedDate(value: string, locale: ResolvedLocale): string {
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

function matches(candidate: DuplicateReviewCandidate, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const haystack = [
    candidate.left.title,
    candidate.left.url,
    candidate.left.categoryName ?? "",
    candidate.right.title,
    candidate.right.url,
    candidate.right.categoryName ?? "",
    candidate.evidenceUrl ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase();
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
}

function MemberCard({
  side,
  candidate,
  locale,
  tx,
}: {
  side: "left" | "right";
  candidate: DuplicateReviewCandidate;
  locale: ResolvedLocale;
  tx: TxFn;
}) {
  const bookmark = candidate[side] as DuplicateReviewMember & { iconUrl?: string | null };
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
          <small>
            {safeDomainLabel(bookmark.url)} · {bookmark.categoryName ?? tx("Uncategorized", "未分类")} ·{" "}
            {healthPolicyLabel(bookmark.healthPolicy, locale)} ·{" "}
            {healthStatusLabel(bookmark.healthStatus, locale)}
          </small>
        </div>
      </div>

      <a className="duplicate-url" href={bookmark.url} target="_blank" rel="noreferrer">
        {bookmark.url}
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
                `Metadata fetched ${formatFetchedDate(bookmark.metadataFetchedAt, locale)}`,
                `元数据抓取于 ${formatFetchedDate(bookmark.metadataFetchedAt, locale)}`,
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

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setResult(await getDuplicateReview());
      setHiddenIds(new Set());
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

  const stats = result?.stats;

  return (
    <main className="duplicate-shell">
      <header className="duplicate-hero">
        <div className="duplicate-hero-copy">
          <h1>{tx("Duplicate Review", "重复项审查")}</h1>
          <p>
            {tx(
              "Compare saved URLs with canonical and resolved metadata evidence. Read-only — Dockmark never merges, edits, or deletes bookmarks automatically.",
              "结合规范链接与跳转目标元数据识别候选重复书签。仅提供审查建议，不会自动合并、修改或删除书签。",
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

      <section className="duplicate-toolbar panel">
        <label>
          <span>{tx("Search review queue", "搜索审查列表")}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tx("Title, URL, category, or evidence target…", "按标题、链接、分类或依据地址搜索…")}
          />
        </label>
        <label>
          <span>{tx("Evidence", "依据类型")}</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as "all" | DuplicateCandidateKind)}
          >
            <option value="all">{tx("All evidence", "全部依据")}</option>
            <option value="canonical">{tx("Canonical target", "规范链接")}</option>
            <option value="resolved">{tx("Resolved target", "跳转目标")}</option>
            <option value="normalized">{tx("URL variant", "URL 变体")}</option>
          </select>
        </label>
        <div className="duplicate-toolbar-state">
          <strong>{tx(`${visible.length} visible`, `显示 ${visible.length} 组`)}</strong>
          {hiddenIds.size > 0 && (
            <button
              className="text-action"
              type="button"
              onClick={() => setHiddenIds(new Set())}
            >
              {tx(`Restore ${hiddenIds.size} hidden`, `恢复 ${hiddenIds.size} 组已隐藏`)}
            </button>
          )}
        </div>
      </section>

      <section className="duplicate-list">
        {loading && !result ? (
          <div className="panel duplicate-empty">
            {tx("Analyzing saved bookmark and metadata evidence…", "正在分析书签与页面元数据依据…")}
          </div>
        ) : (
          visible.map((candidate) => (
            <article className={`panel duplicate-candidate kind-${candidate.kind}`} key={candidate.id}>
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
                <MemberCard side="left" candidate={candidate} locale={locale} tx={tx} />
                <div className="duplicate-vs" aria-hidden="true">
                  ≈
                </div>
                <MemberCard side="right" candidate={candidate} locale={locale} tx={tx} />
              </div>

              <footer className="duplicate-candidate-footer">
                <span>
                  {tx(
                    "Recommendation only — review in Bookmarks or Metadata & Health before editing or deleting.",
                    "仅供参考 — 请在「书签库」或「元数据与健康」中确认后再编辑或删除。",
                  )}
                </span>
                <div>
                  <a className="secondary" href={candidate.left.url} target="_blank" rel="noreferrer">
                    {tx("Open A", "打开 A")}
                  </a>
                  <a className="secondary" href={candidate.right.url} target="_blank" rel="noreferrer">
                    {tx("Open B", "打开 B")}
                  </a>
                </div>
              </footer>
            </article>
          ))
        )}

        {!loading && result && visible.length === 0 && (
          <div className="panel duplicate-empty">
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
