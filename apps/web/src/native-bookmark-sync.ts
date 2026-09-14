import { normalizeBookmarkUrl, type Bookmark } from "@dockmark/core";
import type { NativeBookmarkMapping, NativeBrowserBookmark } from "./browser-bridge";

export type NativeMappingState =
  | "synced"
  | "native-changed"
  | "native-missing"
  | "cloud-missing"
  | "mapping-stale"
  | "cloud-changed"
  | "conflict";

export interface NativeMappingRow {
  mapping: NativeBookmarkMapping;
  native?: NativeBrowserBookmark;
  cloud?: Bookmark;
  state: NativeMappingState;
  safeToApply: boolean;
}

function normalized(value: string | undefined) {
  if (!value) return null;
  try {
    return normalizeBookmarkUrl(value);
  } catch {
    return null;
  }
}

export function buildNativeMappingRows(
  nativeBookmarks: NativeBrowserBookmark[],
  mappings: NativeBookmarkMapping[],
  cloudBookmarks: Bookmark[],
): NativeMappingRow[] {
  const nativeById = new Map(nativeBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const cloudById = new Map(cloudBookmarks.map((bookmark) => [bookmark.id, bookmark]));

  return mappings.map((mapping): NativeMappingRow => {
    const native = nativeById.get(mapping.browserBookmarkId);
    const cloud = cloudById.get(mapping.dockmarkBookmarkId);

    if (!native) {
      return {
        mapping,
        ...(cloud ? { cloud } : {}),
        state: "native-missing",
        safeToApply: true,
      };
    }
    if (!cloud) return { mapping, native, state: "cloud-missing", safeToApply: true };

    const nativeUrl = normalized(native.url);
    const mappedUrl = normalized(mapping.url);
    const cloudUrl = normalized(cloud.url);
    if (!nativeUrl || !mappedUrl || !cloudUrl) {
      return { mapping, native, cloud, state: "conflict", safeToApply: false };
    }

    if (nativeUrl === cloudUrl) {
      return {
        mapping,
        native,
        cloud,
        state: mappedUrl === nativeUrl ? "synced" : "mapping-stale",
        safeToApply: mappedUrl !== nativeUrl,
      };
    }

    if (nativeUrl !== mappedUrl && cloudUrl === mappedUrl) {
      return { mapping, native, cloud, state: "native-changed", safeToApply: true };
    }

    if (nativeUrl === mappedUrl && cloudUrl !== mappedUrl) {
      return { mapping, native, cloud, state: "cloud-changed", safeToApply: false };
    }

    return { mapping, native, cloud, state: "conflict", safeToApply: false };
  });
}

export function nativeMappingStateLabel(state: NativeMappingState) {
  switch (state) {
    case "synced": return "SYNCED";
    case "native-changed": return "BROWSER CHANGED";
    case "native-missing": return "BROWSER MISSING";
    case "cloud-missing": return "DOCKMARK MISSING";
    case "mapping-stale": return "MAPPING STALE";
    case "cloud-changed": return "DOCKMARK CHANGED";
    case "conflict": return "CONFLICT";
  }
}
