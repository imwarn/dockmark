/**
 * [INPUT]: depends on DEFAULT_BROWSER_SETTINGS, normalizeBookmarkUrl, normalizeBrowserSettings, Bookmark, BookmarkConflictPreference, Category from @dockmark/core; bookmark/bridge/transfer/sync modules; NativeMappingPreviewPanel, NativeImportTreePanel from ./NativeBookmarkSyncPanels; useI18n from ./i18n
 * [OUTPUT]: exports NativeBookmarkImport component
 * [POS]: browser-native bookmark reader, mapping conflict resolver, and safe incremental sync controller embedded in TransferManager
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_BROWSER_SETTINGS,
  normalizeBookmarkUrl,
  normalizeBrowserSettings,
  type Bookmark,
  type BookmarkConflictPreference,
  type Category,
} from "@dockmark/core";
import { createBookmark, createCategory, updateBookmark } from "./api";
import {
  getBridgeStatus,
  getNativeBookmarksWithBridge,
  onBridgeEvent,
  removeNativeBookmarkMappingsWithBridge,
  saveNativeBookmarkMappingsWithBridge,
  writeNativeBookmarkWithBridge,
  type NativeBookmarkMapping,
  type NativeBookmarkSnapshot,
  type NativeBrowserBookmark,
} from "./browser-bridge";
import { buildImportPreview, type ParsedBookmark } from "./bookmark-transfer";
import { useI18n } from "./i18n";
import {
  acceptNativeMappingBaseline,
  buildNativeMappingRows,
  removeNativeMappingBaseline,
  type NativeMappingRow,
} from "./native-bookmark-sync";
import {
  conflictPreferenceLabel,
  folderCategory,
  NativeImportTreePanel,
  NativeMappingPreviewPanel,
  type NativeImportCandidate,
} from "./NativeBookmarkSyncPanels";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
  onOpenExtension: () => void;
}

const LOCAL_SETTINGS_KEY = "dockmarkBrowserSettingsV1";

function readConflictPreference(): BookmarkConflictPreference {
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    return normalizeBrowserSettings(raw ? JSON.parse(raw) : DEFAULT_BROWSER_SETTINGS).conflictPreference;
  } catch {
    return DEFAULT_BROWSER_SETTINGS.conflictPreference;
  }
}

function categoryKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function existingByUrl(bookmarks: Bookmark[]) {
  const map = new Map<string, Bookmark>();
  for (const bookmark of bookmarks) {
    try {
      map.set(normalizeBookmarkUrl(bookmark.url), bookmark);
    } catch {
      // Ignore malformed legacy rows.
    }
  }
  return map;
}

function buildNativePreview(
  nativeBookmarks: NativeBrowserBookmark[],
  mappings: NativeBookmarkMapping[],
  cloudBookmarks: Bookmark[],
  changedErrorMessage: string,
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
    if (!native) throw new Error(changedErrorMessage);
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
  const { locale, tx } = useI18n();
  const [items, setItems] = useState<NativeImportCandidate[]>([]);
  const [snapshot, setSnapshot] = useState<NativeBookmarkSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncCapable, setSyncCapable] = useState(false);
  const [writebackCapable, setWritebackCapable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [policyApplying, setPolicyApplying] = useState(false);
  const [conflictPreference, setConflictPreference] = useState<BookmarkConflictPreference>(() => readConflictPreference());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [relinkTargets, setRelinkTargets] = useState<Record<string, string>>({});

  const snapshotChangedError = tx(
    "Browser bookmark snapshot changed while building the preview.",
    "生成预览时浏览器书签快照发生变化，请重新读取。",
  );

  useEffect(() => onBridgeEvent((event) => {
    if (event === "bookmarks-changed" && loaded && !busy) {
      setMessage(tx(
        "Browser bookmark state changed. Refresh the snapshot to preview the latest mapping differences.",
        "检测到浏览器书签变动，请刷新快照以预览最新映射差异。",
      ));
    }
  }), [busy, loaded, tx]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_SETTINGS_KEY) setConflictPreference(readConflictPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const relinkOptions = useMemo(
    () => [...bookmarks].sort((left, right) => left.title.localeCompare(right.title)),
    [bookmarks],
  );

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

  const preferredReviewRows = useMemo(
    () => conflictPreference === "ask"
      ? []
      : mappingRows.filter((row) => row.state === "cloud-changed" && row.native && row.cloud),
    [conflictPreference, mappingRows],
  );

  const mappingStats = useMemo(() => ({
    total: mappingRows.length,
    synced: mappingRows.filter((row) => row.state === "synced").length,
    safe: mappingRows.filter((row) => row.safeToApply).length,
    conflicts: mappingRows.filter((row) => row.state === "cloud-changed" || row.state === "conflict").length,
    missing: mappingRows.filter((row) => row.state === "native-missing" || row.state === "cloud-missing").length,
  }), [mappingRows]);

  async function refreshMappingSnapshot() {
    const nextSnapshot = await getNativeBookmarksWithBridge();
    setSnapshot(nextSnapshot);
    setItems(buildNativePreview(nextSnapshot.bookmarks, nextSnapshot.mappings, bookmarks, snapshotChangedError));
    return nextSnapshot;
  }

  async function loadNativeBookmarks() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setConflictPreference(readConflictPreference());
    try {
      const bridge = await getBridgeStatus();
      if (!bridge.capabilities.nativeBookmarks) {
        throw new Error(tx(
          "This Dockmark extension is too old for native bookmark import. Update it and reconnect.",
          "当前浏览器扩展版本过旧，不支持读取原生书签。请更新扩展并重新连接。",
        ));
      }
      if (!bridge.permissions?.nativeBookmarks) {
        throw new Error(tx(
          "Open the Dockmark extension popup and enable Native bookmarks, then try again.",
          "请先在 Dockmark 浏览器扩展弹窗中启用「原生书签」权限后再重试。",
        ));
      }

      const nextSnapshot = await getNativeBookmarksWithBridge();
      setSyncCapable(Boolean(bridge.capabilities.nativeBookmarkSync));
      setWritebackCapable(Boolean(bridge.capabilities.nativeBookmarkWriteback));
      setSnapshot(nextSnapshot);
      setItems(buildNativePreview(nextSnapshot.bookmarks, nextSnapshot.mappings, bookmarks, snapshotChangedError));
      setLoaded(true);
      setMessage(tx(
        `Read ${nextSnapshot.bookmarks.length} browser bookmarks and ${nextSnapshot.mappings.length} local mapping${nextSnapshot.mappings.length === 1 ? "" : "s"}. Nothing has been changed yet.`,
        `已读取 ${nextSnapshot.bookmarks.length} 个浏览器书签及 ${nextSnapshot.mappings.length} 条本地映射，尚未改动任何数据。`,
      ));
    } catch (caught) {
      setLoaded(false);
      setSnapshot(null);
      setItems([]);
      setError(caught instanceof Error ? caught.message : tx("Could not read browser bookmarks.", "无法读取浏览器书签。"));
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
      await refreshMappingSnapshot();
      setMessage(tx(
        `Mapped ${successfulMappings.length} browser bookmark${successfulMappings.length === 1 ? "" : "s"}: ${created} new, ${linkedExisting} linked to existing URLs${failedGroups ? `; ${failedGroups} failed` : ""}.`,
        `已映射 ${successfulMappings.length} 个浏览器书签：新增 ${created} 项、关联已有 ${linkedExisting} 项${failedGroups ? `，${failedGroups} 组失败` : ""}。`,
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Native bookmark import failed.", "原生书签导入失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function unlinkMapping(browserBookmarkId: string) {
    setBusy(true);
    setError(null);
    try {
      await removeNativeBookmarkMappingsWithBridge([browserBookmarkId]);
      removeNativeMappingBaseline(browserBookmarkId);
      setSnapshot((current) => current ? {
        ...current,
        mappings: current.mappings.filter((mapping) => mapping.browserBookmarkId !== browserBookmarkId),
      } : current);
      setItems((current) => current.map((item) =>
        item.browserBookmarkId === browserBookmarkId
          ? { ...item, mappedDockmarkBookmarkId: undefined, selected: item.status !== "invalid" }
          : item,
      ));
      setMessage(tx(
        "Mapping unlinked. Neither the browser bookmark nor the Dockmark bookmark was deleted.",
        "已解除映射，浏览器书签与 Dockmark 书签均未被删除。",
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not unlink mapping.", "无法解除映射。"));
    } finally {
      setBusy(false);
    }
  }

  async function keepDockmark(row: NativeMappingRow) {
    if (!row.native || !row.cloud) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const mapping: NativeBookmarkMapping = { ...row.mapping, url: row.native.url };
      await saveNativeBookmarkMappingsWithBridge([mapping]);
      acceptNativeMappingBaseline(mapping, row.native, row.cloud);
      await refreshMappingSnapshot();
      setMessage(tx(
        "Kept the Dockmark version and accepted the current difference as the new baseline. No browser data was changed.",
        "已保留 Dockmark 版本并将当前差异设为新基线，未改动浏览器书签。",
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not keep the Dockmark version.", "无法保留 Dockmark 版本。"));
    } finally {
      setBusy(false);
    }
  }

  async function writeDockmarkToBrowser(row: NativeMappingRow) {
    if (!writebackCapable || !row.native || !row.cloud) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await writeNativeBookmarkWithBridge({
        browserBookmarkId: row.mapping.browserBookmarkId,
        dockmarkBookmarkId: row.cloud.id,
        title: row.cloud.title,
        url: row.cloud.url,
      });

      const mapping: NativeBookmarkMapping = { ...row.mapping, url: row.cloud.url };
      await saveNativeBookmarkMappingsWithBridge([mapping]);
      const nextSnapshot = await refreshMappingSnapshot();
      const nextNative = nextSnapshot.bookmarks.find((bookmark) => bookmark.id === row.mapping.browserBookmarkId);
      if (nextNative) acceptNativeMappingBaseline(mapping, nextNative, row.cloud);
      setMessage(tx(
        `Wrote Dockmark title and URL to the mapped browser bookmark “${row.cloud.title}”. No folders were moved.`,
        `已将「${row.cloud.title}」的标题与网址写回对应浏览器书签，未移动浏览器文件夹。`,
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not write this Dockmark bookmark back to the browser.", "无法写回浏览器书签。"));
    } finally {
      setBusy(false);
    }
  }

  async function relinkMapping(row: NativeMappingRow) {
    if (!row.native) return;
    const targetId = relinkTargets[row.mapping.browserBookmarkId];
    const target = bookmarks.find((bookmark) => bookmark.id === targetId);
    if (!target) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const mapping: NativeBookmarkMapping = {
        ...row.mapping,
        dockmarkBookmarkId: target.id,
        url: row.native.url,
      };
      await saveNativeBookmarkMappingsWithBridge([mapping]);
      acceptNativeMappingBaseline(mapping, row.native, target);
      setRelinkTargets((current) => {
        const next = { ...current };
        delete next[row.mapping.browserBookmarkId];
        return next;
      });
      await refreshMappingSnapshot();
      setMessage(tx(
        `Re-linked the browser bookmark to “${target.title}”. Neither bookmark was modified.`,
        `已将该浏览器书签重新关联到「${target.title}」，两侧书签内容未改动。`,
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not re-link this mapping.", "无法重新关联此映射。"));
    } finally {
      setBusy(false);
    }
  }

  async function useBrowser(row: NativeMappingRow) {
    if (!snapshot || !row.native || !row.cloud) return;
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const native = row.native;
      const normalizedNativeUrl = normalizeBookmarkUrl(native.url);
      const cloudByUrl = existingByUrl(bookmarks);
      const categoryMap = new Map(categories.map((category) => [categoryKey(category.name), category.id]));
      const categoryName = folderCategory(native.folderPath);
      let categoryId: string | null = null;
      if (categoryName) {
        const key = categoryKey(categoryName);
        categoryId = categoryMap.get(key) ?? null;
        if (!categoryId) {
          const category = await createCategory({ name: categoryName });
          categoryId = category.id;
        }
      }

      const targetCounts = new Map<string, number>();
      for (const mapping of snapshot.mappings) {
        targetCounts.set(mapping.dockmarkBookmarkId, (targetCounts.get(mapping.dockmarkBookmarkId) ?? 0) + 1);
      }

      const existingAtBrowserUrl = cloudByUrl.get(normalizedNativeUrl);
      let target: Bookmark;
      if (existingAtBrowserUrl && existingAtBrowserUrl.id !== row.cloud.id) {
        target = await updateBookmark(existingAtBrowserUrl.id, {
          title: (native.title || native.url).slice(0, 200),
          categoryId,
        });
      } else if ((targetCounts.get(row.cloud.id) ?? 0) <= 1 || existingAtBrowserUrl?.id === row.cloud.id) {
        target = await updateBookmark(row.cloud.id, {
          title: (native.title || native.url).slice(0, 200),
          url: native.url,
          categoryId,
        });
      } else {
        target = await createBookmark({
          title: (native.title || native.url).slice(0, 200),
          url: native.url,
          categoryId,
        });
      }

      const mapping: NativeBookmarkMapping = {
        ...row.mapping,
        dockmarkBookmarkId: target.id,
        url: native.url,
      };
      await saveNativeBookmarkMappingsWithBridge([mapping]);
      acceptNativeMappingBaseline(mapping, native, target);
      await onChanged();
      await refreshMappingSnapshot();
      setMessage(tx(
        `Resolved review using Browser as source. Dockmark now follows “${native.title || native.url}”.`,
        `已采用浏览器版本，Dockmark 已更新为「${native.title || native.url}」。`,
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not resolve this mapping using the browser version.", "无法采用浏览器版本解决此冲突。"));
    } finally {
      setBusy(false);
    }
  }

  async function applyPreferredReviewChanges() {
    if (conflictPreference === "ask" || !preferredReviewRows.length) return;
    setPolicyApplying(true);
    setError(null);
    setMessage(null);
    try {
      for (const row of preferredReviewRows) {
        if (conflictPreference === "browser") await useBrowser(row);
        else if (writebackCapable) await writeDockmarkToBrowser(row);
        else await keepDockmark(row);
      }
      setMessage(tx(
        `Applied ${conflictPreferenceLabel(conflictPreference, locale)} to ${preferredReviewRows.length} one-sided Dockmark change${preferredReviewRows.length === 1 ? "" : "s"}.`,
        `已按「${conflictPreferenceLabel(conflictPreference, locale)}」处理 ${preferredReviewRows.length} 条单侧 Dockmark 变更。`,
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not apply the preferred review policy.", "无法应用偏好策略。"));
    } finally {
      setPolicyApplying(false);
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
          removeNativeMappingBaseline(row.mapping.browserBookmarkId);
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
      await refreshMappingSnapshot();
      const total = toSave.length + toRemove.length;
      setMessage(tx(
        `Applied ${total} safe mapping change${total === 1 ? "" : "s"}: ${updated} updated, ${recreated} recreated, ${unlinked} unlinked. Browser bookmarks were not modified.`,
        `已应用 ${total} 项安全映射变更：更新 ${updated} 项、重建 ${recreated} 项、解除过期映射 ${unlinked} 项，未改动浏览器书签。`,
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not apply mapping changes.", "无法应用映射变更。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <article className="form-card native-import-card">
        <div className="card-heading">
          <div>
            <h2>{tx("Browser bookmarks", "浏览器原生书签")}</h2>
            <p>
              {tx(
                "Read bookmarks from the connected browser, review imports, and maintain local native ↔ Dockmark mappings.",
                "直接读取已连接浏览器的书签树，预览导入并维护本地原生 ↔ Dockmark 映射。",
              )}
            </p>
          </div>
          <span className="native-readonly">{tx("No auto browser writes", "无自动写回")}</span>
        </div>
        <div className="native-import-actions">
          <button className="secondary" type="button" disabled={busy || policyApplying} onClick={() => void loadNativeBookmarks()}>
            {busy && !loaded
              ? tx("Reading…", "读取中…")
              : loaded
                ? tx("Refresh browser snapshot", "刷新浏览器快照")
                : tx("Read browser bookmarks", "读取浏览器书签")}
          </button>
          <span>
            {tx(
              "Automatic sync never edits browser bookmarks. Extension 0.4+ writes title + URL only after an explicit review click.",
              "自动同步绝不改动浏览器书签；扩展 0.4+ 仅在你手动点击复核写回时更新标题与网址。",
            )}
          </span>
          <button className="text-action native-extension-link" type="button" onClick={onOpenExtension}>
            {tx("Extension / install →", "扩展与安装 →")}
          </button>
        </div>
      </article>

      {error && (
        <div className="error-banner transfer-feedback" role="alert">
          {error}{" "}
          <button className="text-action" type="button" onClick={onOpenExtension}>
            {tx("Open extension diagnostics →", "打开扩展诊断 →")}
          </button>
        </div>
      )}
      {message && <div className="success-banner transfer-feedback" role="status">{message}</div>}

      {loaded && !syncCapable && (
        <div className="error-banner transfer-feedback">
          {tx(
            "This extension can import browser bookmarks but cannot track mapping drift for incremental sync. Update to Dockmark Extension 0.3.0+.",
            "当前扩展仅支持导入，暂不支持增量同步映射检测。请更新至 Dockmark 扩展 0.3.0 或更高版本。",
          )}{" "}
          <button className="text-action" type="button" onClick={onOpenExtension}>
            {tx("Update extension →", "更新扩展 →")}
          </button>
        </div>
      )}

      {loaded && syncCapable && mappingRows.length > 0 && (
        <NativeMappingPreviewPanel
          conflictPreference={conflictPreference}
          mappingRows={mappingRows}
          preferredReviewCount={preferredReviewRows.length}
          mappingStats={mappingStats}
          categoryNames={categoryNames}
          relinkOptions={relinkOptions}
          relinkTargets={relinkTargets}
          writebackCapable={writebackCapable}
          busy={busy}
          policyApplying={policyApplying}
          onApplyPreferred={() => void applyPreferredReviewChanges()}
          onApplySafe={() => void applySafeMappingChanges()}
          onUseBrowser={(row) => void useBrowser(row)}
          onKeepDockmark={(row) => void keepDockmark(row)}
          onWriteDockmarkToBrowser={(row) => void writeDockmarkToBrowser(row)}
          onRelinkTargetChange={(id, value) => setRelinkTargets((current) => ({ ...current, [id]: value }))}
          onRelinkMapping={(row) => void relinkMapping(row)}
          onUnlinkMapping={(id) => void unlinkMapping(id)}
        />
      )}

      {loaded && items.length > 0 && (
        <NativeImportTreePanel
          items={items}
          stats={stats}
          busy={busy}
          policyApplying={policyApplying}
          onSelectAll={selectAll}
          onImportSelected={() => void importSelected()}
          onToggleItem={toggle}
        />
      )}

      {loaded && !items.length && (
        <div className="success-banner transfer-feedback">
          {tx("No HTTP/HTTPS browser bookmarks were found.", "未在浏览器中找到 HTTP/HTTPS 书签。")}
        </div>
      )}
    </>
  );
}
