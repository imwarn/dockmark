import { useEffect, useMemo, useState } from "react";
import type { Bookmark, HealthCheck, HealthStatus } from "@dockmark/core";
import {
  checkBookmarkHealth,
  deleteBookmark,
  getBookmarkMetadata,
  listBookmarkHealthChecks,
  refreshBookmarkMetadata,
  updateBookmark,
  type BookmarkMetadata,
} from "./api";
import {
  checkLocalHealthWithBridge,
  getBridgeStatus,
  onBridgeEvent,
} from "./browser-bridge";
import { recordLocalBookmarkHealthResult } from "./local-health-api";
import "./maintenance.css";

interface Props {
  bookmarks: Bookmark[];
  onChanged: () => Promise<void>;
}

const healthLabels: Record<HealthStatus, string> = {
  unknown: "Unchecked",
  healthy: "Healthy",
  redirected: "Redirected",
  "auth-required": "Auth required",
  forbidden: "Forbidden",
  "rate-limited": "Rate limited",
  timeout: "Timeout",
  "dns-error": "DNS error",
  "tls-error": "TLS error",
  unavailable: "Unavailable",
  "local-only": "Local only",
  ignored: "Ignored",
};

const cleanupStatuses = new Set<HealthStatus>(["dns-error", "tls-error", "unavailable"]);

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function BookmarkMaintenance({ bookmarks, onChanged }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(() => bookmarks[0]?.id ?? null);
  const [metadata, setMetadata] = useState<BookmarkMetadata | null>(null);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupSelection, setCleanupSelection] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === selectedId) ?? null,
    [bookmarks, selectedId],
  );

  const cleanupCandidates = useMemo(
    () => bookmarks.filter((bookmark) => bookmark.healthPolicy === "normal" && cleanupStatuses.has(bookmark.healthStatus)),
    [bookmarks],
  );

  useEffect(() => {
    if (!bookmarks.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !bookmarks.some((bookmark) => bookmark.id === selectedId)) {
      setSelectedId(bookmarks[0]?.id ?? null);
    }
  }, [bookmarks, selectedId]);

  useEffect(() => {
    const allowed = new Set(cleanupCandidates.map((bookmark) => bookmark.id));
    setCleanupSelection((current) => new Set([...current].filter((id) => allowed.has(id))));
  }, [cleanupCandidates]);

  useEffect(() => onBridgeEvent((event) => {
    if (event === "local-health-permission-updated") {
      setError(null);
      setNotice("Local host access granted. Run Check locally again to record the result.");
    }
  }), []);

  useEffect(() => {
    if (!selectedId) {
      setMetadata(null);
      setChecks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([getBookmarkMetadata(selectedId), listBookmarkHealthChecks(selectedId)])
      .then(([nextMetadata, nextChecks]) => {
        if (cancelled) return;
        setMetadata(nextMetadata);
        setChecks(nextChecks);
      })
      .catch((caught) => {
        if (!cancelled) setError(messageFrom(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function fetchMetadata() {
    if (!selected || selected.healthPolicy === "local-only") return;
    setMetadataBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await refreshBookmarkMetadata(selected.id);
      setMetadata(next);
      setNotice("Metadata refreshed. Nothing was applied automatically.");
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setMetadataBusy(false);
    }
  }

  async function runHealthCheck() {
    if (!selected || selected.healthPolicy === "ignore" || selected.healthPolicy === "local-only") return;
    setHealthBusy(true);
    setError(null);
    setNotice(null);
    try {
      const check = await checkBookmarkHealth(selected.id);
      const history = await listBookmarkHealthChecks(selected.id);
      setChecks(history);
      setNotice(`Server health check: ${healthLabels[check.status]}.`);
      await onChanged();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setHealthBusy(false);
    }
  }

  async function runLocalHealthCheck() {
    if (!selected || selected.healthPolicy !== "local-only") return;
    setHealthBusy(true);
    setError(null);
    setNotice(null);
    try {
      const bridge = await getBridgeStatus();
      if (!bridge.capabilities.localHealth) {
        throw new Error("This Dockmark browser extension does not support local health checks. Update it to v0.9.0 or later.");
      }

      const result = await checkLocalHealthWithBridge(selected.url);
      if (result.kind === "permission-required") {
        setNotice(`Browser host access is required for ${result.pattern}. Approve the permission in the extension tab, then run Check locally again.`);
        return;
      }

      const check = await recordLocalBookmarkHealthResult(selected.id, {
        status: result.status,
        ...(result.httpStatus === undefined ? {} : { httpStatus: result.httpStatus }),
        ...(result.finalUrl === undefined ? {} : { finalUrl: result.finalUrl }),
        responseMs: result.responseMs,
        ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
      });
      const history = await listBookmarkHealthChecks(selected.id);
      setChecks(history);
      await onChanged();
      setNotice(`Browser health check: ${healthLabels[check.status]}.`);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setHealthBusy(false);
    }
  }

  async function applyUpdate(input: Parameters<typeof updateBookmark>[1], success: string, clearsMetadata = false) {
    if (!selected) return;
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      await updateBookmark(selected.id, input);
      if (clearsMetadata) setMetadata(null);
      await onChanged();
      setNotice(success);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setApplying(false);
    }
  }

  function toggleCleanup(id: string) {
    setCleanupSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteCleanupSelection() {
    const ids = [...cleanupSelection];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} reviewed broken bookmark${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;

    setCleanupBusy(true);
    setError(null);
    setNotice(null);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteBookmark(id)));
      const deleted = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - deleted;
      setCleanupSelection(new Set());
      await onChanged();
      setNotice(`Deleted ${deleted} reviewed bookmark${deleted === 1 ? "" : "s"}${failed ? `; ${failed} could not be deleted` : ""}.`);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setCleanupBusy(false);
    }
  }

  const latest = checks[0] ?? null;
  const redirectedUrl = latest?.status === "redirected" && latest.finalUrl && latest.finalUrl !== selected?.url
    ? latest.finalUrl
    : null;
  const metadataTitle = metadata?.title ?? null;
  const metadataDescription = metadata?.description ?? null;
  const metadataCanonicalUrl = metadata?.canonicalUrl ?? null;
  const metadataIconUrl = metadata?.iconUrl ?? null;
  const allCleanupSelected = cleanupCandidates.length > 0 && cleanupSelection.size === cleanupCandidates.length;

  return (
    <section className="maintenance-section">
      <div className="settings-heading maintenance-heading">
        <div>
          <p className="eyebrow">METADATA & HEALTH</p>
          <h2>Inspect before you apply.</h2>
          <p>Fetch page metadata, review redirect targets and keep a compact health history. Dockmark never replaces your title or URL automatically.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{bookmarks.length} bookmarks</strong>
          <span>Manual review gate</span>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner maintenance-feedback" role="status">{notice}</div>}

      <div className="maintenance-grid">
        <div className="maintenance-list panel">
          {bookmarks.map((bookmark) => (
            <button
              type="button"
              className={`maintenance-list-item${bookmark.id === selectedId ? " active" : ""}`}
              key={bookmark.id}
              onClick={() => setSelectedId(bookmark.id)}
            >
              <span>
                <strong>{bookmark.title}</strong>
                <small>{bookmark.url}</small>
              </span>
              <em className={`maintenance-health status-${bookmark.healthStatus}`}>{healthLabels[bookmark.healthStatus]}</em>
            </button>
          ))}
          {!bookmarks.length && <div className="empty-state"><strong>No bookmarks yet.</strong><span>Add a bookmark before running metadata or health maintenance.</span></div>}
        </div>

        <div className="maintenance-inspector">
          {!selected ? (
            <div className="panel maintenance-empty">Select a bookmark to inspect.</div>
          ) : (
            <>
              <article className="panel maintenance-card">
                <div className="maintenance-card-heading">
                  <div>
                    <span className="eyebrow">SELECTED BOOKMARK</span>
                    <h3>{selected.title}</h3>
                    <a href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a>
                  </div>
                  <span className={`health-badge status-${selected.healthStatus}`}>{healthLabels[selected.healthStatus]}</span>
                </div>
              </article>

              <article className="panel maintenance-card">
                <div className="maintenance-card-heading">
                  <div>
                    <h3>Page metadata</h3>
                    <p>
                      {selected.healthPolicy === "local-only"
                        ? "Local/private page metadata is never fetched by the Worker. Local health checks stay in the browser extension instead."
                        : "Server fetches are limited to public HTTP(S) pages, follow at most five redirects and read at most 512 KiB of HTML."}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={metadataBusy || loading || selected.healthPolicy === "local-only"}
                    onClick={() => void fetchMetadata()}
                  >
                    {selected.healthPolicy === "local-only" ? "Server metadata disabled" : metadataBusy ? "Fetching…" : metadata ? "Refresh metadata" : "Fetch metadata"}
                  </button>
                </div>

                {loading ? <p className="maintenance-muted">Loading…</p> : metadata ? (
                  <div className="metadata-fields">
                    <div className="metadata-row">
                      <span><small>Title</small><strong>{metadataTitle ?? "Not provided"}</strong></span>
                      {metadataTitle && metadataTitle !== selected.title && <button className="text-action" disabled={applying} onClick={() => void applyUpdate({ title: metadataTitle }, "Metadata title applied.")}>Use title</button>}
                    </div>
                    <div className="metadata-row">
                      <span><small>Description</small><strong>{metadataDescription ?? "Not provided"}</strong></span>
                      {metadataDescription && metadataDescription !== selected.description && <button className="text-action" disabled={applying} onClick={() => void applyUpdate({ description: metadataDescription }, "Metadata description applied.")}>Use description</button>}
                    </div>
                    <div className="metadata-row">
                      <span><small>Canonical URL</small><strong>{metadataCanonicalUrl ?? "Not provided"}</strong></span>
                      {metadataCanonicalUrl && metadataCanonicalUrl !== selected.url && <button className="text-action" disabled={applying} onClick={() => void applyUpdate({ url: metadataCanonicalUrl }, "Canonical URL applied. Fetch metadata again for the new URL.", true)}>Use canonical</button>}
                    </div>
                    <div className="metadata-row">
                      <span><small>Icon</small><strong>{metadataIconUrl ?? "Not provided"}</strong></span>
                      {metadataIconUrl && metadataIconUrl !== selected.iconUrl && <button className="text-action" disabled={applying} onClick={() => void applyUpdate({ iconUrl: metadataIconUrl }, "Metadata icon applied.")}>Use icon</button>}
                    </div>
                    {metadata.imageUrl && <div className="metadata-row"><span><small>Open Graph image</small><strong>{metadata.imageUrl}</strong></span></div>}
                    {metadata.finalUrl && <div className="metadata-row"><span><small>Resolved page</small><strong>{metadata.finalUrl}</strong></span></div>}
                    <p className="maintenance-muted">Fetched {displayTime(metadata.fetchedAt)}. Suggestions remain separate until you apply them.</p>
                  </div>
                ) : (
                  <p className="maintenance-muted">
                    {selected.healthPolicy === "local-only"
                      ? "No server metadata is fetched for this local/private bookmark."
                      : "No stored metadata. Fetching does not change the bookmark by itself."}
                  </p>
                )}
              </article>

              <article className="panel maintenance-card">
                <div className="maintenance-card-heading">
                  <div>
                    <h3>Health history</h3>
                    <p>
                      {selected.healthPolicy === "local-only"
                        ? "Local/private checks run only in the paired browser extension after you explicitly allow the exact hostname."
                        : "Server checks remain disabled for ignored bookmarks. Manual-policy bookmarks can still be checked explicitly."}
                    </p>
                  </div>
                  <div className="health-actions">
                    {selected.healthPolicy === "local-only" ? (
                      <button className="secondary" type="button" disabled={healthBusy} onClick={() => void runLocalHealthCheck()}>
                        {healthBusy ? "Checking locally…" : "Check locally"}
                      </button>
                    ) : (
                      <button
                        className="secondary"
                        type="button"
                        disabled={healthBusy || selected.healthPolicy === "ignore"}
                        onClick={() => void runHealthCheck()}
                      >
                        {healthBusy ? "Checking…" : selected.healthPolicy === "ignore" ? "Ignored" : "Check now"}
                      </button>
                    )}
                  </div>
                </div>

                {redirectedUrl && (
                  <div className="redirect-review">
                    <span><small>Redirect target</small><strong>{redirectedUrl}</strong></span>
                    <button className="primary" type="button" disabled={applying} onClick={() => void applyUpdate({ url: redirectedUrl }, "Redirect target applied. Metadata was invalidated for the new URL.", true)}>Use final URL</button>
                  </div>
                )}

                <div className="health-history">
                  {checks.slice(0, 10).map((check) => (
                    <div className="health-history-row" key={check.id}>
                      <span className={`health-badge status-${check.status}`}>{healthLabels[check.status]}</span>
                      <span className={`health-source source-${check.source ?? "server"}`}>{check.source === "extension" ? "Browser" : "Server"}</span>
                      <span>{check.httpStatus ?? "—"}</span>
                      <span>{check.responseMs == null ? "—" : `${check.responseMs} ms`}</span>
                      <span className="health-history-url">{check.finalUrl ?? selected.url}</span>
                      <time>{displayTime(check.checkedAt)}</time>
                    </div>
                  ))}
                  {!checks.length && <p className="maintenance-muted">No health checks recorded yet.</p>}
                </div>
              </article>
            </>
          )}
        </div>
      </div>

      <article className="panel cleanup-panel">
        <div className="maintenance-card-heading">
          <div>
            <p className="eyebrow">CLEANUP REVIEW</p>
            <h3>Delete only what you reviewed.</h3>
            <p>Only normal-policy bookmarks whose latest status is DNS error, TLS error or unavailable appear here. Ignored, local-only, manual, timeout, auth, rate-limit and redirect results are excluded.</p>
          </div>
          <div className="cleanup-actions">
            <button
              className="secondary"
              type="button"
              disabled={!cleanupCandidates.length || cleanupBusy}
              onClick={() => setCleanupSelection(allCleanupSelected ? new Set() : new Set(cleanupCandidates.map((bookmark) => bookmark.id)))}
            >
              {allCleanupSelected ? "Clear selection" : "Select candidates"}
            </button>
            <button className="danger-button" type="button" disabled={!cleanupSelection.size || cleanupBusy} onClick={() => void deleteCleanupSelection()}>
              {cleanupBusy ? "Deleting…" : `Delete selected (${cleanupSelection.size})`}
            </button>
          </div>
        </div>

        <div className="cleanup-list">
          {cleanupCandidates.map((bookmark) => (
            <label className="cleanup-row" key={bookmark.id}>
              <input type="checkbox" checked={cleanupSelection.has(bookmark.id)} onChange={() => toggleCleanup(bookmark.id)} />
              <span>
                <strong>{bookmark.title}</strong>
                <small>{bookmark.url}</small>
              </span>
              <span className={`health-badge status-${bookmark.healthStatus}`}>{healthLabels[bookmark.healthStatus]}</span>
            </label>
          ))}
          {!cleanupCandidates.length && <p className="maintenance-muted">No conservative cleanup candidates right now.</p>}
        </div>
      </article>
    </section>
  );
}
