/**
 * [INPUT]: depends on Id from ./models; depends on LocalePreference and normalizeLocalePreference from ./i18n
 * [OUTPUT]: provides browser (with launcher shortcuts), appearance, public-page, and non-secret AI settings contracts, defaults, normalizers, and merge helpers
 * [POS]: schema and normalization boundary for persisted app_settings payloads in packages/core/src
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import type { Id } from "./models";
import { normalizeLocalePreference, type LocalePreference } from "./i18n";

export const BROWSER_SETTINGS_VERSION = 1;
export const APPEARANCE_SETTINGS_VERSION = 1;
export const PUBLIC_PAGE_SETTINGS_VERSION = 1;
export const AI_SETTINGS_VERSION = 1;

export type BookmarkConflictPreference = "ask" | "browser" | "dockmark";
export type LauncherShortcutKey = "mod-k" | "mod-j" | "alt-k";
export type AppearancePreference = "system" | "light" | "dark";
export type PublicPageLayout = "grid" | "compact" | "list";

export interface BrowserNewTabSettings {
  defaultSearchEngineId: Id | null;
  showOpenTabs: boolean;
  bookmarkLimit: number;
  workspaceLimit: number;
  autoRefresh: boolean;
}

export interface BrowserSettings {
  version: typeof BROWSER_SETTINGS_VERSION;
  conflictPreference: BookmarkConflictPreference;
  launcherShortcut: LauncherShortcutKey;
  slashFocus: boolean;
  newTab: BrowserNewTabSettings;
  updatedAt: string | null;
}

export interface UpdateBrowserSettingsInput {
  conflictPreference?: BookmarkConflictPreference;
  launcherShortcut?: LauncherShortcutKey;
  slashFocus?: boolean;
  newTab?: Partial<BrowserNewTabSettings>;
}

export interface AppearanceSettings {
  version: typeof APPEARANCE_SETTINGS_VERSION;
  preference: AppearancePreference;
  locale: LocalePreference;
  updatedAt: string | null;
}

export interface UpdateAppearanceSettingsInput {
  preference?: AppearancePreference;
  locale?: LocalePreference;
}

export interface PublicPageSettings {
  version: typeof PUBLIC_PAGE_SETTINGS_VERSION;
  siteTitle: string;
  siteSubtitle: string;
  defaultLayout: PublicPageLayout;
  showSearchBar: boolean;
  showWebSearch: boolean;
  showCategoryNav: boolean;
  openInNewTab: boolean;
  updatedAt: string | null;
}

export interface UpdatePublicPageSettingsInput {
  siteTitle?: string;
  siteSubtitle?: string;
  defaultLayout?: PublicPageLayout;
  showSearchBar?: boolean;
  showWebSearch?: boolean;
  showCategoryNav?: boolean;
  openInNewTab?: boolean;
}

export interface AiSettings {
  version: typeof AI_SETTINGS_VERSION;
  endpoint: string;
  model: string;
  timeoutSeconds: number;
  updatedAt: string | null;
}

export interface UpdateAiSettingsInput {
  endpoint?: string;
  model?: string;
  timeoutSeconds?: number;
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  version: BROWSER_SETTINGS_VERSION,
  conflictPreference: "ask",
  launcherShortcut: "mod-k",
  slashFocus: true,
  newTab: {
    defaultSearchEngineId: null,
    showOpenTabs: true,
    bookmarkLimit: 12,
    workspaceLimit: 8,
    autoRefresh: true,
  },
  updatedAt: null,
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  version: APPEARANCE_SETTINGS_VERSION,
  preference: "system",
  locale: "system",
  updatedAt: null,
};

export const DEFAULT_PUBLIC_PAGE_SETTINGS: PublicPageSettings = {
  version: PUBLIC_PAGE_SETTINGS_VERSION,
  siteTitle: "",
  siteSubtitle: "",
  defaultLayout: "grid",
  showSearchBar: true,
  showWebSearch: true,
  showCategoryNav: true,
  openInNewTab: true,
  updatedAt: null,
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  version: AI_SETTINGS_VERSION,
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "",
  timeoutSeconds: 90,
  updatedAt: null,
};

function integerInRange(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function conflictPreference(value: unknown): BookmarkConflictPreference {
  return value === "browser" || value === "dockmark" || value === "ask" ? value : "ask";
}

export function normalizeLauncherShortcut(value: unknown): LauncherShortcutKey {
  return value === "mod-j" || value === "alt-k" || value === "mod-k" ? value : "mod-k";
}

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function normalizePublicPageLayout(value: unknown): PublicPageLayout {
  return value === "compact" || value === "list" || value === "grid" ? value : "grid";
}

function trimmedCappedString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeBrowserSettings(value: unknown): BrowserSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(DEFAULT_BROWSER_SETTINGS);
  }

  const record = value as Record<string, unknown>;
  const rawNewTab = record.newTab && typeof record.newTab === "object" && !Array.isArray(record.newTab)
    ? record.newTab as Record<string, unknown>
    : {};
  const defaultSearchEngineId = typeof rawNewTab.defaultSearchEngineId === "string" && rawNewTab.defaultSearchEngineId.trim()
    ? rawNewTab.defaultSearchEngineId.trim()
    : null;
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : null;

  return {
    version: BROWSER_SETTINGS_VERSION,
    conflictPreference: conflictPreference(record.conflictPreference),
    launcherShortcut: normalizeLauncherShortcut(record.launcherShortcut),
    slashFocus: typeof record.slashFocus === "boolean"
      ? record.slashFocus
      : DEFAULT_BROWSER_SETTINGS.slashFocus,
    newTab: {
      defaultSearchEngineId,
      showOpenTabs: typeof rawNewTab.showOpenTabs === "boolean"
        ? rawNewTab.showOpenTabs
        : DEFAULT_BROWSER_SETTINGS.newTab.showOpenTabs,
      bookmarkLimit: integerInRange(
        rawNewTab.bookmarkLimit,
        DEFAULT_BROWSER_SETTINGS.newTab.bookmarkLimit,
        0,
        24,
      ),
      workspaceLimit: integerInRange(
        rawNewTab.workspaceLimit,
        DEFAULT_BROWSER_SETTINGS.newTab.workspaceLimit,
        0,
        12,
      ),
      autoRefresh: typeof rawNewTab.autoRefresh === "boolean"
        ? rawNewTab.autoRefresh
        : DEFAULT_BROWSER_SETTINGS.newTab.autoRefresh,
    },
    updatedAt,
  };
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(DEFAULT_APPEARANCE_SETTINGS);
  }
  const record = value as Record<string, unknown>;
  return {
    version: APPEARANCE_SETTINGS_VERSION,
    preference: normalizeAppearancePreference(record.preference),
    locale: normalizeLocalePreference(record.locale),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : null,
  };
}

export function normalizePublicPageSettings(value: unknown): PublicPageSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(DEFAULT_PUBLIC_PAGE_SETTINGS);
  }
  const record = value as Record<string, unknown>;
  return {
    version: PUBLIC_PAGE_SETTINGS_VERSION,
    siteTitle: trimmedCappedString(record.siteTitle, 80),
    siteSubtitle: trimmedCappedString(record.siteSubtitle, 200),
    defaultLayout: normalizePublicPageLayout(record.defaultLayout),
    showSearchBar: typeof record.showSearchBar === "boolean"
      ? record.showSearchBar
      : DEFAULT_PUBLIC_PAGE_SETTINGS.showSearchBar,
    showWebSearch: typeof record.showWebSearch === "boolean"
      ? record.showWebSearch
      : DEFAULT_PUBLIC_PAGE_SETTINGS.showWebSearch,
    showCategoryNav: typeof record.showCategoryNav === "boolean"
      ? record.showCategoryNav
      : DEFAULT_PUBLIC_PAGE_SETTINGS.showCategoryNav,
    openInNewTab: typeof record.openInNewTab === "boolean"
      ? record.openInNewTab
      : DEFAULT_PUBLIC_PAGE_SETTINGS.openInNewTab,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : null,
  };
}

export function normalizeAiSettings(value: unknown): AiSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(DEFAULT_AI_SETTINGS);
  }
  const record = value as Record<string, unknown>;
  const rawEndpoint = trimmedCappedString(record.endpoint, 500);
  return {
    version: AI_SETTINGS_VERSION,
    endpoint: rawEndpoint || DEFAULT_AI_SETTINGS.endpoint,
    model: trimmedCappedString(record.model, 160),
    timeoutSeconds: integerInRange(
      record.timeoutSeconds,
      DEFAULT_AI_SETTINGS.timeoutSeconds,
      15,
      180,
    ),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : null,
  };
}

export function mergeBrowserSettings(
  current: BrowserSettings,
  input: UpdateBrowserSettingsInput,
  updatedAt = new Date().toISOString(),
): BrowserSettings {
  return normalizeBrowserSettings({
    ...current,
    ...(input.conflictPreference === undefined ? {} : { conflictPreference: input.conflictPreference }),
    ...(input.launcherShortcut === undefined ? {} : { launcherShortcut: input.launcherShortcut }),
    ...(input.slashFocus === undefined ? {} : { slashFocus: input.slashFocus }),
    newTab: {
      ...current.newTab,
      ...(input.newTab ?? {}),
    },
    updatedAt,
  });
}

export function mergeAppearanceSettings(
  current: AppearanceSettings,
  input: UpdateAppearanceSettingsInput,
  updatedAt = new Date().toISOString(),
): AppearanceSettings {
  return normalizeAppearanceSettings({
    ...current,
    ...(input.preference === undefined ? {} : { preference: input.preference }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    updatedAt,
  });
}

export function mergePublicPageSettings(
  current: PublicPageSettings,
  input: UpdatePublicPageSettingsInput,
  updatedAt = new Date().toISOString(),
): PublicPageSettings {
  return normalizePublicPageSettings({
    ...current,
    ...(input.siteTitle === undefined ? {} : { siteTitle: input.siteTitle }),
    ...(input.siteSubtitle === undefined ? {} : { siteSubtitle: input.siteSubtitle }),
    ...(input.defaultLayout === undefined ? {} : { defaultLayout: input.defaultLayout }),
    ...(input.showSearchBar === undefined ? {} : { showSearchBar: input.showSearchBar }),
    ...(input.showWebSearch === undefined ? {} : { showWebSearch: input.showWebSearch }),
    ...(input.showCategoryNav === undefined ? {} : { showCategoryNav: input.showCategoryNav }),
    ...(input.openInNewTab === undefined ? {} : { openInNewTab: input.openInNewTab }),
    updatedAt,
  });
}

export function mergeAiSettings(
  current: AiSettings,
  input: UpdateAiSettingsInput,
  updatedAt = new Date().toISOString(),
): AiSettings {
  return normalizeAiSettings({
    ...current,
    ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.timeoutSeconds === undefined ? {} : { timeoutSeconds: input.timeoutSeconds }),
    updatedAt,
  });
}
