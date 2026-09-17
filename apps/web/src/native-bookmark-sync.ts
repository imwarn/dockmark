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

type MappingMetadataBaseline = {
  browserBookmarkId: string;
  dockmarkBookmarkId: string;
  browserTitle: string;
  browserUrl: string;
  browserFolderPath: string[];
  dockmarkTitle: string;
  dockmarkUrl: string;
  dockmarkCategoryId: string | null;
  recordedAt: string;
};

const BASELINE_KEY = "dockmarkNativeBookmarkMetadataBaselinesV1";

function normalized(value: string | undefined) {
  if (!value) return null;
  try {
    return normalizeBookmarkUrl(value);
  } catch {
    return null;
  }
}

function samePath(left: string[], right: string[]) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function loadBaselines() {
  if (typeof window === "undefined") return {} as Record<string, MappingMetadataBaseline>;
  try {
    const raw = window.localStorage.getItem(BASELINE_KEY);
    if (!raw) return {} as Record<string, MappingMetadataBaseline>;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as Record<string, MappingMetadataBaseline>;
    }
    return parsed as Record<string, MappingMetadataBaseline>;
  } catch {
    return {} as Record<string, MappingMetadataBaseline>;
  }
}

function persistBaselines(baselines: Record<string, MappingMetadataBaseline>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BASELINE_KEY, JSON.stringify(baselines));
  } catch {
    // Mapping health still works for URL changes if local storage is unavailable.
  }
}

function currentBaseline(
  mapping: NativeBookmarkMapping,
  native: NativeBrowserBookmark,
  cloud: Bookmark,
): MappingMetadataBaseline {
  return {
    browserBookmarkId: mapping.browserBookmarkId,
    dockmarkBookmarkId: mapping.dockmarkBookmarkId,
    browserTitle: native.title,
    browserUrl: native.url,
    browserFolderPath: [...native.folderPath],
    dockmarkTitle: cloud.title,
    dockmarkUrl: cloud.url,
    dockmarkCategoryId: cloud.categoryId ?? null,
    recordedAt: new Date().toISOString(),
  };
}

export function acceptNativeMappingBaseline(
  mapping: NativeBookmarkMapping,
  native: NativeBrowserBookmark,
  cloud: Bookmark,
) {
  const baselines = loadBaselines();
  baselines[mapping.browserBookmarkId] = currentBaseline(mapping, native, cloud);
  persistBaselines(baselines);
}

export function removeNativeMappingBaseline(browserBookmarkId: string) {
  const baselines = loadBaselines();
  if (!(browserBookmarkId in baselines)) return;
  delete baselines[browserBookmarkId];
  persistBaselines(baselines);
}

export function buildNativeMappingRows(
  nativeBookmarks: NativeBrowserBookmark[],
  mappings: NativeBookmarkMapping[],
  cloudBookmarks: Bookmark[],
): NativeMappingRow[] {
  const nativeById = new Map(nativeBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const cloudById = new Map(cloudBookmarks.map((bookmark) => [bookmark.id, bookmark]));
  const baselines = loadBaselines();
  const activeIds = new Set(mappings.map((mapping) => mapping.browserBookmarkId));
  let baselinesChanged = false;

  for (const browserBookmarkId of Object.keys(baselines)) {
    if (!activeIds.has(browserBookmarkId)) {
      delete baselines[browserBookmarkId];
      baselinesChanged = true;
    }
  }

  const rows = mappings.map((mapping): NativeMappingRow => {
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
    // An absent active Dockmark target may be archived, deliberately deleted, or
    // otherwise unavailable. Never recreate it through Safe Apply: recovery must be
    // an explicit Library restore or mapping decision so archive/delete semantics win.
    if (!cloud) return { mapping, native, state: "cloud-missing", safeToApply: false };

    const nativeUrl = normalized(native.url);
    const mappedUrl = normalized(mapping.url);
    const cloudUrl = normalized(cloud.url);
    if (!nativeUrl || !mappedUrl || !cloudUrl) {
      return { mapping, native, cloud, state: "conflict", safeToApply: false };
    }

    let baseline = baselines[mapping.browserBookmarkId];
    if (baseline && baseline.dockmarkBookmarkId !== mapping.dockmarkBookmarkId) {
      baseline = currentBaseline(mapping, native, cloud);
      baselines[mapping.browserBookmarkId] = baseline;
      baselinesChanged = true;
    }

    if (!baseline) {
      // 0.3.0 mappings only stored URL. Preserve its directional URL logic first.
      if (nativeUrl !== mappedUrl && cloudUrl === mappedUrl) {
        return { mapping, native, cloud, state: "native-changed", safeToApply: true };
      }
      if (nativeUrl === mappedUrl && cloudUrl !== mappedUrl) {
        return { mapping, native, cloud, state: "cloud-changed", safeToApply: false };
      }
      if (nativeUrl !== cloudUrl) {
        return { mapping, native, cloud, state: "conflict", safeToApply: false };
      }

      // A metadata baseline records each side independently; the titles and folder/category
      // do not need to be identical when a mapping is first observed. Establishing this
      // baseline never modifies either side, it only makes subsequent drift detectable.
      baseline = currentBaseline(mapping, native, cloud);
      baselines[mapping.browserBookmarkId] = baseline;
      baselinesChanged = true;
    }

    const baselineNativeUrl = normalized(baseline.browserUrl);
    const baselineCloudUrl = normalized(baseline.dockmarkUrl);
    if (!baselineNativeUrl || !baselineCloudUrl) {
      return { mapping, native, cloud, state: "conflict", safeToApply: false };
    }

    const nativeUrlChanged = nativeUrl !== baselineNativeUrl;
    const cloudUrlChanged = cloudUrl !== baselineCloudUrl;
    const nativeTitleChanged = native.title !== baseline.browserTitle;
    const cloudTitleChanged = cloud.title !== baseline.dockmarkTitle;
    const nativeFolderChanged = !samePath(native.folderPath, baseline.browserFolderPath);
    const cloudCategoryChanged = (cloud.categoryId ?? null) !== baseline.dockmarkCategoryId;

    // Folder/category changes are detected but kept out of Safe Apply until the user
    // explicitly resolves the review. This prevents a folder move from silently recategorizing cloud data.
    if (nativeFolderChanged || cloudCategoryChanged) {
      if (!nativeUrlChanged && !cloudUrlChanged && !nativeTitleChanged && !cloudTitleChanged) {
        return {
          mapping,
          native,
          cloud,
          state: nativeFolderChanged && !cloudCategoryChanged ? "conflict" : "cloud-changed",
          safeToApply: false,
        };
      }
      return { mapping, native, cloud, state: "conflict", safeToApply: false };
    }

    const nativeChanged = nativeUrlChanged || nativeTitleChanged;
    const cloudChanged = cloudUrlChanged || cloudTitleChanged;

    if (!nativeChanged && !cloudChanged) {
      return {
        mapping,
        native,
        cloud,
        state: mappedUrl === nativeUrl ? "synced" : "mapping-stale",
        safeToApply: mappedUrl !== nativeUrl,
      };
    }

    if (nativeChanged && !cloudChanged) {
      return { mapping, native, cloud, state: "native-changed", safeToApply: true };
    }

    if (!nativeChanged && cloudChanged) {
      return { mapping, native, cloud, state: "cloud-changed", safeToApply: false };
    }

    // After an explicit browser → Dockmark apply both sides converge. Refresh only the
    // local metadata baseline; no browser or cloud data is changed here.
    if (nativeUrl === cloudUrl && native.title === cloud.title && mappedUrl === nativeUrl) {
      baselines[mapping.browserBookmarkId] = currentBaseline(mapping, native, cloud);
      baselinesChanged = true;
      return { mapping, native, cloud, state: "synced", safeToApply: false };
    }

    return { mapping, native, cloud, state: "conflict", safeToApply: false };
  });

  if (baselinesChanged) persistBaselines(baselines);
  return rows;
}

export function nativeMappingStateLabel(state: NativeMappingState) {
  switch (state) {
    case "synced": return "SYNCED";
    case "native-changed": return "BROWSER CHANGED";
    case "native-missing": return "BROWSER MISSING";
    case "cloud-missing": return "DOCKMARK MISSING";
    case "mapping-stale": return "MAPPING STALE";
    case "cloud-changed": return "DOCKMARK CHANGED";
    case "conflict": return "REVIEW";
  }
}

export function nativeMappingReviewDescription(state: NativeMappingState) {
  switch (state) {
    case "cloud-missing":
      return "The mapped Dockmark bookmark is not in the active Library. It may be archived or deliberately deleted, so Safe Apply will not recreate it. Restore it in Library, re-link this browser bookmark, or unlink the stale mapping.";
    case "cloud-changed":
      return "Dockmark changed after this mapping baseline. Keep the Dockmark version, replace it with the browser version, or re-link the browser bookmark.";
    case "conflict":
      return "Both sides changed, or the browser folder and Dockmark category diverged. Choose which state should become authoritative for this mapping.";
    default:
      return "This mapping does not require manual conflict review.";
  }
}