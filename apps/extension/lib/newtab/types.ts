/**
 * [INPUT]: depends on AppearancePreference, BrowserSettings, LocalePreference, and ResolvedLocale from @dockmark/core
 * [OUTPUT]: exports New Tab storage constants, snapshot/result/element/state interfaces, and pure URL/tag/monogram helpers
 * [POS]: foundational domain types and pure utilities for apps/extension/lib/newtab
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import type {
  AppearancePreference,
  BrowserSettings,
  LocalePreference,
  ResolvedLocale,
} from "@dockmark/core";

export const SERVER_KEY = "dockmarkServerUrl";
export const TOKEN_KEY = "dockmarkDeviceToken";
export const CACHE_KEY = "dockmarkNewTabCacheV1";
export const SETTINGS_KEY = "dockmarkBrowserSettingsV1";
export const CACHE_VERSION = 1;
export const DEFAULT_SEARCH_URL = "https://www.google.com/search?q=%s";
export const LAUNCHER_RESULT_LIMIT = 8;

export interface CachedBookmark {
  id: string;
  categoryId?: string | null;
  title?: string;
  url: string;
  description?: string;
  tags?: string[];
  healthPolicy?: string;
  healthStatus?: string;
  position?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CachedCategory {
  id: string;
  name: string;
  position?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CachedWorkspaceItem {
  id?: string;
  workspaceId?: string;
  title?: string;
  url: string;
  openMode?: "reuse" | "new-tab" | "pinned" | string;
  healthPolicy?: string;
  position?: number;
}

export interface CachedWorkspace {
  id: string;
  name: string;
  description?: string;
  position?: number;
  items?: CachedWorkspaceItem[];
}

export interface CachedSessionItem {
  id?: string;
  sessionId?: string;
  title?: string;
  url: string;
  pinned?: boolean;
  position?: number;
}

export interface CachedSession {
  id: string;
  name: string;
  sourceDevice?: string;
  items?: CachedSessionItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CachedSearchEngine {
  id?: string;
  name: string;
  keyword?: string;
  searchUrl: string;
  isDefault?: boolean;
  position?: number;
}

export interface CachedSmartCollectionFilters {
  categoryId?: string | null;
  tags?: string[];
  domain?: string;
  healthStatus?: string;
  inbox?: "inbox" | "library" | string;
}

export interface CachedSmartCollection {
  id: string;
  name: string;
  filters?: CachedSmartCollectionFilters;
  position?: number;
}

export interface NewTabSnapshot {
  version: number;
  origin: string;
  syncedAt: string | null;
  bookmarks: CachedBookmark[];
  categories: CachedCategory[];
  workspaces: CachedWorkspace[];
  sessions: CachedSession[];
  searchEngines: CachedSearchEngine[];
  smartCollections: CachedSmartCollection[];
  inboxBookmarkIds: string[];
  appearancePreference: AppearancePreference;
  localePreference: LocalePreference;
}

export interface OpenTabEntry {
  id: number;
  windowId: number;
  title: string;
  url: string;
  active: boolean;
}

export type ActiveBookmarkFilter =
  | { type: "all"; id: null }
  | { type: "collection" | "category"; id: string };

export type NewTabResultKind =
  | "tab"
  | "workspace"
  | "session"
  | "collection"
  | "bookmark"
  | "navigation"
  | "search"
  | "search-shortcut";

export interface NewTabResult {
  kind: NewTabResultKind;
  title: string;
  subtitle: string;
  score: number;
  url?: string;
  tab?: OpenTabEntry;
  workspace?: CachedWorkspace;
  session?: CachedSession;
  collection?: CachedSmartCollection;
  engine?: CachedSearchEngine;
}

export interface ConnectionState {
  key: string;
  customLabel: string | null;
  tone: string;
}

export interface OfflineState {
  key: string;
  customMessage: string;
}

export interface NewTabElements {
  connection: HTMLElement;
  themeToggle: HTMLButtonElement | null;
  localeToggle: HTMLButtonElement | null;
  refresh: HTMLButtonElement;
  manage: HTMLButtonElement;
  search: HTMLInputElement;
  searchClear: HTMLButtonElement | null;
  shortcutKbd: HTMLElement | null;
  results: HTMLElement;
  offline: HTMLElement;
  setup: HTMLElement;
  bookmarkFilters: HTMLElement | null;
  bookmarks: HTMLElement;
  workspaces: HTMLElement;
  bookmarkCount: HTMLElement;
  workspaceCount: HTMLElement;
  syncStatus: HTMLElement;
  settingsStatus: HTMLElement;
  clearCache: HTMLButtonElement;
}

export interface DockmarkAppearanceApi {
  STORAGE_KEY: string;
  apply: (preference: unknown, persist?: boolean) => AppearancePreference;
  current: () => AppearancePreference;
  cycle: () => AppearancePreference;
  hydrate: () => Promise<AppearancePreference>;
  resolved: (preference: AppearancePreference) => "light" | "dark";
}

export interface DockmarkI18nApi {
  STORAGE_KEY: string;
  normalize: (value: unknown) => LocalePreference;
  resolve: (preference: unknown, browserLanguage?: string) => ResolvedLocale;
  currentPreference: () => LocalePreference;
  currentLocale: () => ResolvedLocale;
  tx: (en: string, zh: string) => string;
  formatRelativeTime: (isoValue: string | null | undefined) => string;
  connectionText: (key: string) => string;
  offlineText: (key: string, syncedAt: string | null | undefined) => string;
  kindLabel: (kind: NewTabResultKind | string | undefined) => string;
  apply: (preference: unknown, persist?: boolean) => { preference: LocalePreference; locale: ResolvedLocale };
  applyStaticDom: () => void;
  hydrate: () => Promise<{ preference: LocalePreference; locale: ResolvedLocale }>;
  toggleLocale: () => { preference: LocalePreference; locale: ResolvedLocale };
}

export interface NewTabState {
  origin: string | null;
  snapshot: NewTabSnapshot;
  settings: BrowserSettings;
  openTabs: OpenTabEntry[];
  activeResult: number;
  visibleResults: NewTabResult[];
  refreshing: boolean;
  activeFilter: ActiveBookmarkFilter;
  connectionState: ConnectionState;
  offlineState: OfflineState;
  hasOriginPermission: () => Promise<boolean>;
  requestJson: (path: string) => Promise<Record<string, unknown>>;
  buildResults: (rawQuery: string) => NewTabResult[];
  executeResult: (result: NewTabResult | undefined) => Promise<void>;
  refreshCloud: (options?: { quiet?: boolean }) => Promise<boolean>;
  renderSnapshot: () => void;
  renderSearchResults: () => void;
}

export function asArray<T>(value: readonly T[] | null | undefined): T[];
export function asArray<T>(value: unknown): T[];
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function validOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function tabMatchKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

export function normalizedTags(bookmark: Pick<CachedBookmark, "tags"> | null | undefined): string[] {
  return asArray<unknown>(bookmark?.tags)
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .map((tag) => tag.trim());
}

export function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function hostMonogram(url: string, fallbackTitle?: string): string {
  const host = displayHost(url).replace(/^www\./i, "");
  const match = String(host || fallbackTitle || "D").match(/[A-Za-z0-9\u4e00-\u9fff]/);
  return (match?.[0] || "D").toUpperCase();
}

export function emptySnapshot(): NewTabSnapshot {
  return {
    version: CACHE_VERSION,
    origin: "",
    syncedAt: null,
    bookmarks: [],
    categories: [],
    workspaces: [],
    sessions: [],
    searchEngines: [],
    smartCollections: [],
    inboxBookmarkIds: [],
    appearancePreference: "system",
    localePreference: "system",
  };
}

export function cacheIsUsable(value: unknown, expectedOrigin: string | null): value is NewTabSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<NewTabSnapshot>;
  return Boolean(
    candidate.version === CACHE_VERSION &&
    typeof candidate.origin === "string" &&
    (!expectedOrigin || candidate.origin === expectedOrigin) &&
    Array.isArray(candidate.bookmarks) &&
    Array.isArray(candidate.workspaces),
  );
}
