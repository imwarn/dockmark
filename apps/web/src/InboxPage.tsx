/**
 * [INPUT]: depends on useEffect, useMemo, useState from react; Category from @dockmark/core; listCategories, refreshBookmarkMetadata, updateBookmark, BookmarkMetadata from ./api; fetchAiSettings, generateAiOrganizationSuggestions, getAiProviderStatus, loadAiProviderSettings, AiOrganizationSuggestion, AiProviderSettings from ./ai-organization; listInbox, resolveInboxBookmark, reviewInboxBatch, InboxBookmark, InboxReviewPatch from ./inbox-api; listBookmarkTags from ./tag-api; useI18n from ./i18n; BookmarkFavicon from ./BookmarkFavicon; InboxReviewCard and metadata helpers from ./InboxReviewCard; ./ai-organization.css
 * [OUTPUT]: exports InboxPage component for reviewing, enriching, AI-triaging, and filing captured Inbox bookmarks with live AI Settings sync
 * [POS]: top-level /app/inbox triage view; coordinates batch AI preview, links to /app/settings/ai, and delegates per-bookmark review cards to InboxReviewCard
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState } from "react";
import type { Category } from "@dockmark/core";
import {
  listCategories,
  refreshBookmarkMetadata,
  updateBookmark,
  type BookmarkMetadata,
} from "./api";
import {
  fetchAiSettings,
  generateAiOrganizationSuggestions,
  getAiProviderStatus,
  loadAiProviderSettings,
  type AiOrganizationSuggestion,
  type AiProviderSettings,
} from "./ai-organization";
import { BookmarkFavicon } from "./BookmarkFavicon";
import { useI18n } from "./i18n";
import {
  listInbox,
  resolveInboxBookmark,
  reviewInboxBatch,
  type InboxBookmark,
  type InboxReviewPatch,
} from "./inbox-api";
import {
  InboxReviewCard,
  emptyMetadataSelection,
  selectionCount,
  type MetadataField,
  type MetadataSelection,
} from "./InboxReviewCard";
import { listBookmarkTags } from "./tag-api";
import "./ai-organization.css";

function sameTags(left: string[], right: string[]): boolean {
  const a = left.map((tag) => tag.toLocaleLowerCase()).sort();
  const b = right.map((tag) => tag.toLocaleLowerCase()).sort();
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function safeEndpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host || endpoint;
  } catch {
    return endpoint || "—";
  }
}

function openAiSettingsPage() {
  window.history.pushState({}, "", "/app/settings/ai");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function InboxPage() {
  const { locale, tx } = useI18n();
  const [bookmarks, setBookmarks] = useState<InboxBookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bookmarkTags, setBookmarkTags] = useState<Record<string, string[]>>({});
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [metadataById, setMetadataById] = useState<Record<string, BookmarkMetadata | null>>({});
  const [metadataSelections, setMetadataSelections] = useState<Record<string, MetadataSelection>>({});
  const [aiSelectedIds, setAiSelectedIds] = useState<Set<string>>(() => new Set());
  const [aiGeneratedIds, setAiGeneratedIds] = useState<Set<string>>(() => new Set());
  const [aiSuggestions, setAiSuggestions] = useState<AiOrganizationSuggestion[]>([]);
  const [aiAcceptedIds, setAiAcceptedIds] = useState<Set<string>>(() => new Set());
  const [aiProvider, setAiProvider] = useState<AiProviderSettings>(() => loadAiProviderSettings());
  const [aiApiReady, setAiApiReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metadataBusyId, setMetadataBusyId] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const categoryByName = useMemo(
    () => new Map(categories.map((category) => [category.name.toLocaleLowerCase(), category.id])),
    [categories],
  );
  const bookmarkById = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])),
    [bookmarks],
  );
  const aiEligible = useMemo(
    () => bookmarks.filter((bookmark) => bookmark.healthPolicy === "normal"),
    [bookmarks],
  );
  const aiPending = useMemo(
    () => aiEligible.filter((bookmark) => !aiGeneratedIds.has(bookmark.id)),
    [aiEligible, aiGeneratedIds],
  );
  const generatedInInbox = useMemo(
    () => aiEligible.filter((bookmark) => aiGeneratedIds.has(bookmark.id)).length,
    [aiEligible, aiGeneratedIds],
  );
  const aiPreviewIds = useMemo(
    () => new Set(aiSuggestions.map((suggestion) => suggestion.bookmarkId)),
    [aiSuggestions],
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextInbox, nextCategories, nextTags] = await Promise.all([
        listInbox(),
        listCategories(),
        listBookmarkTags(),
      ]);
      setBookmarks(nextInbox);
      setCategories(nextCategories);
      setBookmarkTags(nextTags);
      const nextIds = new Set(nextInbox.map((bookmark) => bookmark.id));
      setAiSelectedIds((current) => new Set(Array.from(current).filter((id) => nextIds.has(id))));
      setAiGeneratedIds((current) => new Set(Array.from(current).filter((id) => nextIds.has(id))));
      setAiSuggestions((current) => current.filter((suggestion) => nextIds.has(suggestion.bookmarkId)));
      setAiAcceptedIds((current) => new Set(Array.from(current).filter((id) => nextIds.has(id))));
      setCategoryDrafts((current) => {
        const next: Record<string, string> = {};
        for (const bookmark of nextInbox) {
          next[bookmark.id] = current[bookmark.id] ?? bookmark.categoryId ?? "";
        }
        return next;
      });
    } catch (caught) {
      setError(messageFrom(caught, tx("Could not load Inbox.", "无法加载收件箱。")));
    } finally {
      setLoading(false);
    }
  }

  async function refreshAiStatus() {
    try {
      const status = await getAiProviderStatus();
      setAiApiReady(status.apiKeyConfigured);
    } catch {
      setAiApiReady(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void refresh();
    void refreshAiStatus();
    void fetchAiSettings()
      .then((settings) => {
        if (cancelled) return;
        setAiProvider({
          endpoint: settings.endpoint,
          model: settings.model,
          timeoutSeconds: settings.timeoutSeconds,
        });
      })
      .catch(() => {
        // Keep local provider settings fallback.
      });

    const onAiSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<Partial<AiProviderSettings> | undefined>).detail;
      if (
        detail &&
        typeof detail.endpoint === "string" &&
        typeof detail.model === "string" &&
        typeof detail.timeoutSeconds === "number"
      ) {
        setAiProvider({
          endpoint: detail.endpoint,
          model: detail.model,
          timeoutSeconds: detail.timeoutSeconds,
        });
        return;
      }
      setAiProvider(loadAiProviderSettings());
    };
    window.addEventListener("dockmark:ai-settings", onAiSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("dockmark:ai-settings", onAiSettingsChanged);
    };
  }, []);

  async function fetchMetadata(bookmark: InboxBookmark) {
    if (bookmark.healthPolicy === "local-only") return;
    setMetadataBusyId(bookmark.id);
    setError(null);
    setNotice(null);
    try {
      const metadata = await refreshBookmarkMetadata(bookmark.id);
      setMetadataById((current) => ({ ...current, [bookmark.id]: metadata }));
      setMetadataSelections((current) => ({ ...current, [bookmark.id]: emptyMetadataSelection() }));
      setNotice(
        tx(
          `Metadata refreshed for “${bookmark.title}”. Nothing was applied automatically.`,
          `已刷新「${bookmark.title}」的页面元数据，尚未自动写入。`,
        ),
      );
    } catch (caught) {
      setError(messageFrom(caught, tx("Could not fetch bookmark metadata.", "无法抓取书签元数据。")));
    } finally {
      setMetadataBusyId(null);
    }
  }

  function toggleMetadata(bookmarkId: string, field: MetadataField) {
    setMetadataSelections((current) => {
      const selection = current[bookmarkId] ?? emptyMetadataSelection();
      return {
        ...current,
        [bookmarkId]: {
          ...selection,
          [field]: !selection[field],
        },
      };
    });
  }

  function removeLocalState(ids: Set<string>) {
    setBookmarks((current) => current.filter((item) => !ids.has(item.id)));
    setAiSelectedIds((current) => new Set(Array.from(current).filter((id) => !ids.has(id))));
    setAiGeneratedIds((current) => new Set(Array.from(current).filter((id) => !ids.has(id))));
    setMetadataById((current) => {
      const next = { ...current };
      ids.forEach((id) => delete next[id]);
      return next;
    });
    setMetadataSelections((current) => {
      const next = { ...current };
      ids.forEach((id) => delete next[id]);
      return next;
    });
  }

  async function review(bookmark: InboxBookmark) {
    setBusyId(bookmark.id);
    setError(null);
    setNotice(null);
    try {
      const categoryId = categoryDrafts[bookmark.id] || null;
      const metadata = metadataById[bookmark.id];
      const selection = metadataSelections[bookmark.id] ?? emptyMetadataSelection();
      const input: Parameters<typeof updateBookmark>[1] = {};

      if (selection.title && metadata?.title && metadata.title !== bookmark.title) {
        if (metadata.title.length > 200) {
          throw new Error(
            tx(
              "The suggested metadata title is longer than Dockmark's 200-character bookmark title limit.",
              "建议的元数据标题超过了 Dockmark 的 200 字符书签标题上限。",
            ),
          );
        }
        input.title = metadata.title;
      }
      if (selection.description && metadata?.description && metadata.description !== bookmark.description) {
        input.description = metadata.description;
      }
      if (selection.canonicalUrl && metadata?.canonicalUrl && metadata.canonicalUrl !== bookmark.url) {
        input.url = metadata.canonicalUrl;
      }
      if (selection.iconUrl && metadata?.iconUrl && metadata.iconUrl !== bookmark.iconUrl) {
        input.iconUrl = metadata.iconUrl;
      }

      if (Object.keys(input).length) {
        await updateBookmark(bookmark.id, input);
      }
      await resolveInboxBookmark(bookmark.id, categoryId);
      const removed = new Set([bookmark.id]);
      removeLocalState(removed);
      setAiSuggestions((current) => current.filter((suggestion) => !removed.has(suggestion.bookmarkId)));
      setAiAcceptedIds((current) => new Set(Array.from(current).filter((id) => !removed.has(id))));
      const categoryName = categoryId
        ? categoryById.get(categoryId) ?? tx("selected category", "所选分类")
        : tx("Uncategorized", "未分类");
      const applied = Object.keys(input).length;
      setNotice(
        applied
          ? tx(
              `Reviewed “${bookmark.title}” with ${applied} metadata suggestion${applied === 1 ? "" : "s"} → ${categoryName}.`,
              `已归档「${bookmark.title}」（应用 ${applied} 项元数据建议）→ ${categoryName}。`,
            )
          : tx(
              `Reviewed “${bookmark.title}” → ${categoryName}.`,
              `已归档「${bookmark.title}」→ ${categoryName}。`,
            ),
      );
    } catch (caught) {
      setError(messageFrom(caught, tx("Could not review Inbox bookmark.", "无法归档收件箱书签。")));
    } finally {
      setBusyId(null);
    }
  }

  function nextAiIds(progress = aiGeneratedIds, source = bookmarks): string[] {
    return source
      .filter((bookmark) => bookmark.healthPolicy === "normal" && !progress.has(bookmark.id))
      .filter((bookmark) => selectionCount(metadataSelections[bookmark.id]) === 0)
      .slice(0, 20)
      .map((bookmark) => bookmark.id);
  }

  function selectNextAi() {
    if (aiSuggestions.length) return;
    setAiSelectedIds(new Set(nextAiIds()));
    setError(null);
    setNotice(null);
  }

  function toggleAiBookmark(bookmark: InboxBookmark) {
    if (bookmark.healthPolicy !== "normal" || selectionCount(metadataSelections[bookmark.id]) > 0 || aiSuggestions.length) {
      return;
    }
    setAiSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(bookmark.id)) next.delete(bookmark.id);
      else if (next.size < 20) next.add(bookmark.id);
      return next;
    });
  }

  async function generateAiTriage() {
    if (aiSuggestions.length) {
      setError(
        tx(
          "Apply or discard the current Inbox AI preview before generating another batch.",
          "生成下一批之前，请先应用或放弃当前的收件箱 AI 预览。",
        ),
      );
      return;
    }
    const selected = bookmarks.filter((bookmark) => aiSelectedIds.has(bookmark.id) && bookmark.healthPolicy === "normal");
    if (!selected.length) return;
    setAiGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const next = await generateAiOrganizationSuggestions(
        aiProvider,
        selected.map((bookmark) => bookmark.id),
        locale,
      );
      const generatedAfter = new Set(aiGeneratedIds);
      next.forEach((suggestion) => generatedAfter.add(suggestion.bookmarkId));
      setAiGeneratedIds(generatedAfter);
      setAiSuggestions(next);
      setAiAcceptedIds(new Set(next.map((suggestion) => suggestion.bookmarkId)));
      const nextBatch = nextAiIds(generatedAfter);
      setAiSelectedIds(new Set(nextBatch));
      setNotice(
        tx(
          `Generated ${next.length} reviewed Inbox suggestion${next.length === 1 ? "" : "s"}. ${nextBatch.length} next pending item${nextBatch.length === 1 ? " is" : "s are"} queued; nothing has been filed yet.`,
          `已生成 ${next.length} 条收件箱整理建议，已预选下批 ${nextBatch.length} 项待处理书签；当前尚未归档。`,
        ),
      );
    } catch (caught) {
      setError(messageFrom(caught, tx("Could not generate AI suggestions.", "无法生成 AI 整理建议。")));
    } finally {
      setAiGenerating(false);
    }
  }

  function toggleAiSuggestion(id: string) {
    setAiAcceptedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function discardAiPreview() {
    setAiSuggestions([]);
    setAiAcceptedIds(new Set());
    setError(null);
    setNotice(
      tx(
        "Inbox AI preview discarded. Generated markers and queued selection were kept; no bookmark data changed.",
        "已放弃收件箱 AI 预览。已保留生成标记与待选队列，书签数据未发生更改。",
      ),
    );
  }

  async function applyAiTriage() {
    const accepted = aiSuggestions.filter((suggestion) => aiAcceptedIds.has(suggestion.bookmarkId));
    if (!accepted.length) return;
    setAiApplying(true);
    setError(null);
    setNotice(null);
    try {
      const patches: InboxReviewPatch[] = accepted.map((suggestion) => {
        const bookmark = bookmarkById.get(suggestion.bookmarkId);
        if (!bookmark || bookmark.healthPolicy !== "normal") {
          throw new Error(
            tx(
              "One or more Inbox bookmarks changed eligibility. Refresh and regenerate before filing.",
              "部分收件箱书签的健康检查策略已变化，请刷新后重新生成再归档。",
            ),
          );
        }
        const categoryId = suggestion.categoryName
          ? categoryByName.get(suggestion.categoryName.toLocaleLowerCase())
          : null;
        if (suggestion.categoryName && !categoryId) {
          throw new Error(
            tx(
              `Suggested category “${suggestion.categoryName}” no longer exists. Refresh and regenerate before filing.`,
              `建议分类「${suggestion.categoryName}」已不存在，请刷新后重新生成再归档。`,
            ),
          );
        }
        return {
          bookmarkId: bookmark.id,
          title: suggestion.title || bookmark.title,
          description: suggestion.description || null,
          categoryId: categoryId ?? null,
          tags: suggestion.tags,
        };
      });

      const result = await reviewInboxBatch(patches);
      const appliedIds = new Set(result.bookmarkIds);
      setBookmarkTags((current) => {
        const next = { ...current };
        for (const patch of patches) {
          if (appliedIds.has(patch.bookmarkId)) next[patch.bookmarkId] = patch.tags;
        }
        return next;
      });
      removeLocalState(appliedIds);
      setAiSuggestions((current) => current.filter((suggestion) => !appliedIds.has(suggestion.bookmarkId)));
      setAiAcceptedIds((current) => new Set(Array.from(current).filter((id) => !appliedIds.has(id))));
      setNotice(
        tx(
          `Applied and filed ${result.applied} reviewed Inbox AI suggestion${result.applied === 1 ? "" : "s"} in one batch. URL, favicon, and health fields stayed untouched.`,
          `已一次性应用并归档 ${result.applied} 条 AI 整理建议，链接、图标与健康检查字段均保持不变。`,
        ),
      );
    } catch (caught) {
      setError(messageFrom(caught, tx("Could not apply Inbox AI suggestions.", "无法应用收件箱 AI 整理建议。")));
    } finally {
      setAiApplying(false);
    }
  }

  return (
    <main className="inbox-shell">
      <header className="inbox-hero">
        <div className="inbox-hero-copy">
          <h1>{tx("Inbox", "收件箱")}</h1>
          <p>
            {tx(
              "Review tabs captured from the Dockmark extension, fetch optional page metadata, or run reviewed AI triage before filing into your library.",
              "审核来自 Dockmark 扩展的收录页面，按需抓取页面元数据或批量运行 AI 整理后再归档到书签库。",
            )}
          </p>
        </div>
        <div className="inbox-hero-pills">
          <span className="inbox-stat-pill" aria-label={tx(`${bookmarks.length} Inbox bookmarks`, `收件箱中有 ${bookmarks.length} 条待归档书签`)}>
            <strong>{bookmarks.length}</strong>
            <span>{tx("waiting", "待归档")}</span>
          </span>
          <span className="inbox-stat-pill muted">
            <strong>{aiEligible.length}</strong>
            <span>{tx("AI eligible", "可 AI 整理")}</span>
          </span>
        </div>
      </header>

      {(notice || error) && (
        <div className={`inbox-notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
          {error ?? notice}
        </div>
      )}

      <section className="inbox-ai-panel" aria-label={tx("AI-assisted Inbox triage", "收件箱 AI 辅助整理")}>
        <div className="inbox-ai-heading">
          <div>
            <h2>{tx("AI Triage (Reviewed)", "AI 批量整理（审核后归档）")}</h2>
            <p>
              {tx(
                "Uses your Settings AI provider for up to 20 normal bookmarks per batch. Suggests title, description, existing category, and tags while leaving URL, favicon, and health fields untouched.",
                "使用设置中的 AI 模型，单批最多处理 20 条常规书签；仅建议标题、描述、已有分类和标签，不改动链接、图标及健康检查字段。",
              )}
            </p>
          </div>
          <div className="inbox-ai-summary">
            <span className="inbox-ai-pill">
              <strong>{aiSelectedIds.size}/20</strong> {tx("selected", "已选")}
            </span>
            <span className="inbox-ai-meta">
              {tx(
                `${generatedInInbox} generated · ${aiPending.length} pending`,
                `本轮已生成 ${generatedInInbox} · 待处理 ${aiPending.length}`,
              )}
            </span>
          </div>
        </div>

        <div className="ai-config-strip ai-config-strip-inline">
          <div className="ai-config-strip-meta">
            <span className={`ai-config-badge${aiProvider.model.trim() ? " is-ready" : " is-warn"}`}>
              {aiProvider.model.trim() || tx("No model configured", "未配置模型")}
            </span>
            <span className="ai-config-detail" title={aiProvider.endpoint}>
              {safeEndpointHost(aiProvider.endpoint)} · {aiProvider.timeoutSeconds}s
            </span>
            <span className={`ai-config-badge${aiApiReady ? " is-ready" : ""}`}>
              {aiApiReady === null
                ? tx("Checking secret…", "检查密钥中…")
                : aiApiReady
                  ? tx("Secret ready", "密钥就绪")
                  : tx("Secret missing", "需配置密钥")}
            </span>
          </div>
          <div className="ai-config-strip-actions">
            <button className="secondary ai-settings-nav-btn" type="button" onClick={openAiSettingsPage}>
              {tx("Configure in Settings → AI Service →", "前往「设置 → AI 服务」配置 →")}
            </button>
          </div>
        </div>

        <div className="inbox-ai-actions">
          <button
            className="secondary"
            type="button"
            disabled={loading || aiGenerating || aiApplying || aiSuggestions.length > 0 || !aiPending.length}
            onClick={selectNextAi}
          >
            {tx(`Select next ${Math.min(20, aiPending.length)}`, `选中下批 ${Math.min(20, aiPending.length)} 项`)}
          </button>
          <button
            className="text-action"
            type="button"
            disabled={!aiSelectedIds.size || aiGenerating || aiApplying || aiSuggestions.length > 0}
            onClick={() => setAiSelectedIds(new Set())}
          >
            {tx("Clear selection", "清空选择")}
          </button>
          <button
            className="primary"
            type="button"
            disabled={
              aiApiReady !== true ||
              !aiProvider.model.trim() ||
              !aiSelectedIds.size ||
              aiGenerating ||
              aiApplying ||
              aiSuggestions.length > 0
            }
            onClick={() => void generateAiTriage()}
          >
            {aiGenerating
              ? tx("Generating…", "生成中…")
              : aiSuggestions.length
                ? tx("Review current preview first", "请先处理当前预览")
                : aiApiReady === false
                  ? tx("Configure Worker AI secret first", "请先配置 Worker AI 密钥")
                  : !aiProvider.model.trim()
                    ? tx("Configure AI model first", "请先配置 AI 模型")
                    : tx(`Generate suggestions (${aiSelectedIds.size})`, `生成整理建议（${aiSelectedIds.size}）`)}
          </button>
          {aiApiReady === null && (
            <button className="text-action" type="button" onClick={() => void refreshAiStatus()}>
              {tx("Refresh AI status", "刷新 AI 状态")}
            </button>
          )}
        </div>
        <p className="inbox-ai-note">
          {tx(
            "Items with page-metadata fields checked are excluded from AI selection so the two review paths cannot conflict.",
            "已勾选页面元数据字段的书签会自动排除在 AI 选择之外，避免两条归档路径互相覆盖。",
          )}
        </p>

        {aiSuggestions.length > 0 && (
          <div className="inbox-ai-preview">
            <div className="inbox-ai-preview-heading">
              <div>
                <strong>{tx("AI preview · nothing filed yet", "AI 整理预览 · 尚未归档")}</strong>
                <span>
                  {tx(
                    "Check suggestions to apply and file. Unchecked items remain in Inbox.",
                    "勾选需要应用并归档的建议；未勾选项将保留在收件箱。",
                  )}
                </span>
              </div>
              <div className="inbox-ai-preview-actions">
                <button
                  className="text-action"
                  type="button"
                  onClick={() => setAiAcceptedIds(new Set(aiSuggestions.map((suggestion) => suggestion.bookmarkId)))}
                >
                  {tx("Select all", "全选")}
                </button>
                <button
                  className="text-action"
                  type="button"
                  onClick={() => setAiAcceptedIds(new Set())}
                >
                  {tx("Clear", "清空")}
                </button>
                <button
                  className="text-action"
                  type="button"
                  disabled={aiApplying}
                  onClick={discardAiPreview}
                >
                  {tx("Discard preview", "放弃预览")}
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={aiApplying || !aiAcceptedIds.size}
                  onClick={() => void applyAiTriage()}
                >
                  {aiApplying
                    ? tx("Applying & filing…", "应用并归档中…")
                    : tx(`Apply & file (${aiAcceptedIds.size})`, `应用并归档（${aiAcceptedIds.size}）`)}
                </button>
              </div>
            </div>
            <div className="inbox-ai-preview-list">
              {aiSuggestions.map((suggestion) => {
                const bookmark = bookmarkById.get(suggestion.bookmarkId);
                if (!bookmark) return null;
                const currentCategory = bookmark.categoryId
                  ? categoryById.get(bookmark.categoryId) ?? tx("Unknown category", "未知分类")
                  : tx("Uncategorized", "未分类");
                const nextCategory = suggestion.categoryName ?? tx("Uncategorized", "未分类");
                const currentTags = bookmarkTags[bookmark.id] ?? [];
                const changes = [
                  suggestion.title !== bookmark.title && tx("TITLE", "标题"),
                  suggestion.description !== (bookmark.description ?? "") && tx("DESCRIPTION", "描述"),
                  nextCategory !== currentCategory && tx("CATEGORY", "分类"),
                  !sameTags(suggestion.tags, currentTags) && tx("TAGS", "标签"),
                ].filter(Boolean);
                return (
                  <label className="inbox-ai-suggestion" key={suggestion.bookmarkId}>
                    <input
                      type="checkbox"
                      checked={aiAcceptedIds.has(suggestion.bookmarkId)}
                      onChange={() => toggleAiSuggestion(suggestion.bookmarkId)}
                    />
                    <BookmarkFavicon
                      iconUrl={bookmark.iconUrl ?? null}
                      title={suggestion.title || bookmark.title}
                      url={bookmark.url}
                      className="inbox-ai-favicon"
                    />
                    <span>
                      <strong>{suggestion.title || bookmark.title}</strong>
                      <small>
                        {nextCategory} ·{" "}
                        {suggestion.tags.length
                          ? suggestion.tags.map((tag) => `#${tag}`).join(" ")
                          : tx("no tags", "无标签")}
                      </small>
                      <small>{suggestion.description || tx("No suggested description", "无建议描述")}</small>
                    </span>
                    <em>{changes.join(" · ") || tx("NO CHANGE", "无字段变更")}</em>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="inbox-panel">
        <div className="inbox-panel-heading">
          <div>
            <strong>{tx("Captured bookmarks", "待审核书签")}</strong>
            <span>
              {tx(
                "Exact URL duplicates are blocked on capture; metadata updates stay behind your review.",
                "收录时已自动拦截完全重复的链接；元数据仅在审核确认后写入。",
              )}
            </span>
          </div>
          <button
            className="secondary"
            type="button"
            disabled={loading || busyId !== null || metadataBusyId !== null || aiGenerating || aiApplying}
            onClick={() => void refresh()}
          >
            {tx("Refresh", "刷新")}
          </button>
        </div>

        {loading ? (
          <div className="inbox-empty">{tx("Loading Inbox…", "正在加载收件箱…")}</div>
        ) : bookmarks.length ? (
          <div className="inbox-list">
            {bookmarks.map((bookmark) => (
              <InboxReviewCard
                key={bookmark.id}
                bookmark={bookmark}
                categories={categories}
                categoryName={
                  bookmark.categoryId
                    ? bookmark.categoryName ?? categoryById.get(bookmark.categoryId) ?? tx("Categorized", "已分类")
                    : null
                }
                tags={bookmarkTags[bookmark.id] ?? []}
                categoryDraft={categoryDrafts[bookmark.id] ?? bookmark.categoryId ?? ""}
                metadata={metadataById[bookmark.id] ?? null}
                selection={metadataSelections[bookmark.id] ?? emptyMetadataSelection()}
                aiSelected={aiSelectedIds.has(bookmark.id)}
                aiSelectionLimitReached={aiSelectedIds.size >= 20}
                aiPreviewOpen={aiSuggestions.length > 0}
                inAiPreview={aiPreviewIds.has(bookmark.id)}
                busy={busyId === bookmark.id}
                anyBusy={busyId !== null}
                metadataBusy={metadataBusyId === bookmark.id}
                anyMetadataBusy={metadataBusyId !== null}
                aiGenerating={aiGenerating}
                aiApplying={aiApplying}
                locale={locale}
                tx={tx}
                onToggleAi={toggleAiBookmark}
                onCategoryChange={(bookmarkId, categoryId) =>
                  setCategoryDrafts((current) => ({ ...current, [bookmarkId]: categoryId }))
                }
                onReview={(item) => void review(item)}
                onFetchMetadata={(item) => void fetchMetadata(item)}
                onToggleMetadata={toggleMetadata}
              />
            ))}
          </div>
        ) : (
          <div className="inbox-empty">
            <strong>{tx("Inbox is clear.", "收件箱已清空。")}</strong>
            <span>
              {tx(
                "Use the paired Dockmark extension to save the current tab or capture multiple tabs for review.",
                "使用已配对的 Dockmark 浏览器扩展收录当前标签页或批量收录多个标签页。",
              )}
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
