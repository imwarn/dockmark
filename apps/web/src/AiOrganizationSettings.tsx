import { useEffect, useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
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
import { listBookmarkTags } from "./tag-api";
import "./ai-organization.css";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
}

type QueueFilter = "pending" | "generated" | "all";

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function sameTags(left: string[], right: string[]) {
  const a = left.map((tag) => tag.toLocaleLowerCase()).sort();
  const b = right.map((tag) => tag.toLocaleLowerCase()).sort();
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

export function AiOrganizationSettings({ bookmarks, categories, onChanged }: Props) {
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
        if (!cancelled) setError(messageFrom(caught));
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
      setError(`Provider timeout must be between ${MIN_AI_TIMEOUT_SECONDS} and ${MAX_AI_TIMEOUT_SECONDS} seconds.`);
      return;
    }
    saveAiProviderSettings(provider);
    setMessage("Provider endpoint, model and timeout saved in this browser. The API key stays in the Worker secret store.");
  }

  async function refreshKeyStatus() {
    setError(null);
    try {
      const status = await getAiProviderStatus();
      setApiKeyConfigured(status.apiKeyConfigured);
      setMessage(status.apiKeyConfigured ? "Worker AI secret is configured." : "Worker AI secret is still missing.");
    } catch (caught) {
      setError(messageFrom(caught));
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
    setMessage("AI generation progress reset for this page session. No bookmark data was changed.");
    setError(null);
  }

  function discardPreview() {
    setSuggestions([]);
    setAcceptedIds(new Set());
    setMessage("Current AI preview discarded. Generated markers and the next queue selection were kept.");
    setError(null);
  }

  async function generate() {
    if (suggestions.length) {
      setError("Review, apply, or discard the current AI preview before generating another batch.");
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
      const next = await generateAiOrganizationSuggestions(provider, selected.map((bookmark) => bookmark.id));
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
          ? `Generated ${next.length} suggestions. ${remainingAfter} eligible bookmark${remainingAfter === 1 ? "" : "s"} remain; ${nextBatch.length} next queued for selection. Review the current preview before generating again.`
          : `Generated ${next.length} of ${selected.length} requested suggestions. Missing rows remain pending and can be retried; ${nextBatch.length} bookmarks are queued next.`,
      );
    } catch (caught) {
      setError(messageFrom(caught));
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
            throw new Error(`Suggested category “${suggestion.categoryName}” no longer exists. Refresh and regenerate before applying.`);
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
        setMessage(`No reviewed AI patches were applied${skipped ? `; ${skipped} bookmarks are no longer AI-eligible` : ""}.`);
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
      setMessage(
        `Applied ${result.applied} reviewed AI suggestion${result.applied === 1 ? "" : "s"} in one atomic batch` +
        `${skipped ? `; ${skipped} skipped because the bookmark is no longer AI-eligible` : ""}. URLs and HealthPolicy were untouched.`,
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setApplying(false);
    }
  }

  return (
    <section className="browser-settings-section ai-organization-section">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">AI-ASSISTED ORGANIZATION</p>
          <h2>Suggest first.<br />Apply only after review.</h2>
          <p>Classify bookmarks into existing categories, clean titles, draft descriptions and suggest tags. Dockmark never sends a bookmark until you explicitly select it and click Generate, and it never applies a suggestion until you review the diff.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{apiKeyConfigured === null ? "Checking AI secret" : apiKeyConfigured ? "Worker secret ready" : "Worker secret required"}</strong>
          <span>Max 20 bookmarks / request</span>
        </div>
      </div>

      <div className="settings-grid">
        <article className="form-card settings-card ai-provider-card">
          <div className="card-heading">
            <div><h3>OpenAI-compatible provider</h3><p>Endpoint, model and timeout are browser-local preferences. The API key is never stored in Web localStorage or D1; the Worker reads it from <code>DOCKMARK_AI_API_KEY</code>.</p></div>
          </div>
          <label className="settings-field">
            <span>Chat completions endpoint</span>
            <input value={provider.endpoint} onChange={(event) => setProvider({ ...provider, endpoint: event.target.value })} placeholder="https://api.example.com/v1/chat/completions" inputMode="url" />
          </label>
          <label className="settings-field">
            <span>Model</span>
            <input value={provider.model} onChange={(event) => setProvider({ ...provider, model: event.target.value })} placeholder="Provider model id" autoComplete="off" />
          </label>
          <label className="settings-field">
            <span>Provider timeout · seconds</span>
            <input
              type="number"
              min={MIN_AI_TIMEOUT_SECONDS}
              max={MAX_AI_TIMEOUT_SECONDS}
              step={5}
              value={provider.timeoutSeconds}
              onChange={(event) => setProvider({ ...provider, timeoutSeconds: Number(event.target.value) })}
            />
            <small className="field-help">Default 90 seconds · allowed {MIN_AI_TIMEOUT_SECONDS}–{MAX_AI_TIMEOUT_SECONDS}. Slower self-hosted models can use a longer request window.</small>
          </label>
          <div className="ai-provider-actions">
            <button className="secondary" type="button" onClick={saveProvider}>Save provider locally</button>
            <button className="text-action" type="button" onClick={() => void refreshKeyStatus()}>Refresh secret status</button>
          </div>
          <p className="settings-footnote">
            Configure the secret in your self-hosted Worker with <code>npx wrangler secret put DOCKMARK_AI_API_KEY</code> or the Cloudflare dashboard. The provider endpoint must be public HTTPS. Selected bookmark content is loaded by the Worker and sent only after Generate; the key never enters the page.
          </p>
        </article>

        <article className="form-card settings-card ai-selection-card">
          <div className="card-heading">
            <div><h3>Select bookmarks</h3><p>Generation progress is tracked only for this page session. Generated rows can be filtered out while the next ungenerated batch is queued automatically.</p></div>
            <span>{selectedIds.size}/20</span>
          </div>
          <input className="ai-bookmark-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter title or URL…" aria-label="Filter bookmarks for AI organization" />
          <div className="ai-queue-summary">
            <div className="ai-queue-filters" role="group" aria-label="AI generation queue filter">
              <button className={queueFilter === "pending" ? "active" : ""} type="button" onClick={() => setQueueFilter("pending")}>Pending {remainingCount}</button>
              <button className={queueFilter === "generated" ? "active" : ""} type="button" onClick={() => setQueueFilter("generated")}>Generated {generatedCount}</button>
              <button className={queueFilter === "all" ? "active" : ""} type="button" onClick={() => setQueueFilter("all")}>All {bookmarks.length}</button>
            </div>
            <span>{generatedCount} generated this session · {remainingCount} eligible remaining</span>
          </div>
          <div className="ai-selection-actions">
            <button className="text-action" type="button" onClick={selectVisible} disabled={!eligible.length}>Select first {Math.min(20, eligible.length)} visible</button>
            <button className="text-action" type="button" onClick={selectNextPending} disabled={!remainingCount}>Select next pending</button>
            <button className="text-action muted-action" type="button" onClick={clearSelection} disabled={!selectedIds.size}>Clear</button>
            <button className="text-action muted-action" type="button" onClick={resetSessionProgress} disabled={!generatedIds.size || suggestions.length > 0}>Reset progress</button>
          </div>
          {selectedGeneratedCount > 0 && (
            <p className="ai-selection-warning">{selectedGeneratedCount} selected bookmark{selectedGeneratedCount === 1 ? " was" : "s were"} already generated in this session. Generate will intentionally refresh those suggestions.</p>
          )}
          <div className="ai-bookmark-list">
            {filteredBookmarks.slice(0, 120).map((bookmark) => {
              const protectedPolicy = bookmark.healthPolicy !== "normal";
              const generated = generatedIds.has(bookmark.id);
              const category = categoryById.get(bookmark.categoryId ?? "") ?? "UNCATEGORIZED";
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
                  <em>{protectedPolicy ? bookmark.healthPolicy.toUpperCase() : generated ? `GENERATED · ${category}` : category}</em>
                </label>
              );
            })}
            {!filteredBookmarks.length && <p className="ai-queue-empty">No bookmarks match this queue view.</p>}
          </div>
          <button className="primary ai-generate-button" type="button" disabled={generating || applying || suggestions.length > 0 || apiKeyConfigured !== true || !selectedIds.size || !provider.model.trim() || !provider.endpoint.trim() || !providerTimeoutValid()} onClick={() => void generate()}>
            {generating
              ? "Generating suggestions…"
              : suggestions.length
                ? "Review or discard current suggestions first"
                : apiKeyConfigured === false
                  ? "Configure Worker AI secret first"
                  : `Generate suggestions ${selectedIds.size}`}
          </button>
        </article>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}

      {suggestions.length > 0 && (
        <section className="ai-preview">
          <div className="preview-heading">
            <div><p className="eyebrow">AI PREVIEW · NOTHING APPLIED YET</p><h2>Review proposed organization</h2></div>
            <div className="preview-actions">
              <button className="text-action" type="button" onClick={() => setAcceptedIds(new Set(suggestions.map((suggestion) => suggestion.bookmarkId)))}>Select all</button>
              <button className="text-action muted-action" type="button" onClick={() => setAcceptedIds(new Set())}>Clear</button>
              <button className="text-action muted-action" type="button" disabled={applying} onClick={discardPreview}>Discard preview</button>
              <button className="primary" type="button" disabled={applying || !acceptedIds.size} onClick={() => void applySuggestions()}>
                {applying ? "Applying batch…" : `Apply reviewed ${acceptedIds.size}`}
              </button>
            </div>
          </div>
          <div className="ai-preview-list">
            {suggestions.map((suggestion) => {
              const bookmark = bookmarkById.get(suggestion.bookmarkId);
              if (!bookmark) return null;
              const currentCategory = bookmark.categoryId ? categoryById.get(bookmark.categoryId) ?? "Unknown category" : "Uncategorized";
              const nextCategory = suggestion.categoryName ?? "Uncategorized";
              const currentTags = bookmarkTags[bookmark.id] ?? [];
              const titleChanged = suggestion.title !== bookmark.title;
              const descriptionChanged = suggestion.description !== (bookmark.description ?? "");
              const categoryChanged = nextCategory !== currentCategory;
              const tagsChanged = !sameTags(suggestion.tags, currentTags);
              return (
                <article className="ai-suggestion-row" key={suggestion.bookmarkId}>
                  <label className="ai-suggestion-heading">
                    <input type="checkbox" checked={acceptedIds.has(suggestion.bookmarkId)} onChange={() => toggleSuggestion(suggestion.bookmarkId)} />
                    <span><strong>{bookmark.title}</strong><small>{bookmark.url}</small></span>
                    <em>{[titleChanged && "TITLE", descriptionChanged && "DESCRIPTION", categoryChanged && "CATEGORY", tagsChanged && "TAGS"].filter(Boolean).join(" · ") || "NO FIELD CHANGE"}</em>
                  </label>
                  <div className="ai-field-diffs">
                    <div className={titleChanged ? "is-changed" : ""}><span>Title</span><small>Current</small><strong>{bookmark.title}</strong><small>Suggested</small><strong>{suggestion.title || bookmark.title}</strong></div>
                    <div className={categoryChanged ? "is-changed" : ""}><span>Category</span><small>Current</small><strong>{currentCategory}</strong><small>Suggested</small><strong>{nextCategory}</strong></div>
                    <div className={descriptionChanged ? "is-changed" : ""}><span>Description</span><small>Current</small><strong>{bookmark.description || "—"}</strong><small>Suggested</small><strong>{suggestion.description || "—"}</strong></div>
                    <div className={tagsChanged ? "is-changed" : ""}><span>Tags</span><small>Current</small><strong>{currentTags.join(", ") || "—"}</strong><small>Suggested</small><strong>{suggestion.tags.join(", ") || "—"}</strong></div>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mapping-note">Apply sends the reviewed title, description, category and tags once and commits them as one D1 batch. URL, HealthPolicy, HealthStatus, browser mappings and health history remain outside the AI write surface.</p>
        </section>
      )}

      {loadingTags && <p className="settings-footnote">Loading existing tags and AI secret status…</p>}
    </section>
  );
}
