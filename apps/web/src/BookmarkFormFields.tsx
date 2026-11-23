/**
 * [INPUT]: depends on Bookmark, Category, HealthPolicy, HealthStatus, HEALTH_POLICY_LABELS, HEALTH_STATUS_LABELS from @dockmark/core; useI18n from ./i18n
 * [OUTPUT]: exports BookmarkDraft, DraftPolicy, emptyDraft, BookmarkFields, and HealthBadge
 * [POS]: form field grid and health badge primitives extracted from BookmarkManagerLegacy to keep modules compact
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import {
  HEALTH_POLICY_LABELS,
  HEALTH_STATUS_LABELS,
  type Bookmark,
  type Category,
  type HealthPolicy,
  type HealthStatus,
} from "@dockmark/core";
import { useI18n } from "./i18n";

export type DraftPolicy = HealthPolicy | "auto";

export interface BookmarkDraft {
  title: string;
  url: string;
  description: string;
  categoryId: string;
  healthPolicy: DraftPolicy;
  tagsText: string;
}

export const emptyDraft: BookmarkDraft = {
  title: "",
  url: "",
  description: "",
  categoryId: "",
  healthPolicy: "auto",
  tagsText: "",
};

export function HealthBadge({ bookmark }: { bookmark: Bookmark }) {
  const { locale } = useI18n();
  const status: HealthStatus = bookmark.healthPolicy === "local-only"
    ? "local-only"
    : bookmark.healthPolicy === "ignore"
      ? "ignored"
      : bookmark.healthStatus;

  const label = bookmark.healthPolicy === "manual" && status === "unknown"
    ? HEALTH_POLICY_LABELS[locale].manual
    : HEALTH_STATUS_LABELS[locale][status];

  return (
    <span className={`health-badge status-${status} policy-${bookmark.healthPolicy}`}>
      {label}
    </span>
  );
}

interface BookmarkFieldsProps {
  draft: BookmarkDraft;
  categories: Category[];
  onChange: (draft: BookmarkDraft) => void;
  allowAuto: boolean;
  idPrefix: string;
  urlError?: string | null;
  tagsError?: string | null;
}

export function BookmarkFields({
  draft,
  categories,
  onChange,
  allowAuto,
  idPrefix,
  urlError,
  tagsError,
}: BookmarkFieldsProps) {
  const { locale, tx } = useI18n();
  const policyLabels = HEALTH_POLICY_LABELS[locale];
  const tagsHelpId = `${idPrefix}-tags-help`;
  const tagsErrorId = `${idPrefix}-tags-error`;
  const urlErrorId = `${idPrefix}-url-error`;

  return (
    <div className="field-grid bookmark-field-grid">
      <label>
        <span>{tx("Title", "标题")}</span>
        <input
          required
          maxLength={200}
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="GitHub"
        />
      </label>
      <label className={urlError ? "field-error" : undefined}>
        <span>{tx("URL", "网址")}</span>
        <input
          required
          value={draft.url}
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
          placeholder="github.com"
          inputMode="url"
          aria-invalid={Boolean(urlError)}
          aria-describedby={urlError ? urlErrorId : undefined}
        />
        {urlError && <small id={urlErrorId} className="field-error-message" role="alert">{urlError}</small>}
      </label>
      <label>
        <span>{tx("Category", "分类")}</span>
        <select value={draft.categoryId} onChange={(event) => onChange({ ...draft, categoryId: event.target.value })}>
          <option value="">{tx("Uncategorized", "未分类")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{tx("Health policy", "健康检查策略")}</span>
        <select
          value={draft.healthPolicy}
          onChange={(event) => onChange({ ...draft, healthPolicy: event.target.value as DraftPolicy })}
        >
          {allowAuto && <option value="auto">{policyLabels.auto}</option>}
          <option value="normal">{policyLabels.normal}</option>
          <option value="local-only">{policyLabels["local-only"]}</option>
          <option value="ignore">{policyLabels.ignore}</option>
          <option value="manual">{policyLabels.manual}</option>
        </select>
      </label>
      <label className="field-span-2">
        <span>{tx("Description", "描述")}</span>
        <textarea
          maxLength={2000}
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          placeholder={tx("Optional notes or a concise description used by search.", "可选备注或简洁描述，将参与全局搜索。")}
        />
      </label>
      <label className={`field-span-2${tagsError ? " field-error" : ""}`}>
        <span>{tx("Tags", "标签")}</span>
        <input
          value={draft.tagsText}
          onChange={(event) => onChange({ ...draft, tagsText: event.target.value })}
          placeholder={tx("dev, docs, self-hosted", "dev, docs, 自托管")}
          aria-invalid={Boolean(tagsError)}
          aria-describedby={`${tagsHelpId}${tagsError ? ` ${tagsErrorId}` : ""}`}
        />
        <small id={tagsHelpId} className="field-help">
          {tx(
            "Comma, semicolon, or newline separated · up to 12 tags · 40 characters each. Invalid input is rejected instead of truncated.",
            "使用逗号、分号或换行分隔 · 最多 12 个标签 · 每个不超过 40 字符。无效输入会直接提示错误而非静默截断。",
          )}
        </small>
        {tagsError && <small id={tagsErrorId} className="field-error-message" role="alert">{tagsError}</small>}
      </label>
    </div>
  );
}
