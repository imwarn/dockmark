import { useMemo, useState } from "react";
import {
  normalizeBookmarkUrl,
  type Bookmark,
  type Category,
} from "@dockmark/core";
import { createBookmark, createCategory } from "./api";
import {
  getBridgeStatus,
  getNativeBookmarksWithBridge,
  saveNativeBookmarkMappingsWithBridge,
  type NativeBookmarkMapping,
  type NativeBrowserBookmark,
} from "./browser-bridge";
import { buildImportPreview, type ImportCandidate } from "./bookmark-transfer";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
}

interface NativeImportCandidate extends ImportCandidate {
  browserBookmarkId: string;
  folderPath: string[];
  existingBookmarkId?: string;
  mappedDockmarkBookmarkId?: string;
}

function categoryKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function folderCategory(path: string[]) {
  const cleaned = path.map((part) => part.trim()).filter(Boolean);
  if (!cleaned.length) return undefined;
  const joined = cleaned.join(" / ");
  return joined.length <= 80 ? joined : `…${joined.slice(-79)}`;
}

function existingByUrl(bookmarks: Bookmark[]) {
  const map = new Map<string, Bookmark>();
  for (const bookmark of bookmarks) {
    try {
      map.set(normalizeBookmarkUrl(bookmark.url), bookmark);
    } catch {
      // Existing Dockmark data should already be normalized; ignore malformed legacy rows.
    }
  }
  return map;
}

function mappingIsCurrent(
  mapping: NativeBookmarkMapping | undefined,
  native: NativeBrowserBookmark,
  cloud: Bookmark | undefined,
) {
  if (!mapping || !cloud || mapping.browserBookmarkId !== native.id) return false;
  try {
    return normalizeBookmarkUrl(mapping.url) === normalizeBookmarkUrl(native.url) &&
      normalizeBookmarkUrl(cloud.url) === normalizeBookmarkUrl(native.url);
  } catch {
    return false;
  }
}

function buildNativePreview(
  nativeBookmarks: NativeBrowserBookmark[],
  mappings: NativeBookmarkMapping[],
  cloudBookmarks: Bookmark[],
) {
  const parsed = nativeBookmarks.map((bookmark) => ({
    title: bookmark.title || bookmark.url,
    url: bookmark.url,
    ...(folderCategory(bookmark.folderPath) ? { categoryName: folderCategory(bookmark.folderPath) } : {}),
  }));
  const base = buildImportPreview(parsed, cloudBookmarks);
  const cloudByUrl = existingByUrl(cloudBookmarks);
  const cloudById = new Map(cloudBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const mappingByNativeId = new Map(mappings.map((mapping) => [mapping.browserBookmarkId, mapping]));

  return base.map((candidate, index): NativeImportCandidate => {
    const native = nativeBookmarks[index];
    if (!native) throw new Error("Browser bookmark snapshot changed while building the preview.");
    const existing = candidate.normalizedUrl ? cloudByUrl.get(candidate.normalizedUrl) : undefined;
    const mapping = mappingByNativeId.get(native.id);
    const mapped = mappingIsCurrent(mapping, native, mapping ? cloudById.get(mapping.dockmarkBookmarkId) : undefined)
      ? mapping
      : undefined;

    return {
      ...candidate,
      browserBookmarkId: native.id,
      folderPath: native.folderPath,
      selected: candidate.status !== "invalid" && !mapped,
      ...(existing ? { existingBookmarkId: existing.id } : {}),
      ...(mapped ? { mappedDockmarkBookmarkId: mapped.dockmarkBookmarkId } : {}),
    };
  });
}

export function NativeBookmarkImport({ bookmarks, categories, onChanged }: Props) {
  const [items, setItems] = useState<NativeImportCandidate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const stats = useMemo(() => {
    const selected = items.filter((item) => item.selected && item.status !== "invalid" && !item.mappedDockmarkBookmarkId);
    const selectedUrls = new Set(selected.flatMap((item) => item.normalizedUrl ? [item.normalizedUrl] : []));
    const cloudUrls = existingByUrl(bookmarks);
    const newUrls = Array.from(selectedUrls).filter((url) => !cloudUrls.has(url));
    return {
      total: items.length,
      selected: selected.length,
      newCloud: newUrls.length,
      linkExisting: selectedUrls.size - newUrls.length,
      mapped: items.filter((item) => Boolean(item.mappedDockmarkBookmarkId)).length,
      local: items.filter((item) => item.healthPolicy === "local-only").length,
      invalid: items.filter((item) => item.status === "invalid").length,
    };
  }, [bookmarks, items]);

  async function loadNativeBookmarks() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const bridge = await getBridgeStatus();
      if (!bridge.capabilities.nativeBookmarks) {
        throw new Error("This Dockmark extension is too old for native bookmark import. Update it and reconnect.");
      }
      if (!bridge.permissions?.nativeBookmarks) {
        throw new Error("Open the Dockmark extension popup and enable Native bookmarks, then try again.");
      }

      const snapshot = await getNativeBookmarksWithBridge();
      setItems(buildNativePreview(snapshot.bookmarks, snapshot.mappings, bookmarks));
      setLoaded(true);
      setMessage(`Read ${snapshot.bookmarks.length} browser bookmarks. Nothing has been changed yet.`);
    } catch (caught) {
      setLoaded(false);
      setItems([]);
      setError(caught instanceof Error ? caught.message : "Could not read browser bookmarks.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(browserBookmarkId: string) {
    setItems((current) => current.map((item) =>
      item.browserBookmarkId === browserBookmarkId && item.status !== "invalid" && !item.mappedDockmarkBookmarkId
        ? { ...item, selected: !item.selected }
        : item,
    ));
  }

  function selectAll(selected: boolean) {
    setItems((current) => current.map((item) =>
      item.status !== "invalid" && !item.mappedDockmarkBookmarkId ? { ...item, selected } : item,
    ));
  }

  async function importSelected() {
    const selected = items.filter((item) =>
      item.selected && item.status !== "invalid" && !item.mappedDockmarkBookmarkId && item.normalizedUrl,
    );
    if (!selected.length) return;

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const cloudByUrl = existingByUrl(bookmarks);
      const categoryMap = new Map(categories.map((category) => [categoryKey(category.name), category.id]));
      const grouped = new Map<string, NativeImportCandidate[]>();

      for (const item of selected) {
        const url = item.normalizedUrl;
        if (!url) continue;
        const group = grouped.get(url) ?? [];
        group.push(item);
        grouped.set(url, group);
      }

      const requiredCategories = new Set<string>();
      for (const [url, group] of grouped) {
        if (cloudByUrl.has(url)) continue;
        const categoryName = group[0]?.categoryName?.trim();
        if (categoryName) requiredCategories.add(categoryName);
      }

      for (const name of requiredCategories) {
        const key = categoryKey(name);
        if (categoryMap.has(key)) continue;
        const storedName = name.length <= 80 ? name : `…${name.slice(-79)}`;
        const category = await createCategory({ name: storedName });
        categoryMap.set(key, category.id);
      }

      const successfulMappings: Array<{
        browserBookmarkId: string;
        dockmarkBookmarkId: string;
        url: string;
      }> = [];
      const mappedByNativeId = new Map<string, string>();
      let created = 0;
      let linkedExisting = 0;
      let failedGroups = 0;

      for (const [url, group] of grouped) {
        try {
          let target = cloudByUrl.get(url);
          if (!target) {
            const representative = group[0];
            if (!representative) continue;
            target = await createBookmark({
              title: representative.title.slice(0, 200),
              url,
              categoryId: representative.categoryName
                ? categoryMap.get(categoryKey(representative.categoryName)) ?? null
                : null,
              ...(representative.description ? { description: representative.description.slice(0, 2000) } : {}),
              ...(representative.iconUrl ? { iconUrl: representative.iconUrl.slice(0, 4096) } : {}),
              ...(representative.healthPolicy ? { healthPolicy: representative.healthPolicy } : {}),
            });
            cloudByUrl.set(url, target);
            created += 1;
          } else {
            linkedExisting += 1;
          }

          for (const item of group) {
            successfulMappings.push({
              browserBookmarkId: item.browserBookmarkId,
              dockmarkBookmarkId: target.id,
              url: item.normalizedUrl ?? item.url,
            });
            mappedByNativeId.set(item.browserBookmarkId, target.id);
          }
        } catch {
          failedGroups += 1;
        }
      }

      if (successfulMappings.length) {
        await saveNativeBookmarkMappingsWithBridge(successfulMappings);
      }
      await onChanged();

      setItems((current) => current.map((item) => {
        const mappedId = mappedByNativeId.get(item.browserBookmarkId);
        return mappedId
          ? { ...item, selected: false, mappedDockmarkBookmarkId: mappedId, existingBookmarkId: mappedId }
          : item;
      }));
      setMessage(
        `Mapped ${successfulMappings.length} browser bookmark${successfulMappings.length === 1 ? "" : "s"}: ` +
        `${created} new Dockmark bookmark${created === 1 ? "" : "s"}, ${linkedExisting} existing URL${linkedExisting === 1 ? "" : "s"}` +
        `${failedGroups ? `; ${failedGroups} URL group${failedGroups === 1 ? "" : "s"} failed` : ""}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Native bookmark import failed.");
    } finally {
      setBusy(false);
    }
  }

  function statusLabel(item: NativeImportCandidate) {
    if (item.mappedDockmarkBookmarkId) return "MAPPED";
    if (item.status === "invalid") return "INVALID";
    if (item.existingBookmarkId) return "LINK";
    if (item.status === "duplicate") return "DEDUP";
    if (item.healthPolicy === "local-only") return "LOCAL ONLY";
    return "NEW";
  }

  return (
    <>
      <article className="form-card native-import-card">
        <div className="card-heading">
          <div>
            <h2>Browser bookmarks</h2>
            <p>Read the connected browser directly, review everything, then import and keep a local native↔Dockmark mapping.</p>
          </div>
          <span className="native-readonly">READ-ONLY</span>
        </div>
        <div className="native-import-actions">
          <button className="secondary" type="button" disabled={busy} onClick={() => void loadNativeBookmarks()}>
            {busy && !loaded ? "Reading…" : loaded ? "Refresh browser bookmarks" : "Read browser bookmarks"}
          </button>
          <span>The extension never edits or deletes native bookmarks in this version.</span>
        </div>
      </article>

      {error && <div className="error-banner transfer-feedback" role="alert">{error}</div>}
      {message && <div className="success-banner transfer-feedback" role="status">{message}</div>}

      {loaded && items.length > 0 && (
        <section className="import-preview native-import-preview">
          <div className="preview-heading">
            <div><p className="eyebrow">BROWSER IMPORT PREVIEW</p><h2>Native bookmark tree</h2></div>
            <div className="preview-actions">
              <button className="text-action" type="button" onClick={() => selectAll(true)}>Select unmapped</button>
              <button className="text-action muted-action" type="button" onClick={() => selectAll(false)}>Clear</button>
              <button className="primary" type="button" onClick={() => void importSelected()} disabled={busy || !stats.selected}>
                {busy ? "Importing…" : `Import / map ${stats.selected}`}
              </button>
            </div>
          </div>

          <div className="import-stats native-stats">
            <span><strong>{stats.total}</strong>Total</span>
            <span><strong>{stats.newCloud}</strong>New URLs</span>
            <span><strong>{stats.linkExisting}</strong>Link URLs</span>
            <span><strong>{stats.mapped}</strong>Mapped</span>
            <span><strong>{stats.local}</strong>Local only</span>
            <span><strong>{stats.invalid}</strong>Invalid</span>
          </div>

          <div className="import-list">
            {items.slice(0, 500).map((item) => (
              <label className={`import-row ${item.mappedDockmarkBookmarkId ? "status-mapped" : `status-${item.status}`}`} key={item.browserBookmarkId}>
                <input
                  type="checkbox"
                  checked={item.selected}
                  disabled={item.status === "invalid" || Boolean(item.mappedDockmarkBookmarkId) || busy}
                  onChange={() => toggle(item.browserBookmarkId)}
                />
                <span className="import-copy">
                  <strong>{item.title}</strong>
                  <small>{item.normalizedUrl ?? item.url}</small>
                  <span>{item.categoryName ?? "Uncategorized"}</span>
                </span>
                <span className={`import-status policy-${item.healthPolicy ?? "none"}`}>{statusLabel(item)}</span>
              </label>
            ))}
          </div>
          {items.length > 500 && <p className="preview-limit">Showing the first 500 of {items.length} browser entries; selected hidden entries are still included.</p>}
        </section>
      )}

      {loaded && !items.length && <div className="success-banner transfer-feedback">No HTTP/HTTPS browser bookmarks were found.</div>}
    </>
  );
}
