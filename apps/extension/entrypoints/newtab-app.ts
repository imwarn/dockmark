/**
 * [INPUT]: depends on normalizeBrowserSettings and LauncherShortcutKey from @dockmark/core; depends on browser from wxt/browser; depends on lib/newtab modules (types, i18n, state, search, render, sync)
 * [OUTPUT]: WXT unlisted script bundle (newtab-app.js) initializing the Dockmark New Tab launcher, keyboard shortcuts, storage/tab listeners, and Playwright smoke hooks
 * [POS]: sole body-loaded TypeScript entrypoint for apps/extension/public/newtab.html without injecting chrome_url_overrides into the Standard manifest
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { normalizeBrowserSettings, type LauncherShortcutKey } from "@dockmark/core";
import { browser } from "wxt/browser";
import { bindNewTabI18nListeners, newTabI18n } from "../lib/newtab/i18n";
import {
  defaultRenderSearchResults,
  defaultRenderSnapshot,
  renderConnectionState,
  renderOfflineMessage,
  setConnectionKey,
  setOfflineKey,
  setOfflineMessage,
  syncSearchClearVisibility,
  updateTopbarControls,
} from "../lib/newtab/render";
import { defaultBuildResults } from "../lib/newtab/search";
import {
  getAppearanceApi,
  installNewTabWindowHooks,
  newTabState,
  resolveNewTabElements,
} from "../lib/newtab/state";
import {
  clearLocalSnapshot,
  defaultExecuteResult,
  defaultHasOriginPermission,
  defaultRefreshCloud,
  defaultRequestJson,
  loadOpenTabs,
  openManagePage,
  openResultInTab,
  patchCloudAppearance,
} from "../lib/newtab/sync";
import {
  CACHE_KEY,
  SERVER_KEY,
  SETTINGS_KEY,
  cacheIsUsable,
  validOrigin,
} from "../lib/newtab/types";

function matchesLauncherShortcut(event: KeyboardEvent, shortcut: LauncherShortcutKey): boolean {
  const key = event.key.toLowerCase();
  if (shortcut === "mod-j") {
    return (event.metaKey || event.ctrlKey) && !event.altKey && key === "j";
  }
  if (shortcut === "alt-k") {
    return event.altKey && !event.metaKey && !event.ctrlKey && key === "k";
  }
  return (event.metaKey || event.ctrlKey) && !event.altKey && key === "k";
}

export default defineUnlistedScript(() => {
  const elements = resolveNewTabElements();

  newTabState.hasOriginPermission = defaultHasOriginPermission;
  newTabState.requestJson = defaultRequestJson;
  newTabState.buildResults = defaultBuildResults;
  newTabState.executeResult = defaultExecuteResult;
  newTabState.refreshCloud = defaultRefreshCloud;
  newTabState.renderSnapshot = defaultRenderSnapshot;
  newTabState.renderSearchResults = defaultRenderSearchResults;

  installNewTabWindowHooks(elements);
  bindNewTabI18nListeners();

  function selectedResult() {
    return newTabState.visibleResults[newTabState.activeResult] ?? newTabState.visibleResults[0];
  }

  function focusLauncher(query?: string, select = false): void {
    if (typeof query === "string") {
      elements.search.value = query;
      newTabState.activeResult = 0;
      newTabState.renderSearchResults();
    }
    elements.search.focus();
    if (select) elements.search.select();
  }

  elements.search.addEventListener("input", () => {
    newTabState.activeResult = 0;
    newTabState.renderSearchResults();
  });

  elements.searchClear?.addEventListener("click", () => {
    elements.search.value = "";
    newTabState.activeResult = 0;
    newTabState.visibleResults = [];
    elements.results.hidden = true;
    syncSearchClearVisibility();
    elements.search.focus();
  });

  elements.search.addEventListener("keydown", (event) => {
    const result = selectedResult();

    if (event.key === "ArrowDown" && newTabState.visibleResults.length > 0) {
      event.preventDefault();
      newTabState.activeResult = (newTabState.activeResult + 1) % newTabState.visibleResults.length;
      newTabState.renderSearchResults();
      return;
    }

    if (event.key === "ArrowUp" && newTabState.visibleResults.length > 0) {
      event.preventDefault();
      newTabState.activeResult = (newTabState.activeResult - 1 + newTabState.visibleResults.length) % newTabState.visibleResults.length;
      newTabState.renderSearchResults();
      return;
    }

    if (event.key === "Tab" && result?.kind === "search-shortcut") {
      event.preventDefault();
      void newTabState.executeResult(result);
      return;
    }

    if (event.key === "Enter" && result) {
      event.preventDefault();
      if (result.kind === "search-shortcut") {
        void newTabState.executeResult(result);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        void openResultInTab(result, false);
        return;
      }
      if (event.shiftKey) {
        void openResultInTab(result, true);
        return;
      }
      void newTabState.executeResult(result);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (!elements.search.value) {
        elements.search.blur();
        return;
      }
      elements.search.value = "";
      newTabState.visibleResults = [];
      elements.results.hidden = true;
      syncSearchClearVisibility();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (matchesLauncherShortcut(event, newTabState.settings.launcherShortcut)) {
      event.preventDefault();
      focusLauncher(undefined, true);
      return;
    }
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (!newTabState.settings.slashFocus) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    focusLauncher(undefined, true);
  });

  elements.themeToggle?.addEventListener("click", () => {
    const next = getAppearanceApi()?.cycle();
    updateTopbarControls();
    if (next) void patchCloudAppearance({ preference: next });
  });

  elements.localeToggle?.addEventListener("click", () => {
    const next = newTabI18n.toggleLocale();
    updateTopbarControls();
    void patchCloudAppearance({ locale: next.preference });
  });

  window.addEventListener("dockmark:appearance", () => updateTopbarControls());
  window.addEventListener("dockmark:locale", () => {
    updateTopbarControls();
    renderConnectionState();
    renderOfflineMessage();
    newTabState.renderSnapshot();
  });

  elements.refresh.addEventListener("click", () => void newTabState.refreshCloud());
  elements.clearCache.addEventListener("click", () => void clearLocalSnapshot());
  elements.manage.addEventListener("click", () => void openManagePage());

  browser.tabs.onCreated?.addListener(() => void loadOpenTabs().then(() => newTabState.renderSearchResults()));
  browser.tabs.onRemoved?.addListener(() => void loadOpenTabs().then(() => newTabState.renderSearchResults()));
  browser.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
    if (changeInfo.url !== undefined || changeInfo.title !== undefined) {
      void loadOpenTabs().then(() => newTabState.renderSearchResults());
    }
  });

  browser.runtime.onMessage?.addListener((message: unknown) => {
    const payload = message as { type?: string; query?: unknown } | null | undefined;
    if (payload?.type !== "dockmark:focus-launcher") return undefined;
    focusLauncher(typeof payload.query === "string" ? payload.query : undefined, typeof payload.query !== "string");
    return { ok: true };
  });

  window.addEventListener("online", () => {
    if (newTabState.settings.newTab.autoRefresh) void newTabState.refreshCloud({ quiet: true });
  });

  async function bootstrap(): Promise<void> {
    newTabI18n.applyStaticDom();
    updateTopbarControls();
    await Promise.all([getAppearanceApi()?.hydrate?.(), newTabI18n.hydrate()]);

    const stored = await browser.storage.local.get([SERVER_KEY, CACHE_KEY, SETTINGS_KEY]);
    newTabState.origin = validOrigin(stored[SERVER_KEY]);
    newTabState.settings = normalizeBrowserSettings(stored[SETTINGS_KEY]);
    if (cacheIsUsable(stored[CACHE_KEY], newTabState.origin)) {
      newTabState.snapshot = stored[CACHE_KEY];
    }
    if (newTabState.snapshot.appearancePreference) {
      getAppearanceApi()?.apply(newTabState.snapshot.appearancePreference);
    }
    if (
      newTabState.snapshot.localePreference
      && localStorage.getItem(newTabI18n.STORAGE_KEY) === null
    ) {
      newTabI18n.apply(newTabState.snapshot.localePreference, false);
    }

    const initialQuery = new URL(window.location.href).searchParams.get("q");
    if (initialQuery) {
      elements.search.value = initialQuery;
      window.history.replaceState({}, "", window.location.pathname);
    }

    updateTopbarControls();
    await loadOpenTabs();
    newTabState.renderSnapshot();

    if (!newTabState.origin) {
      setConnectionKey(
        newTabState.snapshot.syncedAt ? "cached-not-connected" : "not-connected",
        newTabState.snapshot.syncedAt ? "offline" : "",
      );
      if (newTabState.snapshot.syncedAt) setOfflineKey("no-origin-cached");
      else setOfflineMessage("");
      elements.setup.hidden = Boolean(newTabState.snapshot.syncedAt);
      return;
    }

    if (newTabState.snapshot.syncedAt && !newTabState.settings.newTab.autoRefresh) {
      setConnectionKey("cached-manual");
      elements.setup.hidden = true;
      return;
    }

    setConnectionKey(newTabState.snapshot.syncedAt ? "cached-refreshing" : "connecting");
    if (newTabState.snapshot.syncedAt) elements.setup.hidden = true;
    void newTabState.refreshCloud({ quiet: Boolean(newTabState.snapshot.syncedAt) });
  }

  void bootstrap();
});
