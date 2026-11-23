/**
 * [INPUT]: depends on DEFAULT_BROWSER_SETTINGS and normalizeBrowserSettings from @dockmark/core; depends on newTabI18n from ./i18n; depends on NewTabElements, NewTabState, DockmarkAppearanceApi, emptySnapshot from ./types
 * [OUTPUT]: exports shared newTabState singleton, resolveNewTabElements, getAppearanceApi, and installNewTabWindowHooks for Playwright smoke parity
 * [POS]: central reactive state container and global test-hook bridge in apps/extension/lib/newtab
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  DEFAULT_BROWSER_SETTINGS,
  normalizeBrowserSettings,
  type BrowserSettings,
} from "@dockmark/core";
import { newTabI18n } from "./i18n";
import {
  emptySnapshot,
  type DockmarkAppearanceApi,
  type NewTabElements,
  type NewTabResult,
  type NewTabSnapshot,
  type NewTabState,
  type OpenTabEntry,
} from "./types";

let cachedElements: NewTabElements | null = null;

function requireElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required New Tab element #${id}.`);
  return node as T;
}

export function resolveNewTabElements(): NewTabElements {
  if (cachedElements) return cachedElements;
  cachedElements = {
    connection: requireElement<HTMLElement>("connection-state"),
    themeToggle: document.getElementById("theme-toggle") as HTMLButtonElement | null,
    localeToggle: document.getElementById("locale-toggle") as HTMLButtonElement | null,
    refresh: requireElement<HTMLButtonElement>("refresh"),
    manage: requireElement<HTMLButtonElement>("manage"),
    search: requireElement<HTMLInputElement>("search"),
    searchClear: document.getElementById("search-clear") as HTMLButtonElement | null,
    shortcutKbd: document.getElementById("shortcut-kbd"),
    results: requireElement<HTMLElement>("command-results"),
    offline: requireElement<HTMLElement>("offline-banner"),
    setup: requireElement<HTMLElement>("setup-card"),
    bookmarkFilters: document.getElementById("bookmark-filters"),
    bookmarks: requireElement<HTMLElement>("bookmarks"),
    workspaces: requireElement<HTMLElement>("workspaces"),
    bookmarkCount: requireElement<HTMLElement>("bookmark-count"),
    workspaceCount: requireElement<HTMLElement>("workspace-count"),
    syncStatus: requireElement<HTMLElement>("sync-status"),
    settingsStatus: requireElement<HTMLElement>("settings-status"),
    clearCache: requireElement<HTMLButtonElement>("clear-cache"),
  };
  return cachedElements;
}

export function getAppearanceApi(): DockmarkAppearanceApi | undefined {
  return (window as unknown as { dockmarkAppearance?: DockmarkAppearanceApi }).dockmarkAppearance;
}

export const newTabState: NewTabState = {
  origin: null,
  snapshot: emptySnapshot(),
  settings: normalizeBrowserSettings(DEFAULT_BROWSER_SETTINGS),
  openTabs: [],
  activeResult: 0,
  visibleResults: [],
  refreshing: false,
  activeFilter: { type: "all", id: null },
  connectionState: { key: "starting", customLabel: null, tone: "" },
  offlineState: { key: "", customMessage: "" },
  hasOriginPermission: async () => false,
  requestJson: async () => ({}),
  buildResults: () => [],
  executeResult: async () => undefined,
  refreshCloud: async () => false,
  renderSnapshot: () => undefined,
  renderSearchResults: () => undefined,
};

export function installNewTabWindowHooks(elements: NewTabElements): void {
  Object.defineProperties(window, {
    elements: {
      value: elements,
      writable: true,
      configurable: true,
    },
    origin: {
      get: () => newTabState.origin,
      set: (value: string | null) => {
        newTabState.origin = value;
      },
      configurable: true,
    },
    snapshot: {
      get: () => newTabState.snapshot,
      set: (value: NewTabSnapshot) => {
        newTabState.snapshot = value;
      },
      configurable: true,
    },
    settings: {
      get: () => newTabState.settings,
      set: (value: BrowserSettings) => {
        newTabState.settings = normalizeBrowserSettings(value);
      },
      configurable: true,
    },
    openTabs: {
      get: () => newTabState.openTabs,
      set: (value: OpenTabEntry[]) => {
        newTabState.openTabs = Array.isArray(value) ? value : [];
      },
      configurable: true,
    },
    activeResult: {
      get: () => newTabState.activeResult,
      set: (value: number) => {
        newTabState.activeResult = value;
      },
      configurable: true,
    },
    visibleResults: {
      get: () => newTabState.visibleResults,
      set: (value: NewTabResult[]) => {
        newTabState.visibleResults = Array.isArray(value) ? value : [];
      },
      configurable: true,
    },
    hasOriginPermission: {
      get: () => newTabState.hasOriginPermission,
      set: (fn: () => Promise<boolean>) => {
        newTabState.hasOriginPermission = fn;
      },
      configurable: true,
    },
    requestJson: {
      get: () => newTabState.requestJson,
      set: (fn: (path: string) => Promise<Record<string, unknown>>) => {
        newTabState.requestJson = fn;
      },
      configurable: true,
    },
    normalizeSettings: {
      value: normalizeBrowserSettings,
      writable: true,
      configurable: true,
    },
    buildResults: {
      get: () => newTabState.buildResults,
      set: (fn: (rawQuery: string) => NewTabResult[]) => {
        newTabState.buildResults = fn;
      },
      configurable: true,
    },
    executeResult: {
      get: () => newTabState.executeResult,
      set: (fn: (result: NewTabResult | undefined) => Promise<void>) => {
        newTabState.executeResult = fn;
      },
      configurable: true,
    },
    refreshCloud: {
      get: () => newTabState.refreshCloud,
      set: (fn: (options?: { quiet?: boolean }) => Promise<boolean>) => {
        newTabState.refreshCloud = fn;
      },
      configurable: true,
    },
    renderSnapshot: {
      get: () => newTabState.renderSnapshot,
      set: (fn: () => void) => {
        newTabState.renderSnapshot = fn;
      },
      configurable: true,
    },
    renderSearchResults: {
      get: () => newTabState.renderSearchResults,
      set: (fn: () => void) => {
        newTabState.renderSearchResults = fn;
      },
      configurable: true,
    },
    renderResults: {
      get: () => newTabState.renderSearchResults,
      set: (fn: () => void) => {
        newTabState.renderSearchResults = fn;
      },
      configurable: true,
    },
    dockmarkI18n: {
      value: newTabI18n,
      writable: true,
      configurable: true,
    },
    DOCKMARK_NEWTAB_I18N: {
      value: newTabI18n,
      writable: true,
      configurable: true,
    },
  });
}
