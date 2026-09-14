import { useEffect, useMemo, useState } from "react";
import {
  normalizeBookmarkUrl,
  type Bookmark,
  type Category,
} from "@dockmark/core";
import { createBookmark, createCategory, updateBookmark } from "./api";
import {
  getBridgeStatus,
  getNativeBookmarksWithBridge,
  onBridgeEvent,
  removeNativeBookmarkMappingsWithBridge,
  saveNativeBookmarkMappingsWithBridge,
  type NativeBookmarkMapping,
  type NativeBookmarkSnapshot,
  type NativeBrowserBookmark,
} from "./browser-bridge";
import { buildImportPreview, type ImportCandidate, type ParsedBookmark } from "./bookmark-transfer";
import { buildNativeMappingRows, nativeMappingStateLabel } from "./native-bookmark-sync";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
  onOpenExtension: () => void;
}

interface NativeImportCandidate extends ImportCandidate {
  browserBookmarkId: string;
  folderPath: string[];
  existingBookmarkId?: string;
  mappedDockmarkBookmarkId?: string | undefined;
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

function buildNativePreview(
  nativeBookmarks: NativeBrowserBookmark[],
  mappings: NativeBookmarkMapping[],
  cloudBookmarks: Bookmark[],
) {
  const parsed: ParsedBookmark[] = nativeBookmarks.map((bookmark) => {
    const categoryName = folderCategory(bookmark.folderPath);
    return {
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
      ...(categoryName ? { categoryName } : {}),
    };
  });
  const base = buildImportPreview(parsed, cloudBookmarks);
  const cloudByUrl = existingByUrl(cloudBookmarks);
  const mappingByNativeId = new Map(mappings.map((mapping) => [mapping.browserBookmarkId, mapping]));

  return base.map((candidate, index): NativeImportCandidate => {
    const native = nativeBookmarks[index];
    if (!native) throw new Error("Browser bookmark snapshot changed while building the preview.");
    const existing = candidate.normalizedUrl ? cloudByUrl.get(candidate.normalizedUrl) : undefined;
    const mapping = mappingByNativeId.get(native.id);

    return {
      ...candidate,
      browserBookmarkId: native.id,
      folderPath: native.folderPath,
      selected: candidate.status !== "invalid" && !mapping,
      ...(existing ? { existingBookmarkId: existing.id } : {}),
      ...(mapping ? { mappedDockmarkBookmarkId: mapping.dockmarkBookmarkId } : {}),
    };
  });
}

export function NativeBookmarkImport({ bookmarks, categories, onChanged, onOpenExtension }: Props) {
  const [items, setItems] = useState<NativeImportCandidate[]>([]);
  const [snapshot, setSnapshot] = useState<NativeBookmarkSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncCapable, setSyncCapable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => onBridgeEvent((event) => {
    if (event === "bookmarks-changed" && loaded && !busy) {
      setMessage("Browser bookmark state changed. Refresh the snapshot to preview the latest mapping differences.");
    }
  }), [busy, loaded]);

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

  const mappingRows = useMemo(
    () => snapshot ? buildNativeMappingRows(snapshot.bookmarks, snapshot.mappings, bookmarks) : [],
    [bookmarks, snapshot],
  );

  const mappingStats = useMemo(() => ({
    total: mappingRows.length,
    synced: mappingRows.filter((row) => row.state === "synced").length,
    safe: mappingRows.filter((row) => row.safeToApply).length,
    conflicts: mappingRows.filter((row) => row.state === "cloud-changed" || row.state === "conflict").length,
    missing: mappingRows.filter((row) => row.state === "native-missing" || row.state === "cloud-missing").length,
  }), [mappingRows]);

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

      const nextSnapshot = await getNativeBookmarksWithBridge();
      setSyncCapable(Boolean(bridge.capabilities.nativeBookmarkSync));
      setSnapshot(nextSnapshot);
      setItems(buildNativePreview(nextSnapshot.bookmarks, nextSnapshot.mappings, bookmarks));
      setLoaded(true);
      setMessage(`Read ${nextSnapshot.bookmarks.length} browser bookmarks and ${nextSnapshot.mappings.length} local mapping${nextSnapshot.mappings.length === 1 ? "" : "s"}. Nothing has been changed yet.`);
    } catch (caught) {
      setLoaded(false);
      setSnapshot(null);
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

      const successfulMappings: Array<Pick<NativeBookmarkMapping, "browserBookmarkId" | "dockmarkBookmarkId" | "url">> = [];
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
          }
        } catch {
          failedGroups += 1;
        }
      }

      if (successfulMappings.length) await saveNativeBookmarkMappingsWithBridge(successfulMappings);
      await onChanged();
      const nextSnapshot = await getNativeBookmarksWithBridge();
      setSnapshot(nextSnapshot);
      setItems(buildNativePreview(nextSnapshot.bookmarks, nextSnapshot.mappings, bookmarks));
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

  async function unlinkMapping(browserBookmarkId: string) {
    setBusy(true);
    setError(null);
    try {
      await removeNativeBookmarkMappingsWithBridge([browserBookmarkId]);
      setSnapshot((current) => current ? {
        ...current,
        mappings: current.mappings.filter((mapping) => mapping.browserBookmarkId !== browserBookmarkId),
      } : current);
      setItems((current) => current.map((item) =>
        item.browserBookmarkId === browserBookmarkId
          ? { ...item, mappedDockmarkBookmarkId: undefined, selected: item.status !== "invalid" }
          : item,
      ));
      setMessage("Mapping unlinked. Neither the browser bookmark nor the Dockmark bookmark was deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlink mapping.");
    } finally {
      setBusy(false);
    }
  }

  async function applySafeMappingChanges() {
    if (!snapshot || !syncCapable) return;
    const safeRows = mappingRows.filter((row) => row.safeToApply);
    if (!safeRows.length) return;

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const categoryMap = new Map(categories.map((category) => [categoryKey(category.name), category.id]));
      const cloudByUrl = existingByUrl(bookmarks);
      const targetCounts = new Map<string, number>();
      for (const mapping of snapshot.mappings) {
        targetCounts.set(mapping.dockmarkBookmarkId, (targetCounts.get(mapping.dockmarkBookmarkId) ?? 0) + 1);
      }

      async function categoryIdFor(native: NativeBrowserBookmark) {
        const name = folderCategory(native.folderPath);
        if (!name) return null;
        const key = categoryKey(name);
        const existing = categoryMap.get(key);
        if (existing) return existing;
        const category = await createCategory({ name });
        categoryMap.set(key, category.id);
        return category.id;
      }

      async function createFromNative(native: NativeBrowserBookmark) {
        const normalized = normalizeBookmarkUrl(native.url);
        const existing = cloudByUrl.get(normalized);
        if (existing) return existing;
        const created = await createBookmark({
          title: (native.title || native.url).slice(0, 200),
          url: native.url,
          categoryId: await categoryIdFor(native),
        });
        cloudByUrl.set(normalized, created);
        return created;
      }

      const toSave: Array<Pick<NativeBookmarkMapping, "browserBookmarkId" | "dockmarkBookmarkId" | "url">> = [];
      const toRemove: string[] = [];
      let updated = 0;
      let recreated = 0;
      let unlinked = 0;

      for (const row of safeRows) {
        if (row.state === "native-missing") {
          toRemove.push(row.mapping.browserBookmarkId);
          unlinked += 1;
          continue;
        }
        if (!row.native) continue;

        if (row.state === "mapping-stale") {
          toSave.push({
            browserBookmarkId: row.mapping.browserBookmarkId,
            dockmarkBookmarkId: row.mapping.dockmarkBookmarkId,
            url: row.native.url,
          });
          updated += 1;
          continue;
        }

        if (row.state === "cloud-missing") {
          const target = await createFromNative(row.native);
          toSave.push({ browserBookmarkId: row.mapping.browserBookmarkId, dockmarkBookmarkId: target.id, url: row.native.url });
          recreated += 1;
          continue;
        }

        if (row.state === "native-changed" && row.cloud) {
          const normalizedNativeUrl = normalizeBookmarkUrl(row.native.url);
          const existingAtNewUrl = cloudByUrl.get(normalizedNativeUrl);
          if (existingAtNewUrl && existingAtNewUrl.id !== row.cloud.id) {
            toSave.push({ browserBookmarkId: row.mapping.browserBookmarkId, dockmarkBookmarkId: existingAtNewUrl.id, url: row.native.url });
            updated += 1;
            continue;
          }

          if ((targetCounts.get(row.cloud.id) ?? 0) <= 1) {
            const changed = await updateBookmark(row.cloud.id, {
              title: (row.native.title || row.native.url).slice(0, 200),
              url: row.native.url,
            });
            cloudByUrl.set(normalizedNativeUrl, changed);
            toSave.push({ browserBookmarkId: row.mapping.browserBookmarkId, dockmarkBookmarkId: changed.id, url: row.native.url });
            updated += 1;
          } else {
            const target = await createFromNative(row.native);
            toSave.push({ browserBookmarkId: row.mapping.browserBookmarkId, dockmarkBookmarkId: target.id, url: row.native.url });
            recreated += 1;
          }
        }
      }

      if (toSave.length) await saveNativeBookmarkMappingsWithBridge(toSave);
      if (toRemove.length) await removeNativeBookmarkMappingsWithBridge(toRemove);
      await onChanged();
      const nextSnapshot = await getNativeBookmarksWithBridge();
      setSnapshot(nextSnapshot);
      setItems(buildNativePreview(nextSnapshot.bookmarks, nextSnapshot.mappings, bookmarks));
      setMessage(`Applied ${toSave.length + toRemove.length} safe mapping change${toSave.length + toRemove.length === 1 ? "" : "s"}: ${updated} updated/remapped, ${recreated} recreated, ${unlinked} stale mapping${unlinked === 1 ? "" : "s"} unlinked. Native browser bookmarks were not modified.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not apply mapping changes.");
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
            <p>Read the connected browser directly, review imports, and maintain the local native↔Dockmark mapping.</p>
          </div>
          <span className="native-readonly">BROWSER READ-ONLY</span>
        </div>
        <div className="native-import-actions">
          <button className="secondary" type="button" disabled={busy} onClick={() => void loadNativeBookmarks()}>
            {busy && !loaded ? "Reading…" : loaded ? "Refresh browser snapshot" : "Read browser bookmarks"}
          </button>
          <span>Incremental sync never creates, edits, moves or deletes native browser bookmarks.</span>
          <button className="text-action native-extension-link" type="button" onClick={onOpenExtension}>Extension / install →</button>
        </div>
      </article>

      {error && (
        <div className="error-banner transfer-feedback" role="alert">
          {error} <button className="text-action" type="button" onClick={onOpenExtension}>Open extension diagnostics →</button>
        </div>
      )}
      {message && <div className="success-banner transfer-feedback" role="status">{message}</div>}

      {loaded && !syncCapable && (
        <div className="error-banner transfer-feedback">
          This extension can import browser bookmarks but cannot preserve mapping drift for incremental sync. Update to Dockmark Extension 0.3.0 or newer. <button className="text-action" type="button" onClick={onOpenExtension}>Update extension →</button>
        </div>
      )}

      {loaded && syncCapable && mappingRows.length > 0 && (
        <section className="mapping-preview">
          <div className="preview-heading">
            <div><p className="eyebrow">MAPPING HEALTH</p><h2>Native ↔ Dockmark mappings</h2></div>
            <div className="preview-actions">
              <button className="primary" type="button" onClick={() => void applySafeMappingChanges()} disabled={busy || !mappingStats.safe}>
                {busy ? "Applying…" : `Apply safe changes ${mappingStats.safe}`}
              </button>
            </div>
          </div>
          <div className="mapping-stats">
            <span><strong>{mappingStats.total}</strong>Mapped</span>
            <span><strong>{mappingStats.synced}</strong>Synced</span>
            <span><strong>{mappingStats.safe}</strong>Safe changes</span>
            <span><strong>{mappingStats.conflicts}</strong>Review</span>
            <span><strong>{mappingStats.missing}</strong>Missing side</span>
          </div>
          <div className="mapping-list">
            {mappingRows.slice(0, 500).map((row) => (
              <div className={`mapping-row mapping-${row.state}`} key={row.mapping.browserBookmarkId}>
                <span className="mapping-copy">
                  <strong>{row.native?.title ?? row.cloud?.title ?? row.mapping.url}</strong>
                  <small>Browser · {row.native?.url ?? "bookmark removed"}</small>
                  <small>Dockmark · {row.cloud?.url ?? "bookmark missing"}</small>
                </span>
                <span className={`mapping-status mapping-status-${row.state}`}>{nativeMappingStateLabel(row.state)}</span>
                <button className="text-action muted-action" type="button" disabled={busy} onClick={() => void unlinkMapping(row.mapping.browserBookmarkId)}>Unlink</button>
              </div>
            ))}
          </div>
          <p className="mapping-note">Safe Apply is browser → Dockmark only. Browser deletions unlink the mapping but keep the Dockmark bookmark. Dockmark-side edits and true divergence are left for manual review.</p>
        </section>
      )}

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
              <label className={`import-row ${item.mappedDockmarkBookmarkId ? "status-mapped" : `status-${item.status}`} key={item.browserBookmarkId}>
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
