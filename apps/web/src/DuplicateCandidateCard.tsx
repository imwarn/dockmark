/**
 * [INPUT]: depends on useMemo, useState, type ReactNode from react; formatRelativeTime, HEALTH_POLICY_LABELS, HEALTH_STATUS_LABELS, type ResolvedLocale from @dockmark/core; BookmarkFavicon, safeDomainLabel from ./BookmarkFavicon; MAX_BOOKMARK_TAGS from ./bookmark-details-api; type DuplicateCandidateKind, DuplicateReviewCandidate, DuplicateReviewMember from ./duplicate-review-api
 * [OUTPUT]: exports computeDuplicateMerge, DuplicateMergePlan, and DuplicateCandidateCard component
 * [POS]: Per-pair duplicate candidate card with URL diff highlighting, unique-tag chips, contextual merge toggle/preview, and keep/archive controls for DuplicateReviewPage
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  formatRelativeTime,
  HEALTH_POLICY_LABELS,
  HEALTH_STATUS_LABELS,
  type ResolvedLocale,
} from "@dockmark/core";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import { MAX_BOOKMARK_TAGS } from "./bookmark-details-api";
import type {
  DuplicateCandidateKind,
  DuplicateReviewCandidate,
  DuplicateReviewMember,
} from "./duplicate-review-api";

type TxFn = (en: string, zh: string) => string;

export interface DuplicateMergePlan {
  tagsToAdd: string[];
  droppedTagCount: number;
  adoptDescription: string | null;
  hasMergeableData: boolean;
}

export function computeDuplicateMerge(
  keeper: DuplicateReviewMember,
  archived: DuplicateReviewMember,
): DuplicateMergePlan {
  const keeperTags = keeper.tags ?? [];
  const archivedTags = archived.tags ?? [];
  const seenLower = new Set(keeperTags.map((tag) => tag.toLocaleLowerCase()));
  const uniqueFromArchived: string[] = [];

  for (const tag of archivedTags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    uniqueFromArchived.push(trimmed);
  }

  const availableSlots = Math.max(0, MAX_BOOKMARK_TAGS - keeperTags.length);
  const tagsToAdd = uniqueFromArchived.slice(0, availableSlots);
  const droppedTagCount = uniqueFromArchived.length - tagsToAdd.length;
  const trimmedArchivedDesc = archived.description?.trim() ?? "";
  const adoptDescription = !(keeper.description?.trim()) && trimmedArchivedDesc
    ? trimmedArchivedDesc
    : null;
  const hasMergeableData = tagsToAdd.length > 0 || adoptDescription !== null;

  return { tagsToAdd, droppedTagCount, adoptDescription, hasMergeableData };
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

function MemberCard({
  side,
  bookmark,
  otherBookmark,
  locale,
  tx,
}: {
  side: "left" | "right";
  bookmark: DuplicateReviewMember;
  otherBookmark: DuplicateReviewMember;
  locale: ResolvedLocale;
  tx: TxFn;
}) {
  const timestamp = bookmark.updatedAt ?? bookmark.createdAt ?? null;
  const relativeUpdated = timestamp ? formatRelativeTime(timestamp, locale) : null;
  const tags = bookmark.tags ?? [];
  const otherTagSet = useMemo(
    () => new Set((otherBookmark.tags ?? []).map((tag) => tag.toLocaleLowerCase())),
    [otherBookmark.tags],
  );

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
        {renderUrlWithDiff(bookmark.url, otherBookmark.url)}
      </a>
      {bookmark.description && <p>{bookmark.description}</p>}

      {tags.length > 0 && (
        <div className="duplicate-member-tags" aria-label={tx("Bookmark tags", "书签标签")}>
          {tags.map((tag) => {
            const isUnique = !otherTagSet.has(tag.toLocaleLowerCase());
            return (
              <span
                key={tag}
                className={`duplicate-tag-chip${isUnique ? " is-unique" : ""}`}
                title={
                  isUnique
                    ? tx("Unique to this bookmark", "仅此书签独有标签")
                    : tx("Present on both bookmarks", "双方共有标签")
                }
              >
                #{tag}
              </span>
            );
          })}
        </div>
      )}

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

function MergePreviewRow({
  sideLabel,
  plan,
  tx,
}: {
  sideLabel: string;
  plan: DuplicateMergePlan;
  tx: TxFn;
}) {
  if (!plan.hasMergeableData && plan.droppedTagCount === 0) return null;

  return (
    <div className="duplicate-merge-preview-row">
      <span className="duplicate-merge-side">{sideLabel}</span>
      <div className="duplicate-merge-chips">
        {plan.tagsToAdd.map((tag) => (
          <span key={tag} className="duplicate-merge-chip">
            +#{tag}
          </span>
        ))}
        {plan.adoptDescription !== null && (
          <span className="duplicate-merge-chip is-description">
            {tx("+description", "+补充描述")}
          </span>
        )}
        {plan.droppedTagCount > 0 && (
          <span className="duplicate-merge-cap">
            {tx(
              `+${plan.droppedTagCount} skipped (max ${MAX_BOOKMARK_TAGS} tags)`,
              `上限 ${MAX_BOOKMARK_TAGS} 个标签（跳过 ${plan.droppedTagCount} 个）`,
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export interface DuplicateCandidateCardProps {
  candidate: DuplicateReviewCandidate;
  locale: ResolvedLocale;
  isZh: boolean;
  tx: TxFn;
  archiving: boolean;
  actionsDisabled: boolean;
  onHide: (id: string) => void;
  onArchive: (candidate: DuplicateReviewCandidate, keepSide: "left" | "right", mergeEnabled: boolean) => void;
  onLocate: (title: string) => void;
}

export function DuplicateCandidateCard({
  candidate,
  locale,
  isZh,
  tx,
  archiving,
  actionsDisabled,
  onHide,
  onArchive,
  onLocate,
}: DuplicateCandidateCardProps) {
  const [mergeEnabled, setMergeEnabled] = useState(true);
  const keepLeftPlan = useMemo(
    () => computeDuplicateMerge(candidate.left, candidate.right),
    [candidate.left, candidate.right],
  );
  const keepRightPlan = useMemo(
    () => computeDuplicateMerge(candidate.right, candidate.left),
    [candidate.left, candidate.right],
  );
  const showMergeBar = keepLeftPlan.hasMergeableData || keepRightPlan.hasMergeableData;

  return (
    <article className={`duplicate-candidate kind-${candidate.kind}`}>
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
          onClick={() => onHide(candidate.id)}
        >
          {tx("Hide for now", "暂时隐藏")}
        </button>
      </header>

      <div className="duplicate-pair">
        <MemberCard
          side="left"
          bookmark={candidate.left}
          otherBookmark={candidate.right}
          locale={locale}
          tx={tx}
        />
        <span className="duplicate-divider-badge" aria-hidden="true">≈</span>
        <MemberCard
          side="right"
          bookmark={candidate.right}
          otherBookmark={candidate.left}
          locale={locale}
          tx={tx}
        />
      </div>

      <footer className="duplicate-candidate-footer">
        {showMergeBar && (
          <div className={`duplicate-merge-bar${mergeEnabled ? "" : " is-disabled"}`}>
            <label className="duplicate-merge-toggle">
              <input
                type="checkbox"
                checked={mergeEnabled}
                disabled={actionsDisabled}
                onChange={(event) => setMergeEnabled(event.target.checked)}
              />
              <span>
                {tx(
                  "Merge unique tags & missing description into kept bookmark",
                  "归档前将对方独有标签与缺失描述合并至保留项",
                )}
              </span>
            </label>
            <div className="duplicate-merge-previews">
              <MergePreviewRow
                sideLabel={tx("Keep A:", "保留 A：")}
                plan={keepLeftPlan}
                tx={tx}
              />
              <MergePreviewRow
                sideLabel={tx("Keep B:", "保留 B：")}
                plan={keepRightPlan}
                tx={tx}
              />
            </div>
          </div>
        )}

        <div className="duplicate-footer-row">
          <div className="duplicate-review-actions">
            <button
              className="secondary duplicate-keep-btn"
              type="button"
              disabled={actionsDisabled}
              onClick={() => onArchive(candidate, "left", mergeEnabled)}
            >
              {archiving ? tx("Archiving…", "归档中…") : tx("Keep A · Archive B", "保留 A · 归档 B")}
            </button>
            <button
              className="secondary duplicate-keep-btn"
              type="button"
              disabled={actionsDisabled}
              onClick={() => onArchive(candidate, "right", mergeEnabled)}
            >
              {archiving ? tx("Archiving…", "归档中…") : tx("Keep B · Archive A", "保留 B · 归档 A")}
            </button>
          </div>
          <div className="duplicate-utility-actions">
            <button
              className="text-action"
              type="button"
              onClick={() => onLocate(candidate.left.title)}
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
        </div>
      </footer>
    </article>
  );
}
