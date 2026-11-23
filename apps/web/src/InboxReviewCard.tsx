/**
 * [INPUT]: depends on Category, HEALTH_POLICY_LABELS, ResolvedLocale, formatRelativeTime from @dockmark/core; BookmarkMetadata from ./api; InboxBookmark from ./inbox-api; BookmarkFavicon and safeDomainLabel from ./BookmarkFavicon
 * [OUTPUT]: exports InboxReviewCard component, MetadataField, MetadataSelection, emptyMetadataSelection, and selectionCount helpers
 * [POS]: single-item review card inside apps/web/src/InboxPage.tsx for filing, AI triage selection, and opt-in page metadata inspection
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import {
  HEALTH_POLICY_LABELS,
  formatRelativeTime,
  type Category,
  type ResolvedLocale,
} from "@dockmark/core";
import type { BookmarkMetadata } from "./api";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import type { InboxBookmark } from "./inbox-api";

export type MetadataField = "title" | "description" | "canonicalUrl" | "iconUrl";
export type MetadataSelection = Record<MetadataField, boolean>;

export function emptyMetadataSelection(): MetadataSelection {
  return {
    title: false,
    description: false,
    canonicalUrl: false,
    iconUrl: false,
  };
}

export function selectionCount(selection: MetadataSelection | undefined): number {
  return selection ? Object.values(selection).filter(Boolean).length : 0;
}

function formatInboxDate(value: string, locale: ResolvedLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

interface InboxReviewCardProps {
  bookmark: InboxBookmark;
  categories: Category[];
  categoryName: string | null;
  tags: string[];
  categoryDraft: string;
  metadata: BookmarkMetadata | null;
  selection: MetadataSelection;
  aiSelected: boolean;
  aiSelectionLimitReached: boolean;
  aiPreviewOpen: boolean;
  inAiPreview: boolean;
  busy: boolean;
  anyBusy: boolean;
  metadataBusy: boolean;
  anyMetadataBusy: boolean;
  aiGenerating: boolean;
  aiApplying: boolean;
  locale: ResolvedLocale;
  tx: (en: string, zh: string) => string;
  onToggleAi: (bookmark: InboxBookmark) => void;
  onCategoryChange: (bookmarkId: string, categoryId: string) => void;
  onReview: (bookmark: InboxBookmark) => void;
  onFetchMetadata: (bookmark: InboxBookmark) => void;
  onToggleMetadata: (bookmarkId: string, field: MetadataField) => void;
}

export function InboxReviewCard({
  bookmark,
  categories,
  categoryName,
  tags,
  categoryDraft,
  metadata,
  selection,
  aiSelected,
  aiSelectionLimitReached,
  aiPreviewOpen,
  inAiPreview,
  busy,
  anyBusy,
  metadataBusy,
  anyMetadataBusy,
  aiGenerating,
  aiApplying,
  locale,
  tx,
  onToggleAi,
  onCategoryChange,
  onReview,
  onFetchMetadata,
  onToggleMetadata,
}: InboxReviewCardProps) {
  const selectedMetadataCount = selectionCount(selection);
  const titleAvailable = Boolean(
    metadata?.title && metadata.title !== bookmark.title && metadata.title.length <= 200,
  );
  const descriptionAvailable = Boolean(
    metadata?.description && metadata.description !== bookmark.description,
  );
  const canonicalAvailable = Boolean(
    metadata?.canonicalUrl && metadata.canonicalUrl !== bookmark.url,
  );
  const iconAvailable = Boolean(
    metadata?.iconUrl && metadata.iconUrl !== bookmark.iconUrl,
  );
  const aiSelectable =
    bookmark.healthPolicy === "normal" && !selectedMetadataCount && !aiPreviewOpen;
  const policyLabel = HEALTH_POLICY_LABELS[locale][bookmark.healthPolicy];

  const aiTooltip = selectedMetadataCount
    ? tx(
        "Clear selected metadata fields before adding this item to AI triage.",
        "加入 AI 整理前，请先取消勾选页面元数据字段。",
      )
    : bookmark.healthPolicy !== "normal"
      ? tx(
          `AI excludes ${policyLabel} bookmarks.`,
          `AI 整理会跳过「${policyLabel}」策略的书签。`,
        )
      : tx(
          "Select for reviewed Inbox AI triage.",
          "勾选以加入收件箱 AI 审核整理。",
        );

  const capturedRelative = formatRelativeTime(bookmark.inboxAt, locale);
  const capturedExact = formatInboxDate(bookmark.inboxAt, locale);

  return (
    <article className="inbox-row">
      <div className="inbox-copy">
        <div className="inbox-title-line">
          <label className={`inbox-ai-select${aiSelectable ? "" : " disabled"}`} title={aiTooltip}>
            <input
              type="checkbox"
              checked={aiSelected}
              disabled={!aiSelectable || (!aiSelected && aiSelectionLimitReached)}
              onChange={() => onToggleAi(bookmark)}
              aria-label={tx(
                `Select ${bookmark.title} for AI triage`,
                `选择「${bookmark.title}」用于 AI 整理`,
              )}
            />
            <span>AI</span>
          </label>
          <BookmarkFavicon
            iconUrl={bookmark.iconUrl ?? null}
            title={bookmark.title}
            url={bookmark.url}
            className="inbox-favicon"
          />
          <a href={bookmark.url} target="_blank" rel="noreferrer">
            {bookmark.title}
          </a>
          <span className={`inbox-policy-pill${bookmark.healthPolicy === "local-only" ? " is-local" : ""}`}>
            {bookmark.healthPolicy === "normal" ? tx("Captured", "已收录") : policyLabel}
          </span>
        </div>

        <div className="inbox-meta">
          <span>{safeDomainLabel(bookmark.url)}</span>
          <span title={capturedExact}>
            {tx(`Captured ${capturedRelative}`, `收录于 ${capturedRelative}`)}
          </span>
          {categoryName && (
            <span>{tx(`Currently ${categoryName}`, `当前分类：${categoryName}`)}</span>
          )}
          {tags.slice(0, 4).map((tag) => (
            <span className="inbox-tag" key={tag.toLocaleLowerCase()}>
              #{tag}
            </span>
          ))}
        </div>

        {bookmark.description && <p>{bookmark.description}</p>}
      </div>

      <div className="inbox-review">
        <label>
          <span>{tx("File to", "归档到分类")}</span>
          <select
            value={categoryDraft}
            disabled={busy || aiApplying}
            onChange={(event) => onCategoryChange(bookmark.id, event.target.value)}
          >
            <option value="">{tx("Uncategorized", "未分类")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          type="button"
          disabled={anyBusy || anyMetadataBusy || aiApplying}
          onClick={() => onReview(bookmark)}
        >
          {busy
            ? tx("Filing…", "归档中…")
            : selectedMetadataCount
              ? tx(`Apply ${selectedMetadataCount} + file`, `应用 ${selectedMetadataCount} 项并归档`)
              : tx("Review & file", "审核并归档")}
        </button>
      </div>

      <section
        className="inbox-metadata-review"
        aria-label={tx(
          `Metadata suggestions for ${bookmark.title}`,
          `${bookmark.title} 的页面元数据建议`,
        )}
      >
        <div className="inbox-metadata-heading">
          <div>
            <strong>{tx("Page metadata suggestions", "页面元数据建议")}</strong>
            <span>
              {bookmark.healthPolicy === "local-only"
                ? tx(
                    "Local/private metadata stays disabled on the server.",
                    "本地或内网书签已禁用服务端元数据抓取。",
                  )
                : tx(
                    "Read-only fetch. Checked fields apply only when you file this item.",
                    "抓取不会自动写入；勾选的字段仅在点击归档时应用。",
                  )}
            </span>
          </div>
          <button
            className="secondary"
            type="button"
            disabled={
              anyBusy ||
              anyMetadataBusy ||
              aiGenerating ||
              aiApplying ||
              bookmark.healthPolicy === "local-only" ||
              inAiPreview
            }
            onClick={() => onFetchMetadata(bookmark)}
          >
            {bookmark.healthPolicy === "local-only"
              ? tx("Metadata disabled", "已禁用抓取")
              : metadataBusy
                ? tx("Fetching…", "抓取中…")
                : metadata
                  ? tx("Refresh metadata", "重新抓取")
                  : tx("Fetch metadata", "抓取元数据")}
          </button>
        </div>

        {metadata && (
          <div className="inbox-metadata-fields">
            <label className={`inbox-metadata-field${titleAvailable ? " available" : ""}`}>
              <input
                type="checkbox"
                checked={selection.title && titleAvailable}
                disabled={!titleAvailable || anyBusy || inAiPreview}
                onChange={() => onToggleMetadata(bookmark.id, "title")}
              />
              <span>
                <small>{tx("Title", "标题")}</small>
                <strong>{metadata.title ?? tx("Not provided", "未提供")}</strong>
              </span>
              <em>
                {metadata.title && metadata.title.length > 200
                  ? tx("Too long to apply", "超出长度限制")
                  : titleAvailable
                    ? tx("Apply on file", "归档时应用")
                    : tx("Matches / unavailable", "已一致或不可用")}
              </em>
            </label>

            <label className={`inbox-metadata-field${descriptionAvailable ? " available" : ""}`}>
              <input
                type="checkbox"
                checked={selection.description && descriptionAvailable}
                disabled={!descriptionAvailable || anyBusy || inAiPreview}
                onChange={() => onToggleMetadata(bookmark.id, "description")}
              />
              <span>
                <small>{tx("Description", "描述")}</small>
                <strong>{metadata.description ?? tx("Not provided", "未提供")}</strong>
              </span>
              <em>
                {descriptionAvailable
                  ? tx("Apply on file", "归档时应用")
                  : tx("Matches / unavailable", "已一致或不可用")}
              </em>
            </label>

            <label className={`inbox-metadata-field${canonicalAvailable ? " available" : ""}`}>
              <input
                type="checkbox"
                checked={selection.canonicalUrl && canonicalAvailable}
                disabled={!canonicalAvailable || anyBusy || inAiPreview}
                onChange={() => onToggleMetadata(bookmark.id, "canonicalUrl")}
              />
              <span>
                <small>{tx("Canonical URL", "规范链接")}</small>
                <strong>{metadata.canonicalUrl ?? tx("Not provided", "未提供")}</strong>
              </span>
              <em>
                {canonicalAvailable
                  ? tx("Replace URL on file", "归档时替换链接")
                  : tx("Matches / unavailable", "已一致或不可用")}
              </em>
            </label>

            <label className={`inbox-metadata-field${iconAvailable ? " available" : ""}`}>
              <input
                type="checkbox"
                checked={selection.iconUrl && iconAvailable}
                disabled={!iconAvailable || anyBusy || inAiPreview}
                onChange={() => onToggleMetadata(bookmark.id, "iconUrl")}
              />
              <span>
                <small>{tx("Favicon", "网站图标")}</small>
                <strong>{metadata.iconUrl ?? tx("Not provided", "未提供")}</strong>
              </span>
              <em>
                {iconAvailable
                  ? tx("Apply on file", "归档时应用")
                  : tx("Matches / unavailable", "已一致或不可用")}
              </em>
            </label>

            {metadata.finalUrl && metadata.finalUrl !== bookmark.url && (
              <div className="inbox-metadata-info">
                <span>
                  <small>{tx("Resolved URL", "最终跳转链接")}</small>
                  <strong>{metadata.finalUrl}</strong>
                </span>
                <em>
                  {tx(
                    "Info only · redirects are not canonical",
                    "仅供参考 · 重定向不视为规范链接",
                  )}
                </em>
              </div>
            )}

            <div className="inbox-metadata-footnote">
              {tx(
                `Fetched ${formatInboxDate(metadata.fetchedAt, locale)} · suggestions stay separate until Review & file.`,
                `抓取于 ${formatInboxDate(metadata.fetchedAt, locale)} · 在点击「审核并归档」前不会写入书签。`,
              )}
            </div>
          </div>
        )}
      </section>
    </article>
  );
}
