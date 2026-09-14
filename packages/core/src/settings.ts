import type { Id } from "./models";

export const BROWSER_SETTINGS_VERSION = 1;
export const APPEARANCE_SETTINGS_VERSION = 1;

export type BookmarkConflictPreference = "ask" | "browser" | "dockmark";
export type AppearancePreference = "system" | "light" | "dark";

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
  newTab: BrowserNewTabSettings;
  updatedAt: string | null;
}

export interface UpdateBrowserSettingsInput {
  conflictPreference?: BookmarkConflictPreference;
  newTab?: Partial<BrowserNewTabSettings>;
}

export interface AppearanceSettings {
  version: typeof APPEARANCE_SETTINGS_VERSION;
  preference: AppearancePreference;
  updatedAt: string | null;
}

export interface UpdateAppearanceSettingsInput {
  preference?: AppearancePreference;
}

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  version: BROWSER_SETTINGS_VERSION,
  conflictPreference: "ask",
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
  updatedAt: null,
};

function integerInRange(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function conflictPreference(value: unknown): BookmarkConflictPreference {
  return value === "browser" || value === "dockmark" || value === "ask" ? value : "ask";
}

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
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
    updatedAt,
  });
}
