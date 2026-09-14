import { useMemo, useState, type ChangeEvent } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { createBookmark, createCategory } from "./api";
import {
  buildImportPreview,
  downloadTextFile,
  makeDockmarkJson,
  makeNetscapeHtml,
  parseBookmarkFile,
  type ImportCandidate,
} from "./bookmark-transfer";
import { NativeBookmarkImport } from "./NativeBookmarkImport";
import "./transfer.css";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
  onOpenExtension: () => void;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function categoryKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function TransferManager({ bookmarks, categories, onChanged, onOpenExtension }: Props) {
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stats = useMemo(() => ({
    total: items.length,
    fresh: items.filter((item) => item.status === "new").length,
    duplicate: items.filter((item) => item.status === "duplicate").length,
    invalid: items.filter((item) => item.status === "invalid").length,
    local: items.filter((item) => item.healthPolicy === "local-only").length,
    selected: items.filter((item) => item.status === "new" && item.selected).length,
  }), [items]);

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      const parsed = parseBookmarkFile(file.name, text);
      if (!parsed.length) throw new Error("No bookmarks were found in this file.");
      setItems(buildImportPreview(parsed, bookmarks));
      setFileName(file.name);
    } catch (caught) {
      setItems([]);
      setFileName(file.name);
      setError(caught instanceof Error ? caught.message : "Could not read this bookmark file.");
    }
  }

  function toggle(id: string) {
    setItems((current) => current.map((item) =>
      item.id === id && item.status === "new" ? { ...item, selected: !item.selected } : item,
    ));
  }

  function selectAll(selected: boolean) {
    setItems((current) => current.map((item) =>
      item.status === "new" ? { ...item, selected } : item,
    ));
  }

  async function importSelected() {
    const selected = items.filter((item) => item.status === "new" && item.selected && item.normalizedUrl);
    if (!selected.length) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const categoryMap = new Map(categories.map((category) => [categoryKey(category.name), category.id]));
      const requiredCategories = Array.from(new Set(
        selected.map((item) => item.categoryName?.trim()).filter((name): name is string => Boolean(name)),
      ));

      for (const name of requiredCategories) {
        const key = categoryKey(name);
        if (categoryMap.has(key)) continue;
        const storedName = name.length <= 80 ? name : `…${name.slice(-79)}`;
        const category = await createCategory({ name: storedName });
        categoryMap.set(key, category.id);
      }

      let imported = 0;
      let failed = 0;
      const failedIds = new Set<string>();
      const chunkSize = 8;

      for (let offset = 0; offset < selected.length; offset += chunkSize) {
        const chunk = selected.slice(offset, offset + chunkSize);
        const results = await Promise.allSettled(chunk.map((item) => createBookmark({
          title: item.title.slice(0, 200),
          url: item.normalizedUrl ?? item.url,
          categoryId: item.categoryName ? categoryMap.get(categoryKey(item.categoryName)) ?? null : null,
          ...(item.description ? { description: item.description.slice(0, 2000) } : {}),
          ...(item.iconUrl ? { iconUrl: item.iconUrl.slice(0, 4096) } : {}),
          ...(item.healthPolicy ? { healthPolicy: item.healthPolicy } : {}),
        })));

        results.forEach((result, index) => {
          const item = chunk[index];
          if (!item) return;
          if (result.status === "fulfilled") imported += 1;
          else {
            failed += 1;
            failedIds.add(item.id);
          }
        });
      }

      await onChanged();
      setMessage(`Imported ${imported} bookmark${imported === 1 ? "" : "s"}${failed ? `; ${failed} failed` : ""}.`);
      if (failed) {
        setItems((current) => current.filter((item) => failedIds.has(item.id) || item.status !== "new"));
      } else {
        setItems([]);
        setFileName(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  function exportJson() {
    downloadTextFile(`dockmark-${dateStamp()}.json`, makeDockmarkJson(categories, bookmarks), "application/json");
  }

  function exportHtml() {
    downloadTextFile(`dockmark-${dateStamp()}.html`, makeNetscapeHtml(categories, bookmarks), "text/html");
  }

  return (
    <section className="transfer-page">
      <div className="management-heading">
        <div>
          <p className="eyebrow">MOVE WITHOUT LOCK-IN</p>
          <h1>Bring bookmarks in.<br />Take them anywhere.</h1>
        </div>
        <span className="library-count">{bookmarks.length} stored</span>
      </div>

      <NativeBookmarkImport bookmarks={bookmarks} categories={categories} onChanged={onChanged} onOpenExtension={onOpenExtension} />

      <div className="transfer-grid">
        <article className="form-card transfer-card">
          <div className="card-heading"><div><h2>Import file</h2><p>Chrome, Edge, Firefox Netscape HTML or Dockmark / simple JSON.</p></div></div>
          <label className="file-drop">
            <input type="file" accept=".html,.htm,.json,text/html,application/json" onChange={loadFile} />
            <strong>Choose bookmark file</strong>
            <span>Nothing is written until you review and confirm.</span>
          </label>
        </article>

        <article className="form-card transfer-card">
          <div className="card-heading"><div><h2>Export</h2><p>JSON preserves Dockmark metadata; HTML imports into conventional browsers.</p></div></div>
          <div className="export-actions">
            <button className="secondary" type="button" onClick={exportJson} disabled={!bookmarks.length}>Export JSON</button>
            <button className="secondary" type="button" onClick={exportHtml} disabled={!bookmarks.length}>Export HTML</button>
          </div>
        </article>
      </div>

      {error && <div className="error-banner transfer-feedback" role="alert">{error}</div>}
      {message && <div className="success-banner transfer-feedback" role="status">{message}</div>}

      {items.length > 0 && (
        <section className="import-preview">
          <div className="preview-heading">
            <div><p className="eyebrow">FILE IMPORT PREVIEW</p><h2>{fileName}</h2></div>
            <div className="preview-actions">
              <button className="text-action" type="button" onClick={() => selectAll(true)}>Select new</button>
              <button className="text-action muted-action" type="button" onClick={() => selectAll(false)}>Clear</button>
              <button className="primary" type="button" onClick={() => void importSelected()} disabled={busy || !stats.selected}>{busy ? "Importing…" : `Import ${stats.selected}`}</button>
            </div>
          </div>

          <div className="import-stats">
            <span><strong>{stats.total}</strong>Total</span>
            <span><strong>{stats.fresh}</strong>New</span>
            <span><strong>{stats.duplicate}</strong>Duplicate</span>
            <span><strong>{stats.local}</strong>Local only</span>
            <span><strong>{stats.invalid}</strong>Invalid</span>
          </div>

          <div className="import-list">
            {items.slice(0, 500).map((item) => (
              <label className={`import-row status-${item.status}`} key={item.id}>
                <input type="checkbox" checked={item.selected} disabled={item.status !== "new" || busy} onChange={() => toggle(item.id)} />
                <span className="import-copy"><strong>{item.title}</strong><small>{item.normalizedUrl ?? item.url}</small><span>{item.categoryName ?? "Uncategorized"}</span></span>
                <span className={`import-status policy-${item.healthPolicy ?? "none"}`}>{item.status === "new" && item.healthPolicy === "local-only" ? "LOCAL ONLY" : item.status.toUpperCase()}</span>
              </label>
            ))}
          </div>
          {items.length > 500 && <p className="preview-limit">Showing the first 500 of {items.length} entries; all selected entries will still import.</p>}
        </section>
      )}
    </section>
  );
}
