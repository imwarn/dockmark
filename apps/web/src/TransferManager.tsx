/**
 * [INPUT]: depends on Bookmark, Category, HEALTH_POLICY_LABELS from @dockmark/core; bookmark/category/tag CRUD from ./api and ./tag-api; parser/exporter from ./bookmark-transfer; NativeBookmarkImport from ./NativeBookmarkImport; BookmarkFavicon and safeDomainLabel from ./BookmarkFavicon; useI18n from ./i18n
 * [OUTPUT]: exports TransferManager component for file-based import/export and native browser bookmark sync hosting
 * [POS]: import and export tool surface in apps/web/src, paired with transfer.css and NativeBookmarkImport
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useMemo, useState, type ChangeEvent } from "react";
import { HEALTH_POLICY_LABELS, type Bookmark, type Category } from "@dockmark/core";
import { createBookmark, createCategory } from "./api";
import { BookmarkFavicon, safeDomainLabel } from "./BookmarkFavicon";
import {
  buildImportPreview,
  downloadTextFile,
  makeDockmarkJson,
  makeNetscapeHtml,
  parseBookmarkFile,
  type ImportCandidate,
} from "./bookmark-transfer";
import { useI18n } from "./i18n";
import { NativeBookmarkImport } from "./NativeBookmarkImport";
import { listBookmarkTags, replaceBookmarkTags } from "./tag-api";
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
  const { locale, tx } = useI18n();
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

  function candidateStatusLabel(item: ImportCandidate) {
    if (item.status === "new" && item.healthPolicy === "local-only") {
      return HEALTH_POLICY_LABELS[locale]["local-only"];
    }
    if (item.status === "new") return tx("New", "新增");
    if (item.status === "duplicate") return tx("Duplicate", "重复");
    return tx("Invalid", "无效");
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      const parsed = parseBookmarkFile(file.name, text);
      if (!parsed.length) throw new Error(tx("No bookmarks were found in this file.", "该文件中未找到可导入的书签。"));
      setItems(buildImportPreview(parsed, bookmarks));
      setFileName(file.name);
    } catch (caught) {
      setItems([]);
      setFileName(file.name);
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not read this bookmark file.", "无法读取该书签文件。"),
      );
    }
  }

  function toggle(id: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id && item.status === "new" ? { ...item, selected: !item.selected } : item,
      ),
    );
  }

  function selectAll(selected: boolean) {
    setItems((current) =>
      current.map((item) => (item.status === "new" ? { ...item, selected } : item)),
    );
  }

  async function importSelected() {
    const selected = items.filter((item) => item.status === "new" && item.selected && item.normalizedUrl);
    if (!selected.length) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const categoryMap = new Map(categories.map((category) => [categoryKey(category.name), category.id]));
      const requiredCategories = Array.from(
        new Set(
          selected.map((item) => item.categoryName?.trim()).filter((name): name is string => Boolean(name)),
        ),
      );

      for (const name of requiredCategories) {
        const key = categoryKey(name);
        if (categoryMap.has(key)) continue;
        const storedName = name.length <= 80 ? name : `…${name.slice(-79)}`;
        const category = await createCategory({ name: storedName });
        categoryMap.set(key, category.id);
      }

      let imported = 0;
      let failed = 0;
      let tagFailed = 0;
      const failedIds = new Set<string>();
      const chunkSize = 8;

      for (let offset = 0; offset < selected.length; offset += chunkSize) {
        const chunk = selected.slice(offset, offset + chunkSize);
        const results = await Promise.allSettled(
          chunk.map(async (item) => {
            const bookmark = await createBookmark({
              title: item.title.slice(0, 200),
              url: item.normalizedUrl ?? item.url,
              categoryId: item.categoryName ? categoryMap.get(categoryKey(item.categoryName)) ?? null : null,
              ...(item.description ? { description: item.description.slice(0, 2000) } : {}),
              ...(item.iconUrl ? { iconUrl: item.iconUrl.slice(0, 4096) } : {}),
              ...(item.healthPolicy ? { healthPolicy: item.healthPolicy } : {}),
            });
            let tagsStored = true;
            if (item.tags?.length) {
              try {
                await replaceBookmarkTags(bookmark.id, item.tags);
              } catch {
                tagsStored = false;
              }
            }
            return { bookmark, tagsStored };
          }),
        );

        results.forEach((result, index) => {
          const item = chunk[index];
          if (!item) return;
          if (result.status === "fulfilled") {
            imported += 1;
            if (!result.value.tagsStored) tagFailed += 1;
          } else {
            failed += 1;
            failedIds.add(item.id);
          }
        });
      }

      await onChanged();
      setMessage(
        tx(
          `Imported ${imported} bookmark${imported === 1 ? "" : "s"}` +
            `${failed ? `; ${failed} failed` : ""}` +
            `${tagFailed ? `; ${tagFailed} imported but their tags could not be restored` : ""}.`,
          `已导入 ${imported} 条书签` +
            `${failed ? `；${failed} 条失败` : ""}` +
            `${tagFailed ? `；其中 ${tagFailed} 条的标签未能恢复` : ""}。`,
        ),
      );
      if (failed) {
        setItems((current) => current.filter((item) => failedIds.has(item.id) || item.status !== "new"));
      } else {
        setItems([]);
        setFileName(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Import failed.", "导入失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  }

  async function exportJson() {
    setBusy(true);
    setError(null);
    try {
      const bookmarkTags = await listBookmarkTags();
      downloadTextFile(
        `dockmark-${dateStamp()}.json`,
        makeDockmarkJson(categories, bookmarks, bookmarkTags),
        "application/json",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not export Dockmark JSON.", "无法导出 Dockmark JSON 文件。"),
      );
    } finally {
      setBusy(false);
    }
  }

  function exportHtml() {
    downloadTextFile(`dockmark-${dateStamp()}.html`, makeNetscapeHtml(categories, bookmarks), "text/html");
  }

  return (
    <section className="transfer-page">
      <header className="transfer-tool-header">
        <div className="transfer-tool-copy">
          <h1>{tx("Import & Export", "导入导出")}</h1>
          <p>{tx("Bring bookmarks in from browsers or files, and export your library anytime.", "从浏览器或文件导入书签，随时无锁定导出完整书签库。")}</p>
        </div>
        <div className="transfer-tool-pills">
          <span className="library-count">
            {tx(`${bookmarks.length} stored`, `已保存 ${bookmarks.length} 条`)}
          </span>
          <span className="library-count">
            {tx(
              `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`,
              `${categories.length} 个分类`,
            )}
          </span>
        </div>
      </header>

      <NativeBookmarkImport
        bookmarks={bookmarks}
        categories={categories}
        onChanged={onChanged}
        onOpenExtension={onOpenExtension}
      />

      <div className="transfer-grid">
        <article className="form-card transfer-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Import file", "从文件导入")}</h2>
              <p>
                {tx(
                  "Chrome, Edge, Firefox Netscape HTML or Dockmark / simple JSON.",
                  "支持 Chrome、Edge、Firefox 导出的 Netscape HTML，以及 Dockmark / 通用 JSON。",
                )}
              </p>
            </div>
          </div>
          <label className="file-drop">
            <input type="file" accept=".html,.htm,.json,text/html,application/json" onChange={loadFile} />
            <strong>{tx("Choose bookmark file", "选择书签文件")}</strong>
            <span>{tx("Nothing is written until you review and confirm.", "在预览并确认前不会写入任何数据。")}</span>
          </label>
        </article>

        <article className="form-card transfer-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Export", "导出书签库")}</h2>
              <p>
                {tx(
                  "JSON preserves Dockmark metadata and tags; HTML imports into conventional browsers.",
                  "JSON 完整保留 Dockmark 元数据与标签；HTML 可直接导入常见浏览器。",
                )}
              </p>
            </div>
          </div>
          <div className="export-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => void exportJson()}
              disabled={busy || !bookmarks.length}
            >
              {busy ? tx("Preparing…", "正在生成…") : tx("Export JSON", "导出 JSON")}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={exportHtml}
              disabled={busy || !bookmarks.length}
            >
              {tx("Export HTML", "导出 HTML")}
            </button>
          </div>
        </article>
      </div>

      {error && <div className="error-banner transfer-feedback" role="alert">{error}</div>}
      {message && <div className="success-banner transfer-feedback" role="status">{message}</div>}

      {items.length > 0 && (
        <section className="import-preview">
          <div className="preview-heading">
            <div>
              <p className="preview-label">{tx("File import preview", "文件导入预览")}</p>
              <h2>{fileName}</h2>
            </div>
            <div className="preview-actions">
              <button className="text-action" type="button" onClick={() => selectAll(true)}>
                {tx("Select new", "全选新增")}
              </button>
              <button className="text-action muted-action" type="button" onClick={() => selectAll(false)}>
                {tx("Clear", "清空选择")}
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => void importSelected()}
                disabled={busy || !stats.selected}
              >
                {busy ? tx("Importing…", "导入中…") : tx(`Import ${stats.selected}`, `导入 ${stats.selected} 条`)}
              </button>
            </div>
          </div>

          <div className="import-stats">
            <span><strong>{stats.total}</strong>{tx("Total", "总计")}</span>
            <span><strong>{stats.fresh}</strong>{tx("New", "新增")}</span>
            <span><strong>{stats.duplicate}</strong>{tx("Duplicate", "重复")}</span>
            <span><strong>{stats.local}</strong>{HEALTH_POLICY_LABELS[locale]["local-only"]}</span>
            <span><strong>{stats.invalid}</strong>{tx("Invalid", "无效")}</span>
          </div>

          <div className="import-list">
            {items.slice(0, 500).map((item) => {
              const targetUrl = item.normalizedUrl ?? item.url;
              return (
                <label className={`import-row status-${item.status}`} key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.selected}
                    disabled={item.status !== "new" || busy}
                    onChange={() => toggle(item.id)}
                  />
                  <BookmarkFavicon
                    iconUrl={item.iconUrl ?? null}
                    title={item.title}
                    url={targetUrl}
                    className="import-favicon"
                  />
                  <span className="import-copy">
                    <strong>{item.title}</strong>
                    <small title={targetUrl}>{safeDomainLabel(targetUrl)} · {targetUrl}</small>
                    <span>
                      {item.categoryName ?? tx("Uncategorized", "未分类")}
                      {item.tags?.length
                        ? tx(` · Tags: ${item.tags.join(", ")}`, ` · 标签：${item.tags.join("、")}`)
                        : ""}
                    </span>
                  </span>
                  <span className={`import-status policy-${item.healthPolicy ?? "none"}`}>
                    {candidateStatusLabel(item)}
                  </span>
                </label>
              );
            })}
          </div>
          {items.length > 500 && (
            <p className="preview-limit">
              {tx(
                `Showing the first 500 of ${items.length} entries; all selected entries will still import.`,
                `仅展示前 500 条（共 ${items.length} 条）；其余已选条目仍会一并导入。`,
              )}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
