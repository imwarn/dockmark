/**
 * [INPUT]: depends on WorkspaceWithItems, WorkspaceItem, WorkspaceOpenMode, Bookmark, HEALTH_POLICY_LABELS from @dockmark/core; workspace CRUD from ./api; bridge launcher from ./browser-bridge; BookmarkFavicon and safeDomainLabel from ./BookmarkFavicon; useI18n from ./i18n
 * [OUTPUT]: exports WorkspaceManager component for managing reusable cross-browser tab sets
 * [POS]: workspace management tool surface in apps/web/src, paired with workspaces.css
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  HEALTH_POLICY_LABELS,
  type Bookmark,
  type WorkspaceItem,
  type WorkspaceOpenMode,
  type WorkspaceWithItems,
} from "@dockmark/core";
import {
  createWorkspace,
  createWorkspaceItem,
  deleteWorkspace,
  deleteWorkspaceItem,
  updateWorkspace,
  updateWorkspaceItem,
} from "./api";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import { getBridgeStatus, openWorkspaceWithBridge } from "./browser-bridge";
import { useI18n } from "./i18n";

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

export function WorkspaceManager({
  workspaces,
  bookmarks,
  loading,
  selectedWorkspaceId,
  onSelectedChange,
  onChanged,
}: Props) {
  const { locale, tx } = useI18n();
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

  const bookmarkById = useMemo(
    () => new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark])),
    [bookmarks],
  );

  const totalTabs = useMemo(
    () => workspaces.reduce((sum, workspace) => sum + workspace.items.length, 0),
    [workspaces],
  );

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces[0]) onSelectedChange(workspaces[0].id);
    if (selectedWorkspaceId && !workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      onSelectedChange(workspaces[0]?.id ?? null);
    }
  }, [onSelectedChange, selectedWorkspaceId, workspaces]);

  function messageFrom(caught: unknown) {
    return caught instanceof Error ? caught.message : tx("Something went wrong.", "操作失败，请稍后重试。");
  }

  function openModeLabel(mode: WorkspaceOpenMode) {
    if (mode === "new-tab") return tx("New tab", "新建标签页");
    if (mode === "pinned") return tx("Pinned · extension", "固定 · 扩展");
    return tx("Reuse if possible", "尽量复用");
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

  const orderedItems = useMemo(
    () => (selected ? [...selected.items].sort((a, b) => a.position - b.position) : []),
    [selected],
  );

  return (
    <section className="management workspace-management">
      <header className="workspace-tool-header">
        <div className="workspace-tool-copy">
          <h1>{tx("Workspaces", "工作区")}</h1>
          <p>{tx("Open reusable tab sets across any browser.", "跨浏览器一键打开可复用的标签页组。")}</p>
        </div>
        <div className="workspace-tool-pills">
          <span className="library-count">
            {tx(
              `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`,
              `${workspaces.length} 个工作区`,
            )}
          </span>
          <span className="library-count">
            {tx(`${totalTabs} tab${totalTabs === 1 ? "" : "s"}`, `${totalTabs} 个标签页`)}
          </span>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="management-grid workspace-grid">
        <aside className="manager-sidebar">
          <div className="form-card">
            <div className="card-heading"><h2>{tx("New workspace", "新建工作区")}</h2></div>
            <form className="workspace-create-form" onSubmit={submitWorkspace}>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={tx("Development", "开发环境")}
                aria-label={tx("Workspace name", "工作区名称")}
                maxLength={100}
              />
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder={tx("Optional description", "可选描述")}
                aria-label={tx("Workspace description", "工作区描述")}
                maxLength={1000}
              />
              <button className="primary" disabled={busy || !newName.trim()}>{tx("Create", "创建")}</button>
            </form>
          </div>

          <div className="workspace-nav form-card">
            <div className="card-heading">
              <h2>{tx("Your workspaces", "我的工作区")}</h2>
              <span>{workspaces.length}</span>
            </div>
            {workspaces.map((workspace) => (
              <button
                className={`workspace-nav-item ${selected?.id === workspace.id ? "active" : ""}`}
                type="button"
                key={workspace.id}
                onClick={() => onSelectedChange(workspace.id)}
              >
                <span className="workspace-nav-icon">{workspace.icon ?? workspace.name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{workspace.name}</strong>
                  <small>
                    {tx(
                      `${workspace.items.length} tab${workspace.items.length === 1 ? "" : "s"}`,
                      `${workspace.items.length} 个标签页`,
                    )}
                  </small>
                </span>
              </button>
            ))}
            {!loading && !workspaces.length && (
              <p className="empty-copy">{tx("Create your first workspace above.", "请在上方创建你的第一个工作区。")}</p>
            )}
          </div>
        </aside>

        <div className="manager-main">
          {selected ? (
            <>
              <div className="form-card workspace-header-card">
                {editingMeta ? (
                  <form className="workspace-meta-form" onSubmit={saveMeta}>
                    <input
                      autoFocus
                      value={metaName}
                      onChange={(event) => setMetaName(event.target.value)}
                      placeholder={tx("Workspace name", "工作区名称")}
                      maxLength={100}
                    />
                    <textarea
                      value={metaDescription}
                      onChange={(event) => setMetaDescription(event.target.value)}
                      maxLength={1000}
                      placeholder={tx("Description", "描述")}
                    />
                    <div className="edit-actions">
                      <button className="primary" disabled={busy}>{tx("Save", "保存")}</button>
                      <button className="secondary" type="button" onClick={() => setEditingMeta(false)}>
                        {tx("Cancel", "取消")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="workspace-header-content">
                    <div className="workspace-header-lead">
                      <div className="workspace-title-row">
                        <span className="workspace-large-icon">
                          {selected.icon ?? selected.name.slice(0, 1).toUpperCase()}
                        </span>
                        <h2>{selected.name}</h2>
                      </div>
                      <p>
                        {selected.description ??
                          tx(
                            "A reusable set of links that stays portable across browsers.",
                            "可在不同浏览器间随时打开的固定链接集合。",
                          )}
                      </p>
                    </div>
                    <div className="workspace-header-actions">
                      <button
                        className="primary"
                        type="button"
                        disabled={!selected.items.length}
                        onClick={() => void openAll()}
                      >
                        {tx(`Open all · ${selected.items.length}`, `全部打开 · ${selected.items.length}`)}
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
                              tx(
                                `Delete workspace “${selected.name}” and its items?`,
                                `确定删除工作区“${selected.name}”及其全部条目吗？`,
                              ),
                            )
                          ) {
                            void run(async () => {
                              await deleteWorkspace(selected.id);
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

              <div className="workspace-add-grid">
                <form className="form-card workspace-add-card" onSubmit={addBookmark}>
                  <div className="card-heading">
                    <div>
                      <h2>{tx("Add saved bookmark", "添加已保存书签")}</h2>
                      <p>{tx("Link an existing Dockmark bookmark to this workspace.", "将书签库中的已有书签加入当前工作区。")}</p>
                    </div>
                  </div>
                  <select
                    value={bookmarkId}
                    onChange={(event) => setBookmarkId(event.target.value)}
                    aria-label={tx("Select bookmark", "选择书签")}
                  >
                    <option value="">{tx("Select bookmark…", "选择书签…")}</option>
                    {bookmarks.map((bookmark) => (
                      <option key={bookmark.id} value={bookmark.id}>
                        {bookmark.title} · {bookmark.url}
                      </option>
                    ))}
                  </select>
                  <select
                    value={bookmarkMode}
                    onChange={(event) => setBookmarkMode(event.target.value as WorkspaceOpenMode)}
                    aria-label={tx("Open mode", "打开方式")}
                  >
                    <option value="reuse">{tx("Reuse if possible", "尽量复用已有标签页")}</option>
                    <option value="new-tab">{tx("Always new tab", "始终新建标签页")}</option>
                    <option value="pinned">{tx("Pinned when extension is available", "扩展可用时固定标签页")}</option>
                  </select>
                  <button className="secondary" disabled={busy || !bookmarkId}>
                    {tx("Add bookmark", "添加书签")}
                  </button>
                </form>

                <form className="form-card workspace-add-card" onSubmit={addCustom}>
                  <div className="card-heading">
                    <div>
                      <h2>{tx("Add custom URL", "添加自定义链接")}</h2>
                      <p>{tx("Useful for URLs you do not want in the main bookmark library.", "适合不需要放进主书签库的临时或本地链接。")}</p>
                    </div>
                  </div>
                  <input
                    value={customDraft.title}
                    onChange={(event) => setCustomDraft({ ...customDraft, title: event.target.value })}
                    placeholder={tx("Local dashboard", "本地控制台")}
                  />
                  <input
                    value={customDraft.url}
                    onChange={(event) => setCustomDraft({ ...customDraft, url: event.target.value })}
                    placeholder="localhost:3000"
                    inputMode="url"
                  />
                  <select
                    value={customDraft.openMode}
                    onChange={(event) => setCustomDraft({ ...customDraft, openMode: event.target.value as WorkspaceOpenMode })}
                    aria-label={tx("Open mode", "打开方式")}
                  >
                    <option value="reuse">{tx("Reuse if possible", "尽量复用已有标签页")}</option>
                    <option value="new-tab">{tx("Always new tab", "始终新建标签页")}</option>
                    <option value="pinned">{tx("Pinned when extension is available", "扩展可用时固定标签页")}</option>
                  </select>
                  <button
                    className="secondary"
                    disabled={busy || !customDraft.title.trim() || !customDraft.url.trim()}
                  >
                    {tx("Add URL", "添加链接")}
                  </button>
                </form>
              </div>

              <div className="workspace-items">
                {orderedItems.map((item, index) => {
                  const linkedBookmark = item.bookmarkId ? bookmarkById.get(item.bookmarkId) : undefined;
                  return (
                    <article className="workspace-item-card" key={item.id}>
                      {editingItemId === item.id ? (
                        <form className="workspace-item-edit" onSubmit={(event) => saveItem(event, item.id)}>
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
                          <select
                            value={itemDraft.openMode}
                            onChange={(event) => setItemDraft({ ...itemDraft, openMode: event.target.value as WorkspaceOpenMode })}
                          >
                            <option value="reuse">{tx("Reuse if possible", "尽量复用已有标签页")}</option>
                            <option value="new-tab">{tx("Always new tab", "始终新建标签页")}</option>
                            <option value="pinned">{tx("Pinned when extension is available", "扩展可用时固定标签页")}</option>
                          </select>
                          <div className="edit-actions">
                            <button className="primary" disabled={busy}>{tx("Save", "保存")}</button>
                            <button className="secondary" type="button" onClick={() => setEditingItemId(null)}>
                              {tx("Cancel", "取消")}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="workspace-item-index">{String(index + 1).padStart(2, "0")}</div>
                          <BookmarkFavicon
                            iconUrl={linkedBookmark?.iconUrl ?? null}
                            title={item.title}
                            url={item.url}
                            className="workspace-item-favicon"
                          />
                          <div className="workspace-item-copy">
                            <a href={item.url} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a>
                            <small title={item.url}>{item.url}</small>
                            <div className="workspace-item-meta">
                              <span className="workspace-domain-pill">{safeDomainLabel(item.url)}</span>
                              <span className={`workspace-mode-pill mode-${item.openMode}`}>{openModeLabel(item.openMode)}</span>
                              <span>{item.bookmarkId ? tx("Saved bookmark", "已保存书签") : tx("Custom URL", "自定义链接")}</span>
                              {item.healthPolicy === "local-only" && (
                                <span className="workspace-local-pill">{HEALTH_POLICY_LABELS[locale]["local-only"]}</span>
                              )}
                            </div>
                          </div>
                          <div className="workspace-item-actions">
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
                                      `Remove “${item.title}” from this workspace?`,
                                      `确定从当前工作区移除“${item.title}”吗？`,
                                    ),
                                  )
                                ) {
                                  void run(() => deleteWorkspaceItem(selected.id, item.id));
                                }
                              }}
                            >
                              {tx("Remove", "移除")}
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}

                {!orderedItems.length && (
                  <div className="empty-state">
                    <strong>{tx("This workspace is empty.", "该工作区暂无条目。")}</strong>
                    <span>{tx("Add a saved bookmark or custom URL above.", "请在上方添加已保存书签或自定义链接。")}</span>
                  </div>
                )}
              </div>
              <p className="workspace-web-note">
                {tx(
                  "Web mode opens normal tabs. When the Browser Bridge is connected, “Reuse” and “Pinned” are applied by the extension.",
                  "网页模式会以普通标签页打开；连接浏览器桥接后，扩展会自动应用“复用”与“固定”模式。",
                )}
              </p>
            </>
          ) : (
            <div className="empty-state workspace-empty">
              <strong>{tx("No workspace selected.", "未选择工作区。")}</strong>
              <span>{tx("Create one to save a reusable group of tabs.", "创建一个工作区以保存可复用的标签页组。")}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
