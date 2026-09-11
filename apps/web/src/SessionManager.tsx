import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  normalizeBookmarkUrl,
  type CreateSessionItemInput,
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
import { getBridgeStatus, restoreSessionWithBridge } from "./browser-bridge";

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

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

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

function formatSessionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
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
  const [newName, setNewName] = useState("");
  const [newSource, setNewSource] = useState("Web");
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

  useEffect(() => {
    if (!selectedSessionId && sessions[0]) onSelectedChange(sessions[0].id);
    if (selectedSessionId && !sessions.some((session) => session.id === selectedSessionId)) {
      onSelectedChange(sessions[0]?.id ?? null);
    }
  }, [onSelectedChange, selectedSessionId, sessions]);

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
      <div className="management-heading">
        <div>
          <p className="eyebrow">SESSIONS</p>
          <h1>Save where you are.<br />Resume anywhere.</h1>
        </div>
        <span className="library-count">{sessions.length} sessions</span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="management-grid session-grid">
        <aside className="manager-sidebar">
          <div className="form-card">
            <div className="card-heading">
              <div><h2>New session</h2><p>Paste one URL per line, or use “Title | URL”.</p></div>
            </div>
            <form className="session-create-form" onSubmit={submitSession}>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Research · Friday" maxLength={120} />
              <input value={newSource} onChange={(event) => setNewSource(event.target.value)} placeholder="Source device" maxLength={160} />
              <textarea value={quickUrls} onChange={(event) => setQuickUrls(event.target.value)} placeholder={"https://example.com\nDocs | https://developer.mozilla.org"} />
              <button className="primary" disabled={busy || !newName.trim()}>Save session</button>
            </form>
          </div>

          <div className="session-nav form-card">
            <div className="card-heading"><h2>Recent sessions</h2><span>{sessions.length}</span></div>
            {sessions.map((session) => (
              <button
                className={`session-nav-item ${selected?.id === session.id ? "active" : ""}`}
                type="button"
                key={session.id}
                onClick={() => onSelectedChange(session.id)}
              >
                <span className="session-nav-icon">{session.items.length}</span>
                <span>
                  <strong>{session.name}</strong>
                  <small>{formatSessionDate(session.createdAt)}{session.sourceDevice ? ` · ${session.sourceDevice}` : ""}</small>
                </span>
              </button>
            ))}
            {!loading && !sessions.length && <p className="empty-copy">No saved sessions yet.</p>}
          </div>
        </aside>

        <div className="manager-main">
          {selected ? (
            <>
              <div className="form-card session-header-card">
                {editingMeta ? (
                  <form className="session-meta-form" onSubmit={saveMeta}>
                    <input autoFocus value={metaName} onChange={(event) => setMetaName(event.target.value)} maxLength={120} />
                    <input value={metaSource} onChange={(event) => setMetaSource(event.target.value)} maxLength={160} placeholder="Source device" />
                    <div className="edit-actions">
                      <button className="primary" disabled={busy}>Save</button>
                      <button className="secondary" type="button" onClick={() => setEditingMeta(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="session-header-content">
                    <div>
                      <div className="session-title-row"><span className="session-large-icon">↺</span><h2>{selected.name}</h2></div>
                      <p>
                        {selected.items.length} tabs · saved {formatSessionDate(selected.createdAt)}
                        {selected.sourceDevice ? ` · ${selected.sourceDevice}` : ""}
                      </p>
                    </div>
                    <div className="session-header-actions">
                      <button className="primary" type="button" disabled={!selected.items.length} onClick={() => void restoreSession()}>Restore · {selected.items.length}</button>
                      <button className="secondary" type="button" onClick={beginMetaEdit}>Edit</button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete session “${selected.name}”?`)) {
                            void run(async () => {
                              await deleteSession(selected.id);
                              onSelectedChange(null);
                            });
                          }
                        }}
                      >Delete</button>
                    </div>
                  </div>
                )}
              </div>

              <form className="form-card session-add-card" onSubmit={addItem}>
                <div className="card-heading">
                  <div><h2>Add tab</h2><p>Sessions are snapshots, but you can repair or extend them later.</p></div>
                </div>
                <div className="session-add-fields">
                  <input value={newItem.title} onChange={(event) => setNewItem({ ...newItem, title: event.target.value })} placeholder="Title" />
                  <input value={newItem.url} onChange={(event) => setNewItem({ ...newItem, url: event.target.value })} placeholder="https://example.com" inputMode="url" />
                  <label className="session-pin-toggle"><input type="checkbox" checked={newItem.pinned} onChange={(event) => setNewItem({ ...newItem, pinned: event.target.checked })} /> Pinned</label>
                  <button className="secondary" disabled={busy || !newItem.title.trim() || !newItem.url.trim()}>Add tab</button>
                </div>
              </form>

              <div className="session-items">
                {[...selected.items].sort((a, b) => a.position - b.position).map((item, index, ordered) => (
                  <article className="session-item-card" key={item.id}>
                    {editingItemId === item.id ? (
                      <form className="session-item-edit" onSubmit={(event) => saveItem(event, item.id)}>
                        <input value={itemDraft.title} onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })} />
                        <input value={itemDraft.url} onChange={(event) => setItemDraft({ ...itemDraft, url: event.target.value })} inputMode="url" />
                        <label className="session-pin-toggle"><input type="checkbox" checked={itemDraft.pinned} onChange={(event) => setItemDraft({ ...itemDraft, pinned: event.target.checked })} /> Pinned</label>
                        <div className="edit-actions"><button className="primary" disabled={busy}>Save</button><button className="secondary" type="button" onClick={() => setEditingItemId(null)}>Cancel</button></div>
                      </form>
                    ) : (
                      <>
                        <div className="session-item-index">{String(index + 1).padStart(2, "0")}</div>
                        <div className="session-item-copy">
                          <a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a>
                          <small>{item.url}</small>
                          <div className="session-item-meta">{item.pinned && <span>Pinned</span>}<span>Snapshot tab</span></div>
                        </div>
                        <div className="session-item-actions">
                          <button className="text-action" type="button" disabled={index === 0 || busy} onClick={() => void moveItem(item, -1)}>↑</button>
                          <button className="text-action" type="button" disabled={index === ordered.length - 1 || busy} onClick={() => void moveItem(item, 1)}>↓</button>
                          <button className="secondary" type="button" onClick={() => beginItemEdit(item)}>Edit</button>
                          <button className="danger-button" type="button" onClick={() => { if (window.confirm(`Remove “${item.title}” from this session?`)) void run(() => deleteSessionItem(selected.id, item.id)); }}>Remove</button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
                {!selected.items.length && <div className="empty-state"><strong>This session has no tabs.</strong><span>Add URLs above or save a browser window from the extension.</span></div>}
              </div>

              <p className="session-web-note">Web-only restore opens normal tabs. When the browser bridge is connected, pinned state is restored by the extension.</p>
            </>
          ) : (
            <div className="empty-state session-empty"><strong>No session selected.</strong><span>Save a temporary browsing state so it can be resumed elsewhere.</span></div>
          )}
        </div>
      </div>
    </section>
  );
}
