import { useMemo, useState, type FormEvent } from "react";
import type { SearchEngine } from "@dockmark/core";
import {
  createSearchEngine,
  deleteSearchEngine,
  updateSearchEngine,
} from "./api";

interface Props {
  engines: SearchEngine[];
  loading: boolean;
  onChanged: () => Promise<void>;
}

interface Draft {
  name: string;
  keyword: string;
  searchUrl: string;
}

const emptyDraft: Draft = {
  name: "",
  keyword: "",
  searchUrl: "https://example.com/search?q=%s",
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function SearchEngineManager({ engines, loading, onChanged }: Props) {
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...engines].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [engines],
  );

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

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!newDraft.name.trim() || !newDraft.searchUrl.trim()) return;
    await run(async () => {
      await createSearchEngine({
        name: newDraft.name.trim(),
        keyword: newDraft.keyword.trim() || null,
        searchUrl: newDraft.searchUrl.trim(),
      });
      setNewDraft(emptyDraft);
    });
  }

  function beginEdit(engine: SearchEngine) {
    setEditingId(engine.id);
    setEditDraft({
      name: engine.name,
      keyword: engine.keyword ?? "",
      searchUrl: engine.searchUrl,
    });
  }

  async function save(event: FormEvent, engine: SearchEngine) {
    event.preventDefault();
    await run(async () => {
      await updateSearchEngine(engine.id, {
        name: editDraft.name.trim(),
        keyword: editDraft.keyword.trim() || null,
        searchUrl: editDraft.searchUrl.trim(),
      });
      setEditingId(null);
    });
  }

  async function move(engine: SearchEngine, direction: -1 | 1) {
    const index = ordered.findIndex((item) => item.id === engine.id);
    const other = ordered[index + direction];
    if (!other) return;
    await run(async () => {
      await updateSearchEngine(engine.id, { position: other.position });
      await updateSearchEngine(other.id, { position: engine.position });
    });
  }

  return (
    <section className="management search-management">
      <div className="management-heading">
        <div>
          <p className="eyebrow">SEARCH ENGINES</p>
          <h1>Choose where a command<br />should search the web.</h1>
        </div>
        <span className="library-count">{engines.length} engines</span>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="search-settings-grid">
        <form className="form-card search-engine-form" onSubmit={create}>
          <div className="card-heading">
            <div>
              <h2>Add search engine</h2>
              <p>Use <code>%s</code> where the encoded query belongs.</p>
            </div>
          </div>
          <label>Name<input value={newDraft.name} onChange={(event) => setNewDraft({ ...newDraft, name: event.target.value })} placeholder="Kagi" maxLength={80} /></label>
          <label>Bang shortcut<div className="bang-input"><span>!</span><input value={newDraft.keyword} onChange={(event) => setNewDraft({ ...newDraft, keyword: event.target.value })} placeholder="k" maxLength={24} /></div></label>
          <label>Search URL<input value={newDraft.searchUrl} onChange={(event) => setNewDraft({ ...newDraft, searchUrl: event.target.value })} placeholder="https://example.com/search?q=%s" inputMode="url" /></label>
          <button className="primary" disabled={busy || !newDraft.name.trim() || !newDraft.searchUrl.includes("%s")}>Add engine</button>
        </form>

        <div className="search-engine-list">
          {ordered.map((engine, index) => (
            <article className={`form-card search-engine-card ${engine.isDefault ? "default" : ""}`} key={engine.id}>
              {editingId === engine.id ? (
                <form className="search-engine-edit" onSubmit={(event) => save(event, engine)}>
                  <input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} maxLength={80} />
                  <div className="bang-input"><span>!</span><input value={editDraft.keyword} onChange={(event) => setEditDraft({ ...editDraft, keyword: event.target.value })} maxLength={24} /></div>
                  <input value={editDraft.searchUrl} onChange={(event) => setEditDraft({ ...editDraft, searchUrl: event.target.value })} inputMode="url" />
                  <div className="edit-actions">
                    <button className="primary" disabled={busy}>Save</button>
                    <button className="secondary" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="search-engine-main">
                    <div className="search-engine-icon">{engine.name.slice(0, 1).toUpperCase()}</div>
                    <div className="search-engine-copy">
                      <div><strong>{engine.name}</strong>{engine.isDefault && <span className="default-pill">Default</span>}</div>
                      <small>{engine.keyword ? `!${engine.keyword}` : "No bang shortcut"} · {engine.searchUrl}</small>
                    </div>
                  </div>
                  <div className="search-engine-actions">
                    <button className="text-action" type="button" disabled={busy || index === 0} onClick={() => void move(engine, -1)}>↑</button>
                    <button className="text-action" type="button" disabled={busy || index === ordered.length - 1} onClick={() => void move(engine, 1)}>↓</button>
                    {!engine.isDefault && <button className="secondary" type="button" disabled={busy} onClick={() => void run(() => updateSearchEngine(engine.id, { isDefault: true }))}>Make default</button>}
                    <button className="secondary" type="button" onClick={() => beginEdit(engine)}>Edit</button>
                    <button className="danger-button" type="button" disabled={busy || ordered.length <= 1} onClick={() => { if (window.confirm(`Delete search engine “${engine.name}”?`)) void run(() => deleteSearchEngine(engine.id)); }}>Delete</button>
                  </div>
                </>
              )}
            </article>
          ))}
          {!loading && !ordered.length && <div className="empty-state"><strong>No search engine configured.</strong><span>Apply migrations or create one above.</span></div>}
        </div>
      </div>

      <div className="form-card bang-help">
        <h2>Bang shortcuts</h2>
        <p>Type a shortcut followed by a query in the Launcher, for example <kbd>!gh dockmark</kbd>. Type only <kbd>!</kbd> to discover configured shortcuts. Without a bang, Dockmark offers the default engine for the current query.</p>
      </div>
    </section>
  );
}
