/**
 * [INPUT]: depends on SearchEngine from @dockmark/core; search engine CRUD from ./api; BookmarkFavicon and safeDomainLabel from ./BookmarkFavicon; useI18n from ./i18n
 * [OUTPUT]: exports SearchEngineManager component for configuring Launcher web search engines and bang shortcuts
 * [POS]: search engine settings surface in apps/web/src, paired with search-engines.css
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useMemo, useState, type FormEvent } from "react";
import type { SearchEngine } from "@dockmark/core";
import {
  createSearchEngine,
  deleteSearchEngine,
  updateSearchEngine,
} from "./api";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import { useI18n } from "./i18n";

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

export function SearchEngineManager({ engines, loading, onChanged }: Props) {
  const { isZh, tx } = useI18n();
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...engines].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)),
    [engines],
  );

  const defaultEngine = useMemo(
    () => ordered.find((engine) => engine.isDefault) ?? null,
    [ordered],
  );

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
      <header className="search-tool-header">
        <div className="search-tool-copy">
          <h1>{tx("Search Engines", "搜索引擎")}</h1>
          <p>{tx("Configure default web search and !bang shortcuts for the Launcher.", "配置启动器的默认搜索引擎与 ! 快捷词。")}</p>
        </div>
        <div className="search-tool-pills">
          {defaultEngine && (
            <span className="library-count search-default-count">
              {tx(`Default: ${defaultEngine.name}`, `默认：${defaultEngine.name}`)}
            </span>
          )}
          <span className="library-count">
            {tx(`${engines.length} engine${engines.length === 1 ? "" : "s"}`, `${engines.length} 个搜索引擎`)}
          </span>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="search-settings-grid">
        <form className="form-card search-engine-form" onSubmit={create}>
          <div className="card-heading">
            <div>
              <h2>{tx("Add search engine", "添加搜索引擎")}</h2>
              <p>
                {isZh ? (
                  <>在查询词位置使用 <code>%s</code> 占位符。</>
                ) : (
                  <>Use <code>%s</code> where the encoded query belongs.</>
                )}
              </p>
            </div>
          </div>
          <label>
            {tx("Name", "名称")}
            <input
              value={newDraft.name}
              onChange={(event) => setNewDraft({ ...newDraft, name: event.target.value })}
              placeholder="Kagi"
              maxLength={80}
            />
          </label>
          <label>
            {tx("Bang shortcut", "快捷词")}
            <div className="bang-input">
              <span>!</span>
              <input
                value={newDraft.keyword}
                onChange={(event) => setNewDraft({ ...newDraft, keyword: event.target.value })}
                placeholder="k"
                maxLength={24}
              />
            </div>
          </label>
          <label>
            {tx("Search URL", "搜索链接模板")}
            <input
              value={newDraft.searchUrl}
              onChange={(event) => setNewDraft({ ...newDraft, searchUrl: event.target.value })}
              placeholder="https://example.com/search?q=%s"
              inputMode="url"
            />
          </label>
          <button
            className="primary"
            disabled={busy || !newDraft.name.trim() || !newDraft.searchUrl.includes("%s")}
          >
            {tx("Add engine", "添加引擎")}
          </button>
        </form>

        <div className="search-engine-list">
          {ordered.map((engine, index) => {
            const sampleUrl = engine.searchUrl.replace("%s", "query");
            return (
              <article className={`form-card search-engine-card ${engine.isDefault ? "default" : ""}`} key={engine.id}>
                {editingId === engine.id ? (
                  <form className="search-engine-edit" onSubmit={(event) => save(event, engine)}>
                    <input
                      value={editDraft.name}
                      onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
                      placeholder={tx("Name", "名称")}
                      maxLength={80}
                    />
                    <div className="bang-input">
                      <span>!</span>
                      <input
                        value={editDraft.keyword}
                        onChange={(event) => setEditDraft({ ...editDraft, keyword: event.target.value })}
                        placeholder="k"
                        maxLength={24}
                      />
                    </div>
                    <input
                      value={editDraft.searchUrl}
                      onChange={(event) => setEditDraft({ ...editDraft, searchUrl: event.target.value })}
                      placeholder="https://example.com/search?q=%s"
                      inputMode="url"
                    />
                    <div className="edit-actions">
                      <button className="primary" disabled={busy}>{tx("Save", "保存")}</button>
                      <button className="secondary" type="button" onClick={() => setEditingId(null)}>
                        {tx("Cancel", "取消")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="search-engine-main">
                      <BookmarkFavicon
                        iconUrl={null}
                        title={engine.name}
                        url={sampleUrl}
                        className="search-engine-icon"
                      />
                      <div className="search-engine-copy">
                        <div className="search-engine-title-line">
                          <strong>{engine.name}</strong>
                          {engine.isDefault && <span className="default-pill">{tx("Default", "默认")}</span>}
                          {engine.keyword && <span className="keyword-pill">!{engine.keyword}</span>}
                          <span className="search-domain-pill">{safeDomainLabel(sampleUrl)}</span>
                        </div>
                        <small title={engine.searchUrl}>
                          {engine.keyword ? `!${engine.keyword}` : tx("No bang shortcut", "无快捷词")} · {engine.searchUrl}
                        </small>
                      </div>
                    </div>
                    <div className="search-engine-actions">
                      <button
                        className="text-action"
                        type="button"
                        disabled={busy || index === 0}
                        aria-label={tx("Move up", "上移")}
                        title={tx("Move up", "上移")}
                        onClick={() => void move(engine, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="text-action"
                        type="button"
                        disabled={busy || index === ordered.length - 1}
                        aria-label={tx("Move down", "下移")}
                        title={tx("Move down", "下移")}
                        onClick={() => void move(engine, 1)}
                      >
                        ↓
                      </button>
                      {!engine.isDefault && (
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await updateSearchEngine(engine.id, { isDefault: true });
                            })
                          }
                        >
                          {tx("Make default", "设为默认")}
                        </button>
                      )}
                      <button className="secondary" type="button" onClick={() => beginEdit(engine)}>
                        {tx("Edit", "编辑")}
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={busy || ordered.length <= 1}
                        onClick={() => {
                          if (
                            window.confirm(
                              tx(`Delete search engine “${engine.name}”?`, `确定删除搜索引擎“${engine.name}”吗？`),
                            )
                          ) {
                            void run(() => deleteSearchEngine(engine.id));
                          }
                        }}
                      >
                        {tx("Delete", "删除")}
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
          {!loading && !ordered.length && (
            <div className="empty-state">
              <strong>{tx("No search engine configured.", "尚未配置搜索引擎。")}</strong>
              <span>{tx("Apply migrations or create one above.", "请执行数据迁移或在左侧添加一个搜索引擎。")}</span>
            </div>
          )}
        </div>
      </div>

      <div className="form-card bang-help">
        <h2>{tx("Bang shortcuts", "快捷词说明")}</h2>
        <p>
          {isZh ? (
            <>
              在启动器中输入快捷词与关键词即可定向搜索，例如 <kbd>!gh dockmark</kbd>。仅输入 <kbd>!</kbd>{" "}
              可查看所有已配置的快捷词。未输入快捷词时，Dockmark 会使用默认搜索引擎。
            </>
          ) : (
            <>
              Type a shortcut followed by a query in the Launcher, for example <kbd>!gh dockmark</kbd>. Type only{" "}
              <kbd>!</kbd> to discover configured shortcuts. Without a bang, Dockmark offers the default engine for the
              current query.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
