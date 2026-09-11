import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  Bookmark,
  WorkspaceItem,
  WorkspaceOpenMode,
  WorkspaceWithItems,
} from "@dockmark/core";
import {
  createWorkspace,
  createWorkspaceItem,
  deleteWorkspace,
  deleteWorkspaceItem,
  updateWorkspace,
  updateWorkspaceItem,
} from "./api";
import { getBridgeStatus, openWorkspaceWithBridge } from "./browser-bridge";

interface Props {
  workspaces: WorkspaceWithItems[];
  bookmarks: Bookmark[];
  loading: boolean;
  selectedWorkspaceId: string | null;
  onSelectedChange: (id: string | null) => void;
  onChanged: () => Promise<void>;
}

interface ItemDraft {
  title: string;
  url: string;
  openMode: WorkspaceOpenMode;
}

const emptyItemDraft: ItemDraft = { title: "", url: "", openMode: "reuse" };

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function openModeLabel(mode: WorkspaceOpenMode) {
  if (mode === "new-tab") return "New tab";
  if (mode === "pinned") return "Pinned · extension";
  return "Reuse if possible";
}

export function WorkspaceManager({
  workspaces,
  bookmarks,
  loading,
  selectedWorkspaceId,
  onSelectedChange,
  onChanged,
}: Props) {
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaName, setMetaName] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [bookmarkId, setBookmarkId] = useState("");
  const [bookmarkMode, setBookmarkMode] = useState<WorkspaceOpenMode>("reuse");
  const [customDraft, setCustomDraft] = useState<ItemDraft>(emptyItemDraft);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? workspaces[0] ?? null,
    [selectedWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces[0]) onSelectedChange(workspaces[0].id);
    if (selectedWorkspaceId && !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      onSelectedChange(workspaces[0]?.id ?? null);
    }
  }, [onSelectedChange, selectedWorkspaceId, workspaces]);

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

  async function submitWorkspace(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    let createdId: string | null = null;
    await run(async () => {
      const created = await createWorkspace({
        name,
        ...(newDescription.trim() ? { description: newDescription.trim() } : {}),
      });
      createdId = created.id;
      setNewName("");
      setNewDescription("");
    });
    if (createdId) onSelectedChange(createdId);
  }

  function beginMetaEdit() {
    if (!selected) return;
    setMetaName(selected.name);
    setMetaDescription(selected.description ?? "");
    setEditingMeta(true);
  }

  async function saveMeta(event: FormEvent) {
    event.preventDefault();
    if (!selected || !metaName.trim()) return;
    await run(async () => {
      await updateWorkspace(selected.id, {
        name: metaName.trim(),
        description: metaDescription.trim() || null,
      });
      setEditingMeta(false);
    });
  }

  async function addBookmark(event: FormEvent) {
    event.preventDefault();
    if (!selected || !bookmarkId) return;
    await run(async () => {
      await createWorkspaceItem(selected.id, { bookmarkId, openMode: bookmarkMode });
      setBookmarkId("");
      setBookmarkMode("reuse");
    });
  }

  async function addCustom(event: FormEvent) {
    event.preventDefault();
    if (!selected || !customDraft.title.trim() || !customDraft.url.trim()) return;
    await run(async () => {
      await createWorkspaceItem(selected.id, {
        title: customDraft.title.trim(),
        url: customDraft.url.trim(),
        openMode: customDraft.openMode,
      });
      setCustomDraft(emptyItemDraft);
    });
  }

  function beginItemEdit(item: WorkspaceItem) {
    setEditingItemId(item.id);
    setItemDraft({ title: item.title, url: item.url, openMode: item.openMode });
  }

  async function saveItem(event: FormEvent, itemId: string) {
    event.preventDefault();
    if (!selected) return;
    await run(async () => {
      await updateWorkspaceItem(selected.id, itemId, {
        title: itemDraft.title,
        url: itemDraft.url,
        openMode: itemDraft.openMode,
      });
      setEditingItemId(null);
    });
  }

  async function moveItem(item: WorkspaceItem, direction: -1 | 1) {
    if (!selected) return;
    const ordered = [...selected.items].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((candidate) => candidate.id === item.id);
    const other = ordered[index + direction];
    if (!other) return;
    await run(async () => {
      await updateWorkspaceItem(selected.id, item.id, { position: other.position });
      await updateWorkspaceItem(selected.id, other.id, { position: item.position });
    });
  }

  async function openAll() {
    if (!selected) return;
    const ordered = [...selected.items].sort((a, b) => a.position - b.position);

    try {
      const status = await getBridgeStatus();
      if (status.connected) {
        await openWorkspaceWithBridge(ordered.map((item) => ({
          url: item.url,
          openMode: item.openMode,
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
    <section className="management workspace-management">
      <div className="management-heading">
        <div>
          <p className="eyebrow">WORKSPACES</p>
          <h1>Open the same working set<br />from any browser.</h1>
        </div>
        <span className="library-count">{workspaces.length} workspaces</span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="management-grid workspace-grid">
        <aside className="manager-sidebar">
          <div className="form-card">
            <div className="card-heading"><h2>New workspace</h2></div>
            <form className="workspace-create-form" onSubmit={submitWorkspace}>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Development" maxLength={100} />
              <textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="Optional description" maxLength={1000} />
              <button className="primary" disabled={busy || !newName.trim()}>Create</button>
            </form>
          </div>

          <div className="workspace-nav form-card">
            <div className="card-heading"><h2>Your workspaces</h2><span>{workspaces.length}</span></div>
            {workspaces.map((workspace) => (
              <button
                className={`workspace-nav-item ${selected?.id === workspace.id ? "active" : ""}`}
                type="button"
                key={workspace.id}
                onClick={() => onSelectedChange(workspace.id)}
              >
                <span className="workspace-nav-icon">{workspace.icon ?? workspace.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{workspace.name}</strong><small>{workspace.items.length} tabs</small></span>
              </button>
            ))}
            {!loading && !workspaces.length && <p className="empty-copy">Create your first workspace above.</p>}
          </div>
        </aside>

        <div className="manager-main">
          {selected ? (
            <>
              <div className="form-card workspace-header-card">
                {editingMeta ? (
                  <form className="workspace-meta-form" onSubmit={saveMeta}>
                    <input autoFocus value={metaName} onChange={(event) => setMetaName(event.target.value)} maxLength={100} />
                    <textarea value={metaDescription} onChange={(event) => setMetaDescription(event.target.value)} maxLength={1000} placeholder="Description" />
                    <div className="edit-actions">
                      <button className="primary" disabled={busy}>Save</button>
                      <button className="secondary" type="button" onClick={() => setEditingMeta(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="workspace-header-content">
                    <div>
                      <div className="workspace-title-row"><span className="workspace-large-icon">{selected.icon ?? selected.name.slice(0, 1).toUpperCase()}</span><h2>{selected.name}</h2></div>
                      <p>{selected.description ?? "A reusable set of links that stays portable across browsers."}</p>
                    </div>
                    <div className="workspace-header-actions">
                      <button className="primary" type="button" disabled={!selected.items.length} onClick={() => void openAll()}>Open all · {selected.items.length}</button>
                      <button className="secondary" type="button" onClick={beginMetaEdit}>Edit</button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete workspace “${selected.name}” and its items?`)) {
                            void run(async () => {
                              await deleteWorkspace(selected.id);
                              onSelectedChange(null);
                            });
                          }
                        }}
                      >Delete</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="workspace-add-grid">
                <form className="form-card workspace-add-card" onSubmit={addBookmark}>
                  <div className="card-heading"><div><h2>Add saved bookmark</h2><p>Keep the item linked to an existing Dockmark bookmark.</p></div></div>
                  <select value={bookmarkId} onChange={(event) => setBookmarkId(event.target.value)}>
                    <option value="">Select bookmark…</option>
                    {bookmarks.map((bookmark) => <option key={bookmark.id} value={bookmark.id}>{bookmark.title} · {bookmark.url}</option>)}
                  </select>
                  <select value={bookmarkMode} onChange={(event) => setBookmarkMode(event.target.value as WorkspaceOpenMode)}>
                    <option value="reuse">Reuse if possible</option>
                    <option value="new-tab">Always new tab</option>
                    <option value="pinned">Pinned when extension is available</option>
                  </select>
                  <button className="secondary" disabled={busy || !bookmarkId}>Add bookmark</button>
                </form>

                <form className="form-card workspace-add-card" onSubmit={addCustom}>
                  <div className="card-heading"><div><h2>Add custom URL</h2><p>Useful for URLs you do not want in the main bookmark library.</p></div></div>
                  <input value={customDraft.title} onChange={(event) => setCustomDraft({ ...customDraft, title: event.target.value })} placeholder="Local dashboard" />
                  <input value={customDraft.url} onChange={(event) => setCustomDraft({ ...customDraft, url: event.target.value })} placeholder="localhost:3000" inputMode="url" />
                  <select value={customDraft.openMode} onChange={(event) => setCustomDraft({ ...customDraft, openMode: event.target.value as WorkspaceOpenMode })}>
                    <option value="reuse">Reuse if possible</option>
                    <option value="new-tab">Always new tab</option>
                    <option value="pinned">Pinned when extension is available</option>
                  </select>
                  <button className="secondary" disabled={busy || !customDraft.title.trim() || !customDraft.url.trim()}>Add URL</button>
                </form>
              </div>

              <div className="workspace-items">
                {[...selected.items].sort((a, b) => a.position - b.position).map((item, index, ordered) => (
                  <article className="workspace-item-card" key={item.id}>
                    {editingItemId === item.id ? (
                      <form className="workspace-item-edit" onSubmit={(event) => saveItem(event, item.id)}>
                        <input value={itemDraft.title} onChange={(event) => setItemDraft({ ...itemDraft, title: event.target.value })} />
                        <input value={itemDraft.url} onChange={(event) => setItemDraft({ ...itemDraft, url: event.target.value })} inputMode="url" />
                        <select value={itemDraft.openMode} onChange={(event) => setItemDraft({ ...itemDraft, openMode: event.target.value as WorkspaceOpenMode })}>
                          <option value="reuse">Reuse if possible</option>
                          <option value="new-tab">Always new tab</option>
                          <option value="pinned">Pinned when extension is available</option>
                        </select>
                        <div className="edit-actions"><button className="primary" disabled={busy}>Save</button><button className="secondary" type="button" onClick={() => setEditingItemId(null)}>Cancel</button></div>
                      </form>
                    ) : (
                      <>
                        <div className="workspace-item-index">{String(index + 1).padStart(2, "0")}</div>
                        <div className="workspace-item-copy">
                          <a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a>
                          <small>{item.url}</small>
                          <div className="workspace-item-meta">
                            <span>{openModeLabel(item.openMode)}</span>
                            <span>{item.bookmarkId ? "Saved bookmark" : "Custom URL"}</span>
                            {item.healthPolicy === "local-only" && <span>Local only</span>}
                          </div>
                        </div>
                        <div className="workspace-item-actions">
                          <button className="text-action" type="button" disabled={index === 0 || busy} onClick={() => void moveItem(item, -1)}>↑</button>
                          <button className="text-action" type="button" disabled={index === ordered.length - 1 || busy} onClick={() => void moveItem(item, 1)}>↓</button>
                          <button className="secondary" type="button" onClick={() => beginItemEdit(item)}>Edit</button>
                          <button className="danger-button" type="button" onClick={() => { if (window.confirm(`Remove “${item.title}” from this workspace?`)) void run(() => deleteWorkspaceItem(selected.id, item.id)); }}>Remove</button>
                        </div>
                      </>
                    )}
                  </article>
                ))}

                {!selected.items.length && <div className="empty-state"><strong>This workspace is empty.</strong><span>Add a saved bookmark or custom URL above.</span></div>}
              </div>
              <p className="workspace-web-note">Web mode opens normal tabs. When the browser bridge is connected, “Reuse” and “Pinned” are applied by the extension.</p>
            </>
          ) : (
            <div className="empty-state workspace-empty"><strong>No workspace selected.</strong><span>Create one to save a reusable group of tabs.</span></div>
          )}
        </div>
      </div>
    </section>
  );
}
