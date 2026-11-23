/**
 * [INPUT]: depends on Bookmark, HealthCheck, HealthStatus, HEALTH_POLICY_LABELS, HEALTH_STATUS_LABELS, ResolvedLocale from @dockmark/core; bookmark metadata/health APIs from ./api, ./browser-bridge, ./local-health-api; BookmarkFavicon from ./BookmarkFavicon; useI18n from ./i18n
 * [OUTPUT]: exports BookmarkMaintenance component
 * [POS]: per-bookmark metadata fetcher, health history inspector, and conservative cleanup review panel inside the Health tab
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState } from "react";
import {
  HEALTH_POLICY_LABELS,
  HEALTH_STATUS_LABELS,
  type Bookmark,
  type HealthCheck,
  type HealthStatus,
  type ResolvedLocale,
} from "@dockmark/core";
import {
  checkBookmarkHealth,
  deleteBookmark,
  getBookmarkMetadata,
  listBookmarkHealthChecks,
  refreshBookmarkMetadata,
  updateBookmark,
  type BookmarkMetadata,
} from "./api";
import { BookmarkFavicon } from "./BookmarkFavicon";
import {
  checkLocalHealthWithBridge,
  getBridgeStatus,
  onBridgeEvent,
} from "./browser-bridge";
import { useI18n } from "./i18n";
import { recordLocalBookmarkHealthResult } from "./local-health-api";
import "./maintenance.css";

interface Props {
  bookmarks: Bookmark[];
  onChanged: () => Promise<void>;
}

const cleanupStatuses = new Set<HealthStatus>(["dns-error", "tls-error", "unavailable"]);

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function displayTime(value: string, locale: ResolvedLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function BookmarkMaintenance({ bookmarks, onChanged }: Props) {
  const { locale, tx } = useI18n();
  const statusLabels = HEALTH_STATUS_LABELS[locale];
  const policyLabels = HEALTH_POLICY_LABELS[locale];
  const genericError = tx("Something went wrong.", "操作失败，请重试。");

  const [selectedId, setSelectedId] = useState<string | null>(() => bookmarks[0]?.id ?? null);
  const [query, setQuery] = useState("");
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

  const visibleBookmarks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return bookmarks;
    return bookmarks.filter((bookmark) =>
      bookmark.title.toLowerCase().includes(normalized) || bookmark.url.toLowerCase().includes(normalized),
    );
  }, [bookmarks, query]);

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
      setNotice(tx(
        "Local host access granted. Run Check locally again to record the result.",
        "本地主机访问权限已授予，请重新点击「本地检查」以记录结果。",
      ));
    }
  }), [tx]);

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
        if (!cancelled) setError(messageFrom(caught, genericError));
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
      setNotice(tx(
        "Metadata refreshed. Nothing was applied automatically.",
        "已抓取最新页面元数据，尚未自动应用。",
      ));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
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
      const cleanupNote = selected.healthPolicy === "normal" && cleanupStatuses.has(check.status)
        ? tx(" Added to Cleanup Review.", " 已加入清理复核列表。")
        : check.status === "timeout"
          ? tx(" Timeout is transient and excluded from Cleanup Review.", " 超时视为临时故障，不列入清理复核。")
          : selected.healthPolicy !== "normal"
            ? tx(
                ` ${policyLabels[selected.healthPolicy]} policy is excluded from bulk cleanup.`,
                ` 「${policyLabels[selected.healthPolicy]}」策略不参与批量清理。`,
              )
            : "";
      setNotice(tx(
        `Server health check: ${statusLabels[check.status]}.${cleanupNote}`,
        `服务端健康检查结果：${statusLabels[check.status]}。${cleanupNote}`,
      ));
      await onChanged();
    } catch (caught) {
      setError(messageFrom(caught, genericError));
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
        throw new Error(tx(
          "This Dockmark browser extension does not support local health checks. Update it to v0.9.0 or later.",
          "当前浏览器扩展版本不支持本地健康检查，请更新至 v0.9.0 或更高版本。",
        ));
      }

      const result = await checkLocalHealthWithBridge(selected.url);
      if (result.kind === "permission-required") {
        setNotice(tx(
          `Browser host access is required for ${result.pattern}. Approve the permission in the extension tab, then run Check locally again.`,
          `需要授予 ${result.pattern} 的主机访问权限。请在扩展弹窗页面批准后重新点击「本地检查」。`,
        ));
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
      setNotice(tx(
        `Browser health check: ${statusLabels[check.status]}.`,
        `浏览器本地健康检查结果：${statusLabels[check.status]}。`,
      ));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
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
      setError(messageFrom(caught, genericError));
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
    if (!window.confirm(tx(
      `Delete ${ids.length} reviewed broken bookmark${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
      `确认删除已复核的 ${ids.length} 个失效书签？此操作不可撤销。`,
    ))) return;

    setCleanupBusy(true);
    setError(null);
    setNotice(null);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteBookmark(id)));
      const deleted = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - deleted;
      setCleanupSelection(new Set());
      await onChanged();
      setNotice(tx(
        `Deleted ${deleted} reviewed bookmark${deleted === 1 ? "" : "s"}${failed ? `; ${failed} could not be deleted` : ""}.`,
        `已删除 ${deleted} 个复核书签${failed ? `；${failed} 个删除失败` : ""}。`,
      ));
    } catch (caught) {
      setError(messageFrom(caught, genericError));
    } finally {
      setCleanupBusy(false);
    }
  }

  function cleanupEligibility(bookmark: Bookmark | null) {
    if (!bookmark) return null;
    if (bookmark.healthPolicy !== "normal") {
      return tx(
        `${policyLabels[bookmark.healthPolicy]} policy is excluded from bulk cleanup.`,
        `「${policyLabels[bookmark.healthPolicy]}」策略不会进入批量清理列表。`,
      );
    }
    if (cleanupStatuses.has(bookmark.healthStatus)) {
      return tx(
        "Latest hard-failure status is eligible for Cleanup Review.",
        "最近一次硬性失败状态符合清理复核条件。",
      );
    }
    if (bookmark.healthStatus === "timeout") {
      return tx(
        "Timeout is treated as transient and excluded from Cleanup Review.",
        "超时属于临时故障，不会列入清理复核。",
      );
    }
    if (bookmark.healthStatus === "redirected") {
      return tx(
        "Redirects stay in review and are never bulk-cleanup candidates.",
        "重定向仅作复核提示，不会进入批量清理。",
      );
    }
    return null;
  }

  const latest = checks[0] ?? null;
  const redirectedUrl = latest?.status === "redirected" && latest.finalUrl && latest.finalUrl !== selected?.url
    ? latest.finalUrl
    : null;
  const metadataTitle = metadata?.title ?? null;
  const metadataDescription = metadata?.description ?? null;
  const metadataCanonicalUrl = metadata?.canonicalUrl ?? null;
  const metadataIconUrl = metadata?.iconUrl ?? null;
  const metadataResolvedUrl = metadata?.finalUrl ?? null;
  const resolvedUrlSuggestion = metadataResolvedUrl && metadataResolvedUrl !== selected?.url
    ? metadataResolvedUrl
    : null;
  const selectedCleanupEligibility = cleanupEligibility(selected);
  const allCleanupSelected = cleanupCandidates.length > 0 && cleanupSelection.size === cleanupCandidates.length;

  return (
    <section className="maintenance-section">
      <div className="settings-heading maintenance-heading">
        <div>
          <h2>{tx("Metadata & Health", "元数据与健康检查")}</h2>
          <p>
            {tx(
              "Fetch page metadata, review redirect targets, and inspect health history. Nothing is overwritten automatically.",
              "按需抓取网页元数据、核对重定向目标并查看健康记录，所有修改均需手动确认。",
            )}
          </p>
        </div>
        <div className="settings-sync-state">
          <strong>{tx(`${bookmarks.length} bookmarks`, `${bookmarks.length} 个书签`)}</strong>
          <span>{tx("Manual review gate", "人工复核模式")}</span>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner maintenance-feedback" role="status">{notice}</div>}

      <div className="maintenance-grid">
        <div className="maintenance-list panel">
          <div className="maintenance-list-tools">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tx("Search title or URL…", "搜索标题或网址…")}
              aria-label={tx("Search Metadata and Health bookmarks", "搜索元数据与健康检查书签")}
            />
            <span>{visibleBookmarks.length} / {bookmarks.length}</span>
          </div>
          <div className="maintenance-list-scroll">
            {visibleBookmarks.map((bookmark) => (
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
                <em className={`maintenance-health status-${bookmark.healthStatus}`}>{statusLabels[bookmark.healthStatus]}</em>
              </button>
            ))}
            {!bookmarks.length && (
              <div className="empty-state">
                <strong>{tx("No bookmarks yet.", "暂无书签。")}</strong>
                <span>{tx("Add a bookmark before running metadata or health maintenance.", "添加书签后即可执行元数据与健康检查。")}</span>
              </div>
            )}
            {bookmarks.length > 0 && !visibleBookmarks.length && (
              <div className="empty-state">
                <strong>{tx("No matches.", "无匹配结果。")}</strong>
                <span>{tx("Try another title or URL.", "请尝试其他标题或网址。")}</span>
              </div>
            )}
          </div>
        </div>

        <div className="maintenance-inspector">
          {!selected ? (
            <div className="panel maintenance-empty">{tx("Select a bookmark to inspect.", "请从左侧选择一个书签进行查看。")}</div>
          ) : (
            <>
              <article className="panel maintenance-card">
                <div className="maintenance-card-heading">
                  <div className="maintenance-selected-title">
                    <BookmarkFavicon
                      iconUrl={selected.iconUrl}
                      title={selected.title}
                      url={selected.url}
                      className="bookmark-icon maintenance-favicon"
                    />
                    <div className="maintenance-selected-copy">
                      <h3>{selected.title}</h3>
                      <a href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a>
                    </div>
                  </div>
                  <div className="selected-badges">
                    <span className="maintenance-policy">{policyLabels[selected.healthPolicy]}</span>
                    <span className={`health-badge status-${selected.healthStatus}`}>{statusLabels[selected.healthStatus]}</span>
                  </div>
                </div>
              </article>

              <article className="panel maintenance-card">
                <div className="maintenance-card-heading">
                  <div>
                    <h3>{tx("Page metadata", "页面元数据")}</h3>
                    <p>
                      {selected.healthPolicy === "local-only"
                        ? tx(
                            "Local/private page metadata is never fetched by the Worker. Use local health checks in the extension instead.",
                            "Worker 不会抓取本地/内网页面元数据；本地检查请在浏览器扩展中运行。",
                          )
                        : tx(
                            "Fetches public HTTP(S) pages (max 5 redirects, 512 KiB HTML). Canonical URL comes only from rel=canonical; HTTP redirects appear as Resolved URL.",
                            "仅抓取公网 HTTP(S) 页面（最多 5 次重定向、512 KiB HTML）。规范链接取自 rel=canonical，HTTP 跳转单独显示为最终跳转地址。",
                          )}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={metadataBusy || loading || selected.healthPolicy === "local-only"}
                    onClick={() => void fetchMetadata()}
                  >
                    {selected.healthPolicy === "local-only"
                      ? tx("Server metadata disabled", "服务端抓取已禁用")
                      : metadataBusy
                        ? tx("Fetching…", "抓取中…")
                        : metadata
                          ? tx("Refresh metadata", "刷新元数据")
                          : tx("Fetch metadata", "抓取元数据")}
                  </button>
                </div>

                {loading ? (
                  <p className="maintenance-muted">{tx("Loading…", "加载中…")}</p>
                ) : metadata ? (
                  <div className="metadata-fields">
                    <div className="metadata-row">
                      <span><small>{tx("Title", "标题")}</small><strong>{metadataTitle ?? tx("Not provided", "未提供")}</strong></span>
                      {metadataTitle && metadataTitle !== selected.title && (
                        <button
                          className="text-action"
                          disabled={applying}
                          onClick={() => void applyUpdate({ title: metadataTitle }, tx("Metadata title applied.", "已应用抓取的标题。"))}
                        >
                          {tx("Use title", "采用标题")}
                        </button>
                      )}
                    </div>
                    <div className="metadata-row">
                      <span><small>{tx("Description", "描述")}</small><strong>{metadataDescription ?? tx("Not provided", "未提供")}</strong></span>
                      {metadataDescription && metadataDescription !== selected.description && (
                        <button
                          className="text-action"
                          disabled={applying}
                          onClick={() => void applyUpdate({ description: metadataDescription }, tx("Metadata description applied.", "已应用抓取的描述。"))}
                        >
                          {tx("Use description", "采用描述")}
                        </button>
                      )}
                    </div>
                    <div className="metadata-row">
                      <span><small>{tx("Canonical URL", "规范链接")}</small><strong>{metadataCanonicalUrl ?? tx("Not provided", "未提供")}</strong></span>
                      {metadataCanonicalUrl && metadataCanonicalUrl !== selected.url && (
                        <button
                          className="text-action"
                          disabled={applying}
                          onClick={() => void applyUpdate(
                            { url: metadataCanonicalUrl },
                            tx("Canonical URL applied. Fetch metadata again for the new URL.", "已应用规范链接，可按需重新抓取新地址的元数据。"),
                            true,
                          )}
                        >
                          {tx("Use canonical", "采用规范链接")}
                        </button>
                      )}
                    </div>
                    <div className="metadata-row">
                      <span><small>{tx("Icon", "图标")}</small><strong>{metadataIconUrl ?? tx("Not provided", "未提供")}</strong></span>
                      {metadataIconUrl && metadataIconUrl !== selected.iconUrl && (
                        <button
                          className="text-action"
                          disabled={applying}
                          onClick={() => void applyUpdate({ iconUrl: metadataIconUrl }, tx("Metadata icon applied.", "已应用抓取的图标。"))}
                        >
                          {tx("Use icon", "采用图标")}
                        </button>
                      )}
                    </div>
                    {metadata.imageUrl && (
                      <div className="metadata-row">
                        <span><small>{tx("Open Graph image", "Open Graph 封面图")}</small><strong>{metadata.imageUrl}</strong></span>
                      </div>
                    )}
                    {metadataResolvedUrl && (
                      <div className="metadata-row">
                        <span><small>{tx("Resolved URL", "最终跳转地址")}</small><strong>{metadataResolvedUrl}</strong></span>
                        {resolvedUrlSuggestion && (
                          <button
                            className="text-action"
                            disabled={applying}
                            onClick={() => void applyUpdate(
                              { url: resolvedUrlSuggestion },
                              tx("Resolved URL applied. Metadata was invalidated for the new URL.", "已更新为最终跳转地址，旧元数据已清除。"),
                              true,
                            )}
                          >
                            {tx("Use resolved URL", "采用跳转地址")}
                          </button>
                        )}
                      </div>
                    )}
                    <p className="maintenance-muted">
                      {tx(
                        `Fetched ${displayTime(metadata.fetchedAt, locale)}. Suggestions remain separate until applied.`,
                        `抓取时间：${displayTime(metadata.fetchedAt, locale)}。建议不会自动覆盖书签内容。`,
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="maintenance-muted">
                    {selected.healthPolicy === "local-only"
                      ? tx("No server metadata is fetched for this local/private bookmark.", "本地/内网书签不执行服务端元数据抓取。")
                      : tx("No stored metadata. Fetching does not change the bookmark by itself.", "暂无缓存元数据；点击抓取不会自动改动书签。")}
                  </p>
                )}
              </article>

              <article className="panel maintenance-card">
                <div className="maintenance-card-heading">
                  <div>
                    <h3>{tx("Health history", "健康检查历史")}</h3>
                    <p>
                      {selected.healthPolicy === "local-only"
                        ? tx(
                            "Local/private checks run only in the paired browser extension after you explicitly allow the exact hostname.",
                            "本地/内网检查仅在已配对的浏览器扩展中运行，且需逐个授权主机名。",
                          )
                        : tx(
                            "Server checks stay disabled for ignored bookmarks. Manual-policy bookmarks can still be checked explicitly.",
                            "已忽略的书签不会运行服务端检查；手动策略书签仍可点击立即检查。",
                          )}
                    </p>
                  </div>
                  <div className="health-actions">
                    {selected.healthPolicy === "local-only" ? (
                      <button className="secondary" type="button" disabled={healthBusy} onClick={() => void runLocalHealthCheck()}>
                        {healthBusy ? tx("Checking locally…", "本地检查中…") : tx("Check locally", "本地检查")}
                      </button>
                    ) : (
                      <button
                        className="secondary"
                        type="button"
                        disabled={healthBusy || selected.healthPolicy === "ignore"}
                        onClick={() => void runHealthCheck()}
                      >
                        {healthBusy
                          ? tx("Checking…", "检查中…")
                          : selected.healthPolicy === "ignore"
                            ? policyLabels.ignore
                            : tx("Check now", "立即检查")}
                      </button>
                    )}
                  </div>
                </div>

                {selectedCleanupEligibility && (
                  <p className={`cleanup-eligibility${selected.healthPolicy === "normal" && cleanupStatuses.has(selected.healthStatus) ? " eligible" : ""}`}>
                    {selectedCleanupEligibility}
                  </p>
                )}

                {redirectedUrl && (
                  <div className="redirect-review">
                    <span><small>{tx("Redirect target", "重定向目标")}</small><strong>{redirectedUrl}</strong></span>
                    <button
                      className="primary"
                      type="button"
                      disabled={applying}
                      onClick={() => void applyUpdate(
                        { url: redirectedUrl },
                        tx("Redirect target applied. Metadata was invalidated for the new URL.", "已更新为重定向目标地址，旧元数据已清除。"),
                        true,
                      )}
                    >
                      {tx("Use final URL", "采用最终地址")}
                    </button>
                  </div>
                )}

                <div className="health-history">
                  {checks.slice(0, 10).map((check) => (
                    <div className="health-history-row" key={check.id}>
                      <span className={`health-badge status-${check.status}`}>{statusLabels[check.status]}</span>
                      <span className={`health-source source-${check.source ?? "server"}`}>
                        {check.source === "extension" ? tx("Browser", "浏览器") : tx("Server", "服务端")}
                      </span>
                      <span>{check.httpStatus ?? "—"}</span>
                      <span>{check.responseMs == null ? "—" : `${check.responseMs} ms`}</span>
                      <span className="health-history-url">{check.finalUrl ?? selected.url}</span>
                      <time>{displayTime(check.checkedAt, locale)}</time>
                    </div>
                  ))}
                  {!checks.length && <p className="maintenance-muted">{tx("No health checks recorded yet.", "暂无健康检查记录。")}</p>}
                </div>
              </article>
            </>
          )}
        </div>
      </div>

      <article className="panel cleanup-panel">
        <div className="maintenance-card-heading">
          <div>
            <h3>{tx("Cleanup review", "失效书签清理复核")}</h3>
            <p>
              {tx(
                "Only normal-policy bookmarks whose latest check returned DNS error, TLS error, or unavailable appear here. Ignored, local-only, manual, timeout, auth, rate-limit, and redirect items are excluded.",
                "仅列出策略为「常规」且最近一次结果为 DNS 错误、TLS 错误或不可访问的书签。已忽略、仅本地、手动、超时、鉴权、限流与重定向项均已自动排除。",
              )}
            </p>
          </div>
          <div className="cleanup-actions">
            <button
              className="secondary"
              type="button"
              disabled={!cleanupCandidates.length || cleanupBusy}
              onClick={() => setCleanupSelection(allCleanupSelected ? new Set() : new Set(cleanupCandidates.map((bookmark) => bookmark.id)))}
            >
              {allCleanupSelected ? tx("Clear selection", "取消全选") : tx("Select candidates", "选择候选项")}
            </button>
            <button className="danger-button" type="button" disabled={!cleanupSelection.size || cleanupBusy} onClick={() => void deleteCleanupSelection()}>
              {cleanupBusy
                ? tx("Deleting…", "删除中…")
                : tx(`Delete selected (${cleanupSelection.size})`, `删除已选 (${cleanupSelection.size})`)}
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
              <span className={`health-badge status-${bookmark.healthStatus}`}>{statusLabels[bookmark.healthStatus]}</span>
            </label>
          ))}
          {!cleanupCandidates.length && (
            <p className="maintenance-muted">{tx("No conservative cleanup candidates right now.", "当前没有待清理的失效书签。")}</p>
          )}
        </div>
      </article>
    </section>
  );
}
