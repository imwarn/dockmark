/**
 * [INPUT]: depends on Bookmark, Category, HEALTH_POLICY_LABELS from @dockmark/core; AI APIs from ./ai-organization; listBookmarkTags from ./tag-api; useI18n from ./i18n
 * [OUTPUT]: exports AiOrganizationSettings component
 * [POS]: provider configuration, bookmark selection queue, and diff review workbench for AI-assisted organization inside the Organize tab
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState } from "react";
import { HEALTH_POLICY_LABELS, type Bookmark, type Category } from "@dockmark/core";
import {
  applyAiOrganizationPatches,
  generateAiOrganizationSuggestions,
  getAiProviderStatus,
  loadAiProviderSettings,
  MAX_AI_TIMEOUT_SECONDS,
  MIN_AI_TIMEOUT_SECONDS,
  saveAiProviderSettings,
  type AiOrganizationPatch,
  type AiOrganizationSuggestion,
  type AiProviderSettings,
} from "./ai-organization";
import { useI18n } from "./i18n";
import { listBookmarkTags } from "./tag-api";
import "./ai-organization.css";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
}

type QueueFilter = "pending" | "generated" | "all";

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function sameTags(left: string[], right: string[]) {
  const a = left.map((tag) => tag.toLocaleLowerCase()).sort();
  const b = right.map((tag) => tag.toLocaleLowerCase()).sort();
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

export function AiOrganizationSettings({ bookmarks, categories, onChanged }: Props) {
  const { locale, tx } = useI18n();
  const policyLabels = HEALTH_POLICY_LABELS[locale];
  const genericError = tx("Something went wrong.", "操作失败，请重试。");

  const [provider, setProvider] = useState<AiProviderSettings>(() => loadAiProviderSettings());
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [bookmarkTags, setBookmarkTags] = useState<Record<string, string[]>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [generatedIds, setGeneratedIds] = useState<Set<string>>(() => new Set());
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("pending");
  const [suggestions, setSuggestions] = useState<AiOrganizationSuggestion[]>([]);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [loadingTags, setLoadingTags] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingTags(true);
      try {
        const [nextTags, status] = await Promise.all([listBookmarkTags(), getAiProviderStatus()]);
        if (cancelled) return;
        setBookmarkTags(nextTags);
        setApiKeyConfigured(status.apiKeyConfigured);
      } catch (caught) {
        if (!cancelled) setError(messageFrom(caught, genericError));
      } finally {
        if (!cancelled) setLoadingTags(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const queryFilteredBookmarks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return bookmarks;
    return bookmarks.filter((bookmark) =>
      bookmark.title.toLocaleLowerCase().includes(needle) || bookmark.url.toLocaleLowerCase().includes(needle),
    );
  }, [bookmarks, query]);

  const filteredBookmarks = useMemo(() => queryFilteredBookmarks.filter((bookmark) => {
    if (queueFilter === "pending") return bookmark.healthPolicy === "normal" && !generatedIds.has(bookmark.id);
    if (queueFilter === "generated") return bookmark.healthPolicy === "normal" && generatedIds.has(bookmark.id);
    return true;
  }), [generatedIds, queryFilteredBookmarks, queueFilter]);

  const eligible = useMemo(
    () => filteredBookmarks.filter((bookmark) => bookmark.healthPolicy === "normal"),
    [filteredBookmarks],
  );

  const allEligible = useMemo(
    () => bookmarks.filter((bookmark) => bookmark.healthPolicy === "normal"),
    [bookmarks],
  );
  const generatedCount = useMemo(
    () => allEligible.filter((bookmark) => generatedIds.has(bookmark.id)).length,
    [allEligible, generatedIds],
  );
  const remainingCount = allEligible.length - generatedCount;
  const selectedGeneratedCount = useMemo(
    () => Array.from(selectedIds).filter((id) => generatedIds.has(id)).length,
    [generatedIds, selectedIds],
  );

  function providerTimeoutValid() {
    return Number.isInteger(provider.timeoutSeconds) &&
      provider.timeoutSeconds >= MIN_AI_TIMEOUT_SECONDS &&
      provider.timeoutSeconds <= MAX_AI_TIMEOUT_SECONDS;
  }

  function saveProvider() {
    setError(null);
    setMessage(null);
    if (!providerTimeoutValid()) {
      setError(tx(
        `Provider timeout must be between ${MIN_AI_TIMEOUT_SECONDS} and ${MAX_AI_TIMEOUT_SECONDS} seconds.`,
        `超时时间需在 ${MIN_AI_TIMEOUT_SECONDS} 到 ${MAX_AI_TIMEOUT_SECONDS} 秒之间。`,
      ));
      return;
    }
    saveAiProviderSettings(provider);
    setMessage(tx(
      "Provider endpoint, model, and timeout saved locally. The API key stays in the Worker secret store.",
      "接口地址、模型与超时配置已保存到本地浏览器；API 密钥仅保存在 Worker 密钥库中。",
    ));
  }

  async function refreshKeyStatus() {
    setError(null);
    try {
      const status = await getAiProviderStatus();
      setApiKeyConfigured(status.apiKeyConfigured);
      setMessage(status.apiKeyConfigured
        ? tx("Worker AI secret is configured.", "Worker AI 密钥已就绪。")
        : tx("Worker AI secret is not configured yet.", "尚未配置 Worker AI 密钥。"));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
    }
  }

  function toggleBookmark(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      return next;
    });
  }

  function nextPendingIds(progress: Set<string>) {
    const needle = query.trim().toLocaleLowerCase();
    return bookmarks
      .filter((bookmark) => bookmark.healthPolicy === "normal" && !progress.has(bookmark.id))
      .filter((bookmark) => !needle || bookmark.title.toLocaleLowerCase().includes(needle) || bookmark.url.toLocaleLowerCase().includes(needle))
      .slice(0, 20)
      .map((bookmark) => bookmark.id);
  }

  function selectVisible() {
    setSelectedIds(new Set(eligible.slice(0, 20).map((bookmark) => bookmark.id)));
  }

  function selectNextPending() {
    setQueueFilter("pending");
    setSelectedIds(new Set(nextPendingIds(generatedIds)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function resetSessionProgress() {
    if (suggestions.length) return;
    setGeneratedIds(new Set());
    setQueueFilter("pending");
    setSelectedIds(new Set());
    setMessage(tx(
      "AI generation progress reset for this session. No bookmark data was changed.",
      "已重置本次页面会话的生成进度，未修改任何书签数据。",
    ));
    setError(null);
  }

  function discardPreview() {
    setSuggestions([]);
    setAcceptedIds(new Set());
    setMessage(tx(
      "Current AI preview discarded. Session markers and next queue selection were kept.",
      "已放弃当前 AI 预览，保留已生成标记与下一批待选队列。",
    ));
    setError(null);
  }

  async function generate() {
    if (suggestions.length) {
      setError(tx(
        "Review, apply, or discard the current AI preview before generating another batch.",
        "请先复核、应用或放弃当前 AI 建议，再生成下一批。",
      ));
      return;
    }
    const selected = bookmarks.filter((bookmark) => selectedIds.has(bookmark.id) && bookmark.healthPolicy === "normal");
    if (!selected.length) return;
    setGenerating(true);
    setError(null);
    setMessage(null);
    setSuggestions([]);
    setAcceptedIds(new Set());
    try {
      saveAiProviderSettings(provider);
      const next = await generateAiOrganizationSuggestions(
        provider,
        selected.map((bookmark) => bookmark.id),
        locale,
      );
      const generatedAfter = new Set(generatedIds);
      next.forEach((suggestion) => generatedAfter.add(suggestion.bookmarkId));
      setGeneratedIds(generatedAfter);
      setSuggestions(next);
      setAcceptedIds(new Set(next.map((suggestion) => suggestion.bookmarkId)));
      setQueueFilter("pending");
      const nextBatch = nextPendingIds(generatedAfter);
      setSelectedIds(new Set(nextBatch));
      const remainingAfter = allEligible.filter((bookmark) => !generatedAfter.has(bookmark.id)).length;
      setMessage(
        next.length === selected.length
          ? tx(
              `Generated ${next.length} suggestions. ${remainingAfter} eligible bookmark${remainingAfter === 1 ? "" : "s"} remain; ${nextBatch.length} queued next.`,
              `已生成 ${next.length} 条建议，剩余 ${remainingAfter} 个可整理书签，已自动预选下一批 ${nextBatch.length} 项。`,
            )
          : tx(
              `Generated ${next.length} of ${selected.length} requested suggestions. Missing rows stay pending; ${nextBatch.length} queued next.`,
              `已生成 ${next.length}/${selected.length} 条建议，未返回项仍保留在待生成队列，已预选下一批 ${nextBatch.length} 项。`,
            ),
      );
    } catch (caught) {
      setError(messageFrom(caught, genericError));
    } finally {
      setGenerating(false);
    }
  }

  function toggleSuggestion(id: string) {
    setAcceptedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applySuggestions() {
    const accepted = suggestions.filter((suggestion) => acceptedIds.has(suggestion.bookmarkId));
    if (!accepted.length) return;
    setApplying(true);
    setError(null);
    setMessage(null);
    let skipped = 0;

    try {
      const patches: AiOrganizationPatch[] = [];
      for (const suggestion of accepted) {
        const current = bookmarkById.get(suggestion.bookmarkId);
        if (!current || current.healthPolicy !== "normal") {
          skipped += 1;
          continue;
        }

        let categoryId: string | null = null;
        if (suggestion.categoryName) {
          const mapped = categoryByName.get(suggestion.categoryName.toLocaleLowerCase());
          if (!mapped) {
            throw new Error(tx(
              `Suggested category “${suggestion.categoryName}” no longer exists. Refresh and regenerate before applying.`,
              `建议的分类「${suggestion.categoryName}」已不存在，请刷新并重新生成后再应用。`,
            ));
          }
          categoryId = mapped;
        }

        patches.push({
          bookmarkId: current.id,
          title: suggestion.title || current.title,
          description: suggestion.description || null,
          categoryId,
          tags: suggestion.tags,
        });
      }

      if (!patches.length) {
        setMessage(tx(
          `No reviewed AI patches were applied${skipped ? `; ${skipped} bookmarks are no longer AI-eligible` : ""}.`,
          `未应用任何 AI 建议${skipped ? `；${skipped} 个书签已不符合 AI 整理条件` : ""}。`,
        ));
        return;
      }

      const result = await applyAiOrganizationPatches(patches);
      const appliedIds = new Set(result.bookmarkIds);
      setBookmarkTags((current) => {
        const next = { ...current };
        for (const patch of patches) {
          if (appliedIds.has(patch.bookmarkId)) next[patch.bookmarkId] = patch.tags;
        }
        return next;
      });
      await onChanged();
      setSuggestions((current) => current.filter((suggestion) => !appliedIds.has(suggestion.bookmarkId)));
      setAcceptedIds((current) => new Set(Array.from(current).filter((id) => !appliedIds.has(id))));
      setMessage(tx(
        `Applied ${result.applied} reviewed AI suggestion${result.applied === 1 ? "" : "s"} atomically${skipped ? `; ${skipped} skipped` : ""}. URLs and health policies were untouched.`,
        `已一次性应用 ${result.applied} 条 AI 建议${skipped ? `（跳过 ${skipped} 项）` : ""}，网址与健康策略未作修改。`,
      ));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="browser-settings-section ai-organization-section">
      <div className="settings-heading ai-compact-heading">
        <div>
          <h2>{tx("AI-assisted organization", "AI 辅助整理")}</h2>
          <p>
            {tx(
              "Classify bookmarks into existing categories, clean titles, draft descriptions, and suggest tags. Nothing is sent or applied until you review.",
              "按现有分类整理书签、优化标题、起草描述并推荐标签。仅在你手动生成并确认差异后才会写入。",
            )}
          </p>
        </div>
        <div className="settings-sync-state">
          <strong>
            {apiKeyConfigured === null
              ? tx("Checking AI secret", "检查 AI 密钥中")
              : apiKeyConfigured
                ? tx("Worker secret ready", "Worker 密钥就绪")
                : tx("Worker secret required", "需配置 Worker 密钥")}
          </strong>
          <span>{tx("Max 20 bookmarks / request", "单次最多 20 个书签")}</span>
        </div>
      </div>

      <div className="settings-grid">
        <article className="form-card settings-card ai-provider-card">
          <div className="card-heading">
            <div>
              <h3>{tx("OpenAI-compatible provider", "OpenAI 兼容接口配置")}</h3>
              <p>
                {tx(
                  "Endpoint, model, and timeout are saved locally in this browser. The API key is read by the Worker from ",
                  "接口地址、模型与超时仅保存在当前浏览器；API 密钥由 Worker 从 ",
                )}
                <code>DOCKMARK_AI_API_KEY</code>
                {tx(".", " 读取，绝不暴露给前端。")}
              </p>
            </div>
          </div>
          <label className="settings-field">
            <span>{tx("Chat completions endpoint", "Chat Completions 接口地址")}</span>
            <input
              value={provider.endpoint}
              onChange={(event) => setProvider({ ...provider, endpoint: event.target.value })}
              placeholder="https://api.example.com/v1/chat/completions"
              inputMode="url"
            />
          </label>
          <label className="settings-field">
            <span>{tx("Model", "模型")}</span>
            <input
              value={provider.model}
              onChange={(event) => setProvider({ ...provider, model: event.target.value })}
              placeholder={tx("Provider model id", "模型 ID（如 gpt-4o-mini）")}
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span>{tx("Provider timeout · seconds", "请求超时（秒）")}</span>
            <input
              type="number"
              min={MIN_AI_TIMEOUT_SECONDS}
              max={MAX_AI_TIMEOUT_SECONDS}
              step={5}
              value={provider.timeoutSeconds}
              onChange={(event) => setProvider({ ...provider, timeoutSeconds: Number(event.target.value) })}
            />
            <small className="field-help">
              {tx(
                `Default 90s · allowed ${MIN_AI_TIMEOUT_SECONDS}–${MAX_AI_TIMEOUT_SECONDS}s. Slower self-hosted models can use a longer window.`,
                `默认 90 秒 · 允许范围 ${MIN_AI_TIMEOUT_SECONDS}–${MAX_AI_TIMEOUT_SECONDS} 秒。响应较慢的自托管模型可适当调大。`,
              )}
            </small>
          </label>
          <div className="ai-provider-actions">
            <button className="secondary" type="button" onClick={saveProvider}>
              {tx("Save provider locally", "保存本地配置")}
            </button>
            <button className="text-action" type="button" onClick={() => void refreshKeyStatus()}>
              {tx("Refresh secret status", "刷新密钥状态")}
            </button>
          </div>
          <p className="settings-footnote">
            {tx("Set the secret with ", "使用 ")}
            <code>npx wrangler secret put DOCKMARK_AI_API_KEY</code>
            {tx(
              " or in the Cloudflare dashboard. The endpoint must be public HTTPS.",
              " 或在 Cloudflare 控制台配置密钥；接口地址须为公网 HTTPS。",
            )}
          </p>
        </article>

        <article className="form-card settings-card ai-selection-card">
          <div className="card-heading">
            <div>
              <h3>{tx("Select bookmarks", "选择待整理书签")}</h3>
              <p>
                {tx(
                  "Progress is tracked for this session so generated items can be filtered out while the next batch queues automatically.",
                  "进度仅在本次页面会话内跟踪，生成后会自动预选下一批待整理书签。",
                )}
              </p>
            </div>
            <span>{selectedIds.size}/20</span>
          </div>
          <input
            className="ai-bookmark-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tx("Filter title or URL…", "按标题或网址筛选…")}
            aria-label={tx("Filter bookmarks for AI organization", "筛选 AI 整理书签")}
          />
          <div className="ai-queue-summary">
            <div className="ai-queue-filters" role="group" aria-label={tx("AI generation queue filter", "AI 生成队列筛选")}>
              <button className={queueFilter === "pending" ? "active" : ""} type="button" onClick={() => setQueueFilter("pending")}>
                {tx(`Pending ${remainingCount}`, `待生成 ${remainingCount}`)}
              </button>
              <button className={queueFilter === "generated" ? "active" : ""} type="button" onClick={() => setQueueFilter("generated")}>
                {tx(`Generated ${generatedCount}`, `已生成 ${generatedCount}`)}
              </button>
              <button className={queueFilter === "all" ? "active" : ""} type="button" onClick={() => setQueueFilter("all")}>
                {tx(`All ${bookmarks.length}`, `全部 ${bookmarks.length}`)}
              </button>
            </div>
            <span>
              {tx(
                `${generatedCount} generated this session · ${remainingCount} remaining`,
                `本次已生成 ${generatedCount} 项 · 剩余 ${remainingCount} 项`,
              )}
            </span>
          </div>
          <div className="ai-selection-actions">
            <button className="text-action" type="button" onClick={selectVisible} disabled={!eligible.length}>
              {tx(`Select first ${Math.min(20, eligible.length)} visible`, `选择当前前 ${Math.min(20, eligible.length)} 项`)}
            </button>
            <button className="text-action" type="button" onClick={selectNextPending} disabled={!remainingCount}>
              {tx("Select next pending", "选择下一批待生成")}
            </button>
            <button className="text-action muted-action" type="button" onClick={clearSelection} disabled={!selectedIds.size}>
              {tx("Clear", "清空")}
            </button>
            <button className="text-action muted-action" type="button" onClick={resetSessionProgress} disabled={!generatedIds.size || suggestions.length > 0}>
              {tx("Reset progress", "重置进度")}
            </button>
          </div>
          {selectedGeneratedCount > 0 && (
            <p className="ai-selection-warning">
              {tx(
                `${selectedGeneratedCount} selected bookmark${selectedGeneratedCount === 1 ? " was" : "s were"} already generated in this session and will be refreshed.`,
                `已选中有 ${selectedGeneratedCount} 个书签在本次会话已生成过，继续生成将刷新其建议。`,
              )}
            </p>
          )}
          <div className="ai-bookmark-list">
            {filteredBookmarks.slice(0, 120).map((bookmark) => {
              const protectedPolicy = bookmark.healthPolicy !== "normal";
              const generated = generatedIds.has(bookmark.id);
              const category = categoryById.get(bookmark.categoryId ?? "") ?? tx("Uncategorized", "未分类");
              return (
                <label className={`ai-bookmark-row${protectedPolicy ? " is-protected" : ""}${generated ? " is-generated" : ""}`} key={bookmark.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(bookmark.id)}
                    disabled={protectedPolicy || (!selectedIds.has(bookmark.id) && selectedIds.size >= 20)}
                    onChange={() => toggleBookmark(bookmark.id)}
                  />
                  <span>
                    <strong>{bookmark.title}</strong>
                    <small>{bookmark.url}</small>
                  </span>
                  <em>
                    {protectedPolicy
                      ? policyLabels[bookmark.healthPolicy]
                      : generated
                        ? tx(`Generated · ${category}`, `已生成 · ${category}`)
                        : category}
                  </em>
                </label>
              );
            })}
            {!filteredBookmarks.length && (
              <p className="ai-queue-empty">{tx("No bookmarks match this queue view.", "当前队列视图下暂无匹配书签。")}</p>
            )}
          </div>
          <button
            className="primary ai-generate-button"
            type="button"
            disabled={
              generating || applying || suggestions.length > 0 || apiKeyConfigured !== true ||
              !selectedIds.size || !provider.model.trim() || !provider.endpoint.trim() || !providerTimeoutValid()
            }
            onClick={() => void generate()}
          >
            {generating
              ? tx("Generating suggestions…", "正在生成建议…")
              : suggestions.length
                ? tx("Review or discard current suggestions first", "请先处理当前预览建议")
                : apiKeyConfigured === false
                  ? tx("Configure Worker AI secret first", "请先配置 Worker AI 密钥")
                  : tx(`Generate suggestions (${selectedIds.size})`, `生成建议 (${selectedIds.size})`)}
          </button>
        </article>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}

      {suggestions.length > 0 && (
        <section className="ai-preview">
          <div className="preview-heading">
            <div>
              <h2>{tx("Review proposed organization", "复核 AI 整理建议")}</h2>
              <p className="ai-preview-subtitle">
                {tx("Preview only — nothing has been written yet.", "仅预览，尚未写入任何更改。")}
              </p>
            </div>
            <div className="preview-actions">
              <button
                className="text-action"
                type="button"
                onClick={() => setAcceptedIds(new Set(suggestions.map((suggestion) => suggestion.bookmarkId)))}
              >
                {tx("Select all", "全选")}
              </button>
              <button className="text-action muted-action" type="button" onClick={() => setAcceptedIds(new Set())}>
                {tx("Clear", "清空")}
              </button>
              <button className="text-action muted-action" type="button" disabled={applying} onClick={discardPreview}>
                {tx("Discard preview", "放弃预览")}
              </button>
              <button className="primary" type="button" disabled={applying || !acceptedIds.size} onClick={() => void applySuggestions()}>
                {applying
                  ? tx("Applying batch…", "正在应用…")
                  : tx(`Apply reviewed (${acceptedIds.size})`, `应用已选 (${acceptedIds.size})`)}
              </button>
            </div>
          </div>
          <div className="ai-preview-list">
            {suggestions.map((suggestion) => {
              const bookmark = bookmarkById.get(suggestion.bookmarkId);
              if (!bookmark) return null;
              const currentCategory = bookmark.categoryId
                ? categoryById.get(bookmark.categoryId) ?? tx("Unknown category", "未知分类")
                : tx("Uncategorized", "未分类");
              const nextCategory = suggestion.categoryName ?? tx("Uncategorized", "未分类");
              const currentTags = bookmarkTags[bookmark.id] ?? [];
              const titleChanged = suggestion.title !== bookmark.title;
              const descriptionChanged = suggestion.description !== (bookmark.description ?? "");
              const categoryChanged = nextCategory !== currentCategory;
              const tagsChanged = !sameTags(suggestion.tags, currentTags);
              const changedLabels = [
                titleChanged && tx("Title", "标题"),
                descriptionChanged && tx("Description", "描述"),
                categoryChanged && tx("Category", "分类"),
                tagsChanged && tx("Tags", "标签"),
              ].filter(Boolean).join(" · ") || tx("No field change", "无字段变动");

              return (
                <article className="ai-suggestion-row" key={suggestion.bookmarkId}>
                  <label className="ai-suggestion-heading">
                    <input
                      type="checkbox"
                      checked={acceptedIds.has(suggestion.bookmarkId)}
                      onChange={() => toggleSuggestion(suggestion.bookmarkId)}
                    />
                    <span><strong>{bookmark.title}</strong><small>{bookmark.url}</small></span>
                    <em>{changedLabels}</em>
                  </label>
                  <div className="ai-field-diffs">
                    <div className={titleChanged ? "is-changed" : ""}>
                      <span>{tx("Title", "标题")}</span>
                      <small>{tx("Current", "当前")}</small><strong>{bookmark.title}</strong>
                      <small>{tx("Suggested", "建议")}</small><strong>{suggestion.title || bookmark.title}</strong>
                    </div>
                    <div className={categoryChanged ? "is-changed" : ""}>
                      <span>{tx("Category", "分类")}</span>
                      <small>{tx("Current", "当前")}</small><strong>{currentCategory}</strong>
                      <small>{tx("Suggested", "建议")}</small><strong>{nextCategory}</strong>
                    </div>
                    <div className={descriptionChanged ? "is-changed" : ""}>
                      <span>{tx("Description", "描述")}</span>
                      <small>{tx("Current", "当前")}</small><strong>{bookmark.description || "—"}</strong>
                      <small>{tx("Suggested", "建议")}</small><strong>{suggestion.description || "—"}</strong>
                    </div>
                    <div className={tagsChanged ? "is-changed" : ""}>
                      <span>{tx("Tags", "标签")}</span>
                      <small>{tx("Current", "当前")}</small><strong>{currentTags.join(", ") || "—"}</strong>
                      <small>{tx("Suggested", "建议")}</small><strong>{suggestion.tags.join(", ") || "—"}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mapping-note">
            {tx(
              "Applying commits reviewed titles, descriptions, categories, and tags in one atomic batch. URLs, health policies, health history, and browser mappings remain untouched.",
              "应用后会以单次原子事务写入确认过的标题、描述、分类与标签；网址、健康策略、健康历史与浏览器映射不受影响。",
            )}
          </p>
        </section>
      )}

      {loadingTags && (
        <p className="settings-footnote">{tx("Loading existing tags and AI secret status…", "正在加载已有标签与 AI 密钥状态…")}</p>
      )}
    </section>
  );
}
