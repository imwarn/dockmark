/**
 * [INPUT]: depends on SessionWithItems, SessionItem, CreateSessionItemInput, ResolvedLocale, normalizeBookmarkUrl, formatRelativeTime from @dockmark/core; session CRUD from ./api; bridge restore from ./browser-bridge; BookmarkFavicon and safeDomainLabel from ./BookmarkFavicon; useI18n from ./i18n
 * [OUTPUT]: exports SessionManager component for saving, editing, and restoring browser tab snapshots
 * [POS]: session management tool surface in apps/web/src, paired with session.css
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  formatRelativeTime,
  normalizeBookmarkUrl,
  type CreateSessionItemInput,
  type ResolvedLocale,
  type SessionItem,
  type SessionWithItems,
} from "@dockmark/core";
import {
  createSession,
  createSessionItem,
  deleteSession,
  deleteSessionItem,
  updateSession,
  updateSessionItem,
} from "./api";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import { getBridgeStatus, restoreSessionWithBridge } from "./browser-bridge";
import { useI18n } from "./i18n";

interface Props {
  sessions: SessionWithItems[];
  loading: boolean;
  selectedSessionId: string | null;
  onSelectedChange: (id: string | null) => void;
  onChanged: () => Promise<void>;
}

interface ItemDraft {
  title: string;
  url: string;
  pinned: boolean;
}

const emptyItemDraft: ItemDraft = { title: "", url: "", pinned: false };

function deriveTitle(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.href;
  } catch {
    return url;
  }
}

function parseQuickLines(value: string): CreateSessionItemInput[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, position) => {
    const separator = line.indexOf("|");
    const titlePart = separator >= 0 ? line.slice(0, separator).trim() : "";
    const rawUrl = separator >= 0 ? line.slice(separator + 1).trim() : line;
    const url = normalizeBookmarkUrl(rawUrl);
    return {
      title: titlePart || deriveTitle(url),
      url,
      position,
    };
  });
}

function formatSessionDate(value: string, locale: ResolvedLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function SessionManager({
  sessions,
  loading,
  selectedSessionId,
  onSelectedChange,
  onChanged,
}: Props) {
  const { locale, isZh, tx } = useI18n();
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState(() => (isZh ? "网页端" : "Web"));
  const [quickUrls, setQuickUrls] = useState("");
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState("");
  const [metaSource, setMetaSource] = useState("");
  const [newItem, setNewItem] = useState<ItemDraft>(emptyItemDraft);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null,
    [selectedSessionId, sessions],
  );

  const totalTabs = useMemo(
    () => sessions.reduce((sum, session) => sum + session.items.length, 0),
    [sessions],
  );

  const orderedItems = useMemo(
    () => (selected ? [...selected.items].sort((a, b) => a.position - b.position) : []),
    [selected],
  );

  useEffect(() => {
    if (!selectedSessionId && sessions[0]) onSelectedChange(sessions[0].id);
    if (selectedSessionId && !sessions.some((session) => session.id === selectedSessionId)) {
      onSelectedChange(sessions[0]?.id ?? null);
    }
  }, [onSelectedChange, selectedSessionId, sessions]);

  function messageFrom(caught: unknown) {
    return caught instanceof Error ? caught.message : tx("Something went wrong.", "操作失败，请稍后重试。");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitSession(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;

    let items: CreateSessionItemInput[];
    try {
      items = parseQuickLines(quickUrls);
    } catch (caught) {
      setError(messageFrom(caught));
      return;
    }

    let createdId: string | null = null;
    await run(async () => {
      const created = await createSession({
        name,
        ...(newSource.trim() ? { sourceDevice: newSource.trim() } : {}),
        items,
      });
      createdId = created.id;
      setNewName("");
      setQuickUrls("");
    });
    if (createdId) onSelectedChange(createdId);
  }

  function beginMetaEdit() {
    if (!selected) return;
    setMetaName(selected.name);
    setMetaSource(selected.sourceDevice ?? "");
    setEditingMeta(true);
  }

  async function saveMeta(event: FormEvent) {
    event.preventDefault();
    if (!selected || !metaName.trim()) return;
    await run(async () => {
      await updateSession(selected.id, {
        name: metaName.trim(),
        sourceDevice: metaSource.trim() || null,
      });
      setEditingMeta(false);
    });
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!selected || !newItem.title.trim() || !newItem.url.trim()) return;
    await run(async () => {
      await createSessionItem(selected.id, {
        title: newItem.title.trim(),
        url: newItem.url.trim(),
        pinned: newItem.pinned,
      });
      setNewItem(emptyItemDraft);
    });
  }

  function beginItemEdit(item: SessionItem) {
    setEditingItemId(item.id);
    setItemDraft({ title: item.title, url: item.url, pinned: item.pinned });
  }

  async function saveItem(event: FormEvent, itemId: string) {
    event.preventDefault();
    if (!selected || !itemDraft.title.trim() || !itemDraft.url.trim()) return;
    await run(async () => {
      await updateSessionItem(selected.id, itemId, {
        title: itemDraft.title.trim(),
        url: itemDraft.url.trim(),
        pinned: itemDraft.pinned,
      });
      setEditingItemId(null);
    });
  }

  async function moveItem(item: SessionItem, direction: -1 | 1) {
    if (!selected) return;
    const ordered = [...selected.items].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((candidate) => candidate.id === item.id);
    const other = ordered[index + direction];
    if (!other) return;
    await run(async () => {
      await updateSessionItem(selected.id, item.id, { position: other.position });
      await updateSessionItem(selected.id, other.id, { position: item.position });
    });
  }

  async function restoreSession() {
    if (!selected) return;
    const ordered = [...selected.items].sort((a, b) => a.position - b.position);

    try {
      const status = await getBridgeStatus();
      if (status.connected) {
        await restoreSessionWithBridge(ordered.map((item) => ({
          url: item.url,
          pinned: item.pinned,
        })));
        return;
      }
    } catch {
      // Web-only mode remains the fallback when no browser bridge is present.
    }

    for (const item of ordered) {
      const opened = window.open(item.url, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
    }
  }

  return (
    <section className="management session-management">
      <header className="session-tool-header">
        <div className="session-tool-copy">
          <h1>{tx("Sessions", "会话")}</h1>
          <p>{tx("Save tab snapshots and resume browsing from any device.", "保存标签页快照，随时在其他设备恢复浏览状态。")}</p>
        </div>
        <div className="session-tool-pills">
          <span className="library-count">
            {tx(`${sessions.length} session${sessions.length === 1 ? "" : "s"}`, `${sessions.length} 个会话`)}
          </span>
          <span className="library-count">
            {tx(`${totalTabs} tab${totalTabs === 1 ? "" : "s"}`, `${totalTabs} 个标签页`)}
          </span>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="management-grid session-grid">
        <aside className="manager-sidebar">
          <div className="form-card">
            <div className="card-heading">
              <div>
                <h2>{tx("New session", "新建会话")}</h2>
                <p>{tx("Paste one URL per line, or use “Title | URL”.", "每行粘贴一个链接，或使用“标题 | 链接”格式。")}</p>
              </div>
            </div>
            <form className="session-create-form" onSubmit={submitSession}>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={tx("Research · Friday", "调研记录 · 周五")}
                aria-label={tx("Session name", "会话名称")}
                maxLength={120}
              />
              <input
                value={newSource}
                onChange={(event) => setNewSource(event.target.value)}
                placeholder={tx("Source device", "来源设备")}
                aria-label={tx("Source device", "来源设备")}
                maxLength={160}
              />
              <textarea
                value={quickUrls}
                onChange={(event) => setQuickUrls(event.target.value)}
                placeholder={tx(
                  "https://example.com\nDocs | https://developer.mozilla.org",
                  "https://example.com\n文档 | https://developer.mozilla.org",
                )}
                aria-label={tx("Tab URLs", "标签页链接列表")}
              />
              <button className="primary" disabled={busy || !newName.trim()}>
                {tx("Save session", "保存会话")}
              </button>
            </form>
          </div>

          <div className="session-nav form-card">
            <div className="card-heading">
              <h2>{tx("Recent sessions", "最近会话")}</h2>
              <span>{sessions.length}</span>
            </div>
            {sessions.map((session) => (
              <button
                className={`session-nav-item ${selected?.id === session.id ? "active" : ""}`}
                type="button"
                key={session.id}
                title={formatRelativeTime(session.createdAt, locale)}
                onClick={() => onSelectedChange(session.id)}
              >
                <span className="session-nav-icon">{session.items.length}</span>
                <span>
                  <strong>{session.name}</strong>
                  <small>
                    {formatSessionDate(session.createdAt, locale)}
                    {session.sourceDevice ? ` · ${session.sourceDevice}` : ""}
                  </small>
                </span>
              </button>
            ))}
            {!loading && !sessions.length && (
              <p className="empty-copy">{tx("No saved sessions yet.", "暂无已保存的会话。")}</p>
            )}
          </div>
        </aside>

        <div className="manager-main">
          {selected ? (
            <>
              <div className="form-card session-header-card">
                {editingMeta ? (
                  <form className="session-meta-form" onSubmit={saveMeta}>
                    <input
                      autoFocus
                      value={metaName}
                      onChange={(event) => setMetaName(event.target.value)}
                      placeholder={tx("Session name", "会话名称")}
                      maxLength={120}
                    />
                    <input
                      value={metaSource}
                      onChange={(event) => setMetaSource(event.target.value)}
                      maxLength={160}
                      placeholder={tx("Source device", "来源设备")}
                    />
                    <div className="edit-actions">
                      <button className="primary" disabled={busy}>{tx("Save", "保存")}</button>
                      <button className="secondary" type="button" onClick={() => setEditingMeta(false)}>
                        {tx("Cancel", "取消")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="session-header-content">
                    <div className="session-header-lead">
                      <div className="session-title-row">
                        <span className="session-large-icon">↺</span>
                        <h2>{selected.name}</h2>
                      </div>
                      <p>
                        {tx(
                          `${selected.items.length} tab${selected.items.length === 1 ? "" : "s"} · saved ${formatSessionDate(selected.createdAt, locale)} (${formatRelativeTime(selected.createdAt, locale)})`,
                          `${selected.items.length} 个标签页 · 保存于 ${formatSessionDate(selected.createdAt, locale)}（${formatRelativeTime(selected.createdAt, locale)}）`,
                        )}
                        {selected.sourceDevice ? ` · ${selected.sourceDevice}` : ""}
                      </p>
                    </div>
                    <div className="session-header-actions">
                      <button
                        className="primary"
                        type="button"
                        disabled={!selected.items.length}
                        onClick={() => void restoreSession()}
                      >
                        {tx(`Restore · ${selected.items.length}`, `恢复 · ${selected.items.length}`)}
                      </button>
                      <button className="secondary" type="button" onClick={beginMetaEdit}>
                        {tx("Edit", "编辑")}
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              tx(`Delete session “${selected.name}”?`, `确定删除会话“${selected.name}”吗？`),
                            )
                          ) {
                            void run(async () => {
                              await deleteSession(selected.id);
                              onSelectedChange(null);
                            });
                          }
                        }}
                      >
                        {tx("Delete", "删除")}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <form className="form-card session-add-card" onSubmit={addItem}>
                <div className="card-heading">
                  <div>
                    <h2>{tx("Add tab", "添加标签页")}</h2>
                    <p>{tx("Sessions are snapshots, and you can repair or extend them later.", "会话是标签页快照，仍可随时补充或修正。")}</p>
                  </div>
                </div>
                <div className="session-add-fields">
                  <input
                    value={newItem.title}
                    onChange={(event) => setNewItem({ ...newItem, title: event.target.value })}
                    placeholder={tx("Title", "标题")}
                  />
                  <input
                    value={newItem.url}
                    onChange={(event) => setNewItem({ ...newItem, url: event.target.value })}
                    placeholder="https://example.com"
                    inputMode="url"
                  />
                  <label className="session-pin-toggle">
                    <input
                      type="checkbox"
                      checked={newItem.pinned}
                      onChange={(event) => setNewItem({ ...newItem, pinned: event.target.checked })}
                    />{" "}
                    {tx("Pinned", "固定")}
                  </label>
                  <button
                    className="secondary"
                    disabled={busy || !newItem.title.trim() || !newItem.url.trim()}
                  >
                    {tx("Add tab", "添加标签页")}
                  </button>
                </div>
              </form>

              <div className="session-items">
                {orderedItems.map((item, index) => (
                  <article className="session-item-card" key={item.id}>
                    {editingItemId === item.id ? (
                      <form className="session-item-edit" onSubmit={(event) => saveItem(event, item.id)}>
                        <input
                          value={itemDraft.title}
                          onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })}
                          placeholder={tx("Title", "标题")}
                        />
                        <input
                          value={itemDraft.url}
                          onChange={(event) => setItemDraft({ ...itemDraft, url: event.target.value })}
                          placeholder="https://example.com"
                          inputMode="url"
                        />
                        <label className="session-pin-toggle">
                          <input
                            type="checkbox"
                            checked={itemDraft.pinned}
                            onChange={(event) => setItemDraft({ ...itemDraft, pinned: event.target.checked })}
                          />{" "}
                          {tx("Pinned", "固定")}
                        </label>
                        <div className="edit-actions">
                          <button className="primary" disabled={busy}>{tx("Save", "保存")}</button>
                          <button className="secondary" type="button" onClick={() => setEditingItemId(null)}>
                            {tx("Cancel", "取消")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="session-item-index">{String(index + 1).padStart(2, "0")}</div>
                        <BookmarkFavicon
                          iconUrl={null}
                          title={item.title}
                          url={item.url}
                          className="session-item-favicon"
                        />
                        <div className="session-item-copy">
                          <a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a>
                          <small title={item.url}>{item.url}</small>
                          <div className="session-item-meta">
                            <span className="session-domain-pill">{safeDomainLabel(item.url)}</span>
                            {item.pinned && <span className="session-pinned-pill">{tx("Pinned", "已固定")}</span>}
                            <span>{tx("Snapshot tab", "快照标签页")}</span>
                          </div>
                        </div>
                        <div className="session-item-actions">
                          <button
                            className="text-action"
                            type="button"
                            disabled={index === 0 || busy}
                            aria-label={tx("Move up", "上移")}
                            title={tx("Move up", "上移")}
                            onClick={() => void moveItem(item, -1)}
                          >
                            ↑
                          </button>
                          <button
                            className="text-action"
                            type="button"
                            disabled={index === orderedItems.length - 1 || busy}
                            aria-label={tx("Move down", "下移")}
                            title={tx("Move down", "下移")}
                            onClick={() => void moveItem(item, 1)}
                          >
                            ↓
                          </button>
                          <button className="secondary" type="button" onClick={() => beginItemEdit(item)}>
                            {tx("Edit", "编辑")}
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              if (
                                window.confirm(
                                  tx(
                                    `Remove “${item.title}” from this session?`,
                                    `确定从当前会话移除“${item.title}”吗？`,
                                  ),
                                )
                              ) {
                                void run(() => deleteSessionItem(selected.id, item.id));
                              }
                            }}
                          >
                            {tx("Remove", "移除")}
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
                {!orderedItems.length && (
                  <div className="empty-state">
                    <strong>{tx("This session has no tabs.", "该会话暂无标签页。")}</strong>
                    <span>
                      {tx(
                        "Add URLs above or save a browser window from the extension.",
                        "请在上方添加链接，或通过浏览器扩展保存当前窗口。",
                      )}
                    </span>
                  </div>
                )}
              </div>

              <p className="session-web-note">
                {tx(
                  "Web-only restore opens normal tabs. When the Browser Bridge is connected, pinned state is restored by the extension.",
                  "纯网页恢复会以普通标签页打开；连接浏览器桥接后，扩展会自动还原标签页的固定状态。",
                )}
              </p>
            </>
          ) : (
            <div className="empty-state session-empty">
              <strong>{tx("No session selected.", "未选择会话。")}</strong>
              <span>
                {tx(
                  "Save a temporary browsing state so it can be resumed elsewhere.",
                  "保存当前浏览状态，以便稍后在其他设备继续。",
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
