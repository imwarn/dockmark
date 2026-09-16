import { useEffect, useMemo, useState } from "react";
import type { Category } from "@dockmark/core";
import {
  listCategories,
  refreshBookmarkMetadata,
  updateBookmark,
  type BookmarkMetadata,
} from "./api";
import {
  generateAiOrganizationSuggestions,
  getAiProviderStatus,
  loadAiProviderSettings,
  type AiOrganizationSuggestion,
} from "./ai-organization";
import {
  listInbox,
  resolveInboxBookmark,
  reviewInboxBatch,
  type InboxBookmark,
  type InboxReviewPatch,
} from "./inbox-api";
import { listBookmarkTags } from "./tag-api";

type MetadataField = "title" | "description" | "canonicalUrl" | "iconUrl";
type MetadataSelection = Record<MetadataField, boolean>;

function emptyMetadataSelection(): MetadataSelection {
  return {
    title: false,
    description: false,
    canonicalUrl: false,
    iconUrl: false,
  };
}

function hostLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function selectionCount(selection: MetadataSelection | undefined) {
  return selection ? Object.values(selection).filter(Boolean).length : 0;
}

function sameTags(left: string[], right: string[]) {
  const a = left.map((tag) => tag.toLocaleLowerCase()).sort();
  const b = right.map((tag) => tag.toLocaleLowerCase()).sort();
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function InboxPage() {
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
      setError(caught instanceof Error ? caught.message : "Could not load Inbox.");
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
    void refresh();
    void refreshAiStatus();
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
      setNotice(`Metadata refreshed for “${bookmark.title}”. Nothing was applied automatically.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not fetch bookmark metadata.");
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
          throw new Error("The suggested metadata title is longer than Dockmark's 200-character bookmark title limit.");
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
      const categoryName = categoryId ? categoryById.get(categoryId) ?? "selected category" : "Uncategorized";
      const applied = Object.keys(input).length;
      setNotice(
        applied
          ? `Reviewed “${bookmark.title}” with ${applied} metadata suggestion${applied === 1 ? "" : "s"} → ${categoryName}.`
          : `Reviewed “${bookmark.title}” → ${categoryName}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not review Inbox bookmark.");
    } finally {
      setBusyId(null);
    }
  }

  function nextAiIds(progress = aiGeneratedIds, source = bookmarks) {
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
    if (bookmark.healthPolicy !== "normal" || selectionCount(metadataSelections[bookmark.id]) > 0 || aiSuggestions.length) return;
    setAiSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(bookmark.id)) next.delete(bookmark.id);
      else if (next.size < 20) next.add(bookmark.id);
      return next;
    });
  }

  async function generateAiTriage() {
    if (aiSuggestions.length) {
      setError("Apply or discard the current Inbox AI preview before generating another batch.");
      return;
    }
    const selected = bookmarks.filter((bookmark) => aiSelectedIds.has(bookmark.id) && bookmark.healthPolicy === "normal");
    if (!selected.length) return;
    setAiGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const provider = loadAiProviderSettings();
      const next = await generateAiOrganizationSuggestions(provider, selected.map((bookmark) => bookmark.id));
      const generatedAfter = new Set(aiGeneratedIds);
      next.forEach((suggestion) => generatedAfter.add(suggestion.bookmarkId));
      setAiGeneratedIds(generatedAfter);
      setAiSuggestions(next);
      setAiAcceptedIds(new Set(next.map((suggestion) => suggestion.bookmarkId)));
      const nextBatch = nextAiIds(generatedAfter);
      setAiSelectedIds(new Set(nextBatch));
      setNotice(
        `Generated ${next.length} reviewed Inbox suggestion${next.length === 1 ? "" : "s"}. ` +
        `${nextBatch.length} next pending item${nextBatch.length === 1 ? " is" : "s are"} queued; nothing has been filed yet.`,
      );
    } catch (caught) {
      setError(messageFrom(caught));
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
    setNotice("Inbox AI preview discarded. Generated markers and queued selection were kept; no bookmark data changed.");
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
          throw new Error("One or more Inbox bookmarks changed eligibility. Refresh and regenerate before filing.");
        }
        const categoryId = suggestion.categoryName
          ? categoryByName.get(suggestion.categoryName.toLocaleLowerCase())
          : null;
        if (suggestion.categoryName && !categoryId) {
          throw new Error(`Suggested category “${suggestion.categoryName}” no longer exists. Refresh and regenerate before filing.`);
        }
        return {
          bookmarkId: bookmark.id,
          title: suggestion.title || bookmark.title,
          description: suggestion.description || null,
          categoryId,
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
        `Applied and filed ${result.applied} reviewed Inbox AI suggestion${result.applied === 1 ? "" : "s"} in one atomic D1 batch. ` +
        "URL, favicon, HealthPolicy and HealthStatus were untouched.",
      );
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setAiApplying(false);
    }
  }

  return (
    <main className="inbox-shell">
      <section className="inbox-hero">
        <div>
          <p className="eyebrow">QUICK CAPTURE</p>
          <h1>Inbox</h1>
          <p>Tabs saved from the Dockmark extension land here as a review state, not as a special category. Public pages can optionally fetch metadata suggestions, or you can run reviewed AI triage across up to 20 Inbox items before filing.</p>
        </div>
        <div className="inbox-count" aria-label={`${bookmarks.length} Inbox bookmarks`}>
          <strong>{bookmarks.length}</strong>
          <span>waiting</span>
        </div>
      </section>

      {(notice || error) && <div className={`inbox-notice ${error ? "error" : "success"}`}>{error ?? notice}</div>}

      <section className="inbox-ai-panel" aria-label="AI-assisted Inbox triage">
        <div className="inbox-ai-heading">
          <div>
            <p className="eyebrow">AI TRIAGE · REVIEWED</p>
            <h2>Organize a capture batch, then file it once.</h2>
            <p>Uses the same browser-local provider/model/timeout from Settings. Only <code>normal</code> Inbox bookmarks are eligible. AI can suggest title, description, an existing category and tags; URL, favicon and health fields stay outside this batch write surface.</p>
          </div>
          <div className="inbox-ai-summary">
            <strong>{aiSelectedIds.size}/20 selected</strong>
            <span>{generatedInInbox} generated this session · {aiPending.length} pending</span>
          </div>
        </div>
        <div className="inbox-ai-actions">
          <button className="secondary" type="button" disabled={loading || aiGenerating || aiApplying || aiSuggestions.length > 0 || !aiPending.length} onClick={selectNextAi}>Select next {Math.min(20, aiPending.length)}</button>
          <button className="text-action" type="button" disabled={!aiSelectedIds.size || aiGenerating || aiApplying || aiSuggestions.length > 0} onClick={() => setAiSelectedIds(new Set())}>Clear selection</button>
          <button className="primary" type="button" disabled={aiApiReady !== true || !aiSelectedIds.size || aiGenerating || aiApplying || aiSuggestions.length > 0} onClick={() => void generateAiTriage()}>
            {aiGenerating ? "Generating…" : aiSuggestions.length ? "Review current preview first" : `Generate Inbox suggestions ${aiSelectedIds.size}`}
          </button>
          {aiApiReady === false && <a className="text-action" href="/app/settings">Configure AI provider →</a>}
          {aiApiReady === null && <button className="text-action" type="button" onClick={() => void refreshAiStatus()}>Refresh AI status</button>}
        </div>
        <p className="inbox-ai-note">Items with page-metadata fields already selected are excluded from AI selection so the two reviewed filing paths cannot silently override each other.</p>

        {aiSuggestions.length > 0 && (
          <div className="inbox-ai-preview">
            <div className="inbox-ai-preview-heading">
              <div><strong>AI preview · nothing filed yet</strong><span>Accept whole reviewed suggestions. Unchecked rows remain in Inbox.</span></div>
              <div>
                <button className="text-action" type="button" onClick={() => setAiAcceptedIds(new Set(aiSuggestions.map((suggestion) => suggestion.bookmarkId)))}>Select all</button>
                <button className="text-action" type="button" onClick={() => setAiAcceptedIds(new Set())}>Clear</button>
                <button className="text-action" type="button" disabled={aiApplying} onClick={discardAiPreview}>Discard preview</button>
                <button className="primary" type="button" disabled={aiApplying || !aiAcceptedIds.size} onClick={() => void applyAiTriage()}>{aiApplying ? "Applying & filing…" : `Apply & file ${aiAcceptedIds.size}`}</button>
              </div>
            </div>
            <div className="inbox-ai-preview-list">
              {aiSuggestions.map((suggestion) => {
                const bookmark = bookmarkById.get(suggestion.bookmarkId);
                if (!bookmark) return null;
                const currentCategory = bookmark.categoryId ? categoryById.get(bookmark.categoryId) ?? "Unknown category" : "Uncategorized";
                const nextCategory = suggestion.categoryName ?? "Uncategorized";
                const currentTags = bookmarkTags[bookmark.id] ?? [];
                const changes = [
                  suggestion.title !== bookmark.title && "TITLE",
                  suggestion.description !== (bookmark.description ?? "") && "DESCRIPTION",
                  nextCategory !== currentCategory && "CATEGORY",
                  !sameTags(suggestion.tags, currentTags) && "TAGS",
                ].filter(Boolean);
                return (
                  <label className="inbox-ai-suggestion" key={suggestion.bookmarkId}>
                    <input type="checkbox" checked={aiAcceptedIds.has(suggestion.bookmarkId)} onChange={() => toggleAiSuggestion(suggestion.bookmarkId)} />
                    <span>
                      <strong>{suggestion.title || bookmark.title}</strong>
                      <small>{nextCategory} · {suggestion.tags.length ? suggestion.tags.map((tag) => `#${tag}`).join(" ") : "no tags"}</small>
                      <small>{suggestion.description || "No suggested description"}</small>
                    </span>
                    <em>{changes.join(" · ") || "NO FIELD CHANGE"}</em>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="inbox-panel">
        <div className="inbox-panel-heading">
          <div><strong>Captured bookmarks</strong><span>Exact URL duplicates are rejected before a second bookmark is created. Metadata stays behind the same review gate.</span></div>
          <button className="secondary" type="button" disabled={loading || busyId !== null || metadataBusyId !== null || aiGenerating || aiApplying} onClick={() => void refresh()}>Refresh</button>
        </div>

        {loading ? (
          <div className="inbox-empty">Loading Inbox…</div>
        ) : bookmarks.length ? (
          <div className="inbox-list">
            {bookmarks.map((bookmark) => {
              const metadata = metadataById[bookmark.id] ?? null;
              const selection = metadataSelections[bookmark.id] ?? emptyMetadataSelection();
              const selectedMetadataCount = selectionCount(selection);
              const metadataBusy = metadataBusyId === bookmark.id;
              const titleAvailable = Boolean(metadata?.title && metadata.title !== bookmark.title && metadata.title.length <= 200);
              const descriptionAvailable = Boolean(metadata?.description && metadata.description !== bookmark.description);
              const canonicalAvailable = Boolean(metadata?.canonicalUrl && metadata.canonicalUrl !== bookmark.url);
              const iconAvailable = Boolean(metadata?.iconUrl && metadata.iconUrl !== bookmark.iconUrl);
              const aiSelectable = bookmark.healthPolicy === "normal" && !selectedMetadataCount && !aiSuggestions.length;

              return (
                <article className="inbox-row" key={bookmark.id}>
                  <div className="inbox-copy">
                    <div className="inbox-title-line">
                      <label className={`inbox-ai-select${aiSelectable ? "" : " disabled"}`} title={selectedMetadataCount ? "Clear selected metadata fields before adding this item to AI triage." : bookmark.healthPolicy !== "normal" ? `AI excludes HealthPolicy=${bookmark.healthPolicy}.` : "Select for reviewed Inbox AI triage."}>
                        <input
                          type="checkbox"
                          checked={aiSelectedIds.has(bookmark.id)}
                          disabled={!aiSelectable || (!aiSelectedIds.has(bookmark.id) && aiSelectedIds.size >= 20)}
                          onChange={() => toggleAiBookmark(bookmark)}
                          aria-label={`Select ${bookmark.title} for AI triage`}
                        />
                        <span>AI</span>
                      </label>
                      <a href={bookmark.url} target="_blank" rel="noreferrer">{bookmark.title}</a>
                      <span>{bookmark.healthPolicy === "local-only" ? "Local only" : "Captured"}</span>
                    </div>
                    <div className="inbox-meta">
                      <span>{hostLabel(bookmark.url)}</span>
                      <span>Captured {dateLabel(bookmark.inboxAt)}</span>
                      {bookmark.categoryId && <span>Currently {bookmark.categoryName ?? categoryById.get(bookmark.categoryId) ?? "categorized"}</span>}
                      {(bookmarkTags[bookmark.id] ?? []).slice(0, 4).map((tag) => <span key={tag.toLocaleLowerCase()}>#{tag}</span>)}
                    </div>
                    {bookmark.description && <p>{bookmark.description}</p>}
                  </div>

                  <div className="inbox-review">
                    <label>
                      <span>File to</span>
                      <select
                        value={categoryDrafts[bookmark.id] ?? bookmark.categoryId ?? ""}
                        disabled={busyId === bookmark.id || aiApplying}
                        onChange={(event) => setCategoryDrafts((current) => ({ ...current, [bookmark.id]: event.target.value }))}
                      >
                        <option value="">Uncategorized</option>
                        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select>
                    </label>
                    <button className="primary" type="button" disabled={busyId !== null || metadataBusyId !== null || aiApplying} onClick={() => void review(bookmark)}>
                      {busyId === bookmark.id
                        ? "Filing…"
                        : selectedMetadataCount
                          ? `Apply ${selectedMetadataCount} + file`
                          : "Review & file"}
                    </button>
                  </div>

                  <section className="inbox-metadata-review" aria-label={`Metadata suggestions for ${bookmark.title}`}>
                    <div className="inbox-metadata-heading">
                      <div>
                        <strong>Page metadata suggestions</strong>
                        <span>
                          {bookmark.healthPolicy === "local-only"
                            ? "Local/private metadata stays disabled on the server."
                            : "Fetch is read-only for the bookmark. Select individual fields to apply only when you file this Inbox item."}
                        </span>
                      </div>
                      <button
                        className="secondary"
                        type="button"
                        disabled={busyId !== null || metadataBusyId !== null || aiGenerating || aiApplying || bookmark.healthPolicy === "local-only" || aiSuggestions.some((suggestion) => suggestion.bookmarkId === bookmark.id)}
                        onClick={() => void fetchMetadata(bookmark)}
                      >
                        {bookmark.healthPolicy === "local-only"
                          ? "Server metadata disabled"
                          : metadataBusy
                            ? "Fetching…"
                            : metadata
                              ? "Refresh metadata"
                              : "Fetch metadata"}
                      </button>
                    </div>

                    {metadata && (
                      <div className="inbox-metadata-fields">
                        <label className={`inbox-metadata-field${titleAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.title && titleAvailable} disabled={!titleAvailable || busyId !== null || aiSuggestions.some((suggestion) => suggestion.bookmarkId === bookmark.id)} onChange={() => toggleMetadata(bookmark.id, "title")} />
                          <span><small>Title</small><strong>{metadata.title ?? "Not provided"}</strong></span>
                          <em>{metadata.title && metadata.title.length > 200 ? "Too long to apply" : titleAvailable ? "Apply on file" : "Already matches / unavailable"}</em>
                        </label>
                        <label className={`inbox-metadata-field${descriptionAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.description && descriptionAvailable} disabled={!descriptionAvailable || busyId !== null || aiSuggestions.some((suggestion) => suggestion.bookmarkId === bookmark.id)} onChange={() => toggleMetadata(bookmark.id, "description")} />
                          <span><small>Description</small><strong>{metadata.description ?? "Not provided"}</strong></span>
                          <em>{descriptionAvailable ? "Apply on file" : "Already matches / unavailable"}</em>
                        </label>
                        <label className={`inbox-metadata-field${canonicalAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.canonicalUrl && canonicalAvailable} disabled={!canonicalAvailable || busyId !== null || aiSuggestions.some((suggestion) => suggestion.bookmarkId === bookmark.id)} onChange={() => toggleMetadata(bookmark.id, "canonicalUrl")} />
                          <span><small>Canonical URL</small><strong>{metadata.canonicalUrl ?? "Not provided"}</strong></span>
                          <em>{canonicalAvailable ? "Replace URL on file" : "Already matches / unavailable"}</em>
                        </label>
                        <label className={`inbox-metadata-field${iconAvailable ? " available" : ""}`}>
                          <input type="checkbox" checked={selection.iconUrl && iconAvailable} disabled={!iconAvailable || busyId !== null || aiSuggestions.some((suggestion) => suggestion.bookmarkId === bookmark.id)} onChange={() => toggleMetadata(bookmark.id, "iconUrl")} />
                          <span><small>Favicon</small><strong>{metadata.iconUrl ?? "Not provided"}</strong></span>
                          <em>{iconAvailable ? "Apply on file" : "Already matches / unavailable"}</em>
                        </label>
                        {metadata.finalUrl && metadata.finalUrl !== bookmark.url && (
                          <div className="inbox-metadata-info">
                            <span><small>Resolved URL</small><strong>{metadata.finalUrl}</strong></span>
                            <em>Informational only · redirects are not treated as canonical</em>
                          </div>
                        )}
                        <div className="inbox-metadata-footnote">Fetched {dateLabel(metadata.fetchedAt)} · suggestions remain separate until Review &amp; file.</div>
                      </div>
                    )}
                  </section>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="inbox-empty">
            <strong>Inbox is clear.</strong>
            <span>Use the paired Dockmark extension → Save current tab or Reviewed multi-tab capture to collect the next pages.</span>
          </div>
        )}
      </section>
    </main>
  );
}
