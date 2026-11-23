/**
 * [INPUT]: depends on normalizeBrowserSettings from @dockmark/core; depends on browser from wxt/browser; depends on newTabI18n from ./i18n; depends on status helpers from ./render; depends on getAppearanceApi, newTabState, and resolveNewTabElements from ./state; depends on types/helpers from ./types
 * [OUTPUT]: exports authenticated API transport, single-pass cloud snapshot sync, open-tab loading, command execution (navigate/tab/workspace/session), and cache clearing
 * [POS]: network, storage, and browser-action layer in apps/extension/lib/newtab replacing legacy newtab-auth.js and newtab-library-cache.js
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { normalizeBrowserSettings } from "@dockmark/core";
import { browser, type Browser } from "wxt/browser";
import { newTabI18n } from "./i18n";
import { setConnectionKey, setOfflineKey, setOfflineMessage } from "./render";
import { getAppearanceApi, newTabState, resolveNewTabElements } from "./state";
import {
  CACHE_KEY,
  CACHE_VERSION,
  SERVER_KEY,
  SETTINGS_KEY,
  TOKEN_KEY,
  asArray,
  emptySnapshot,
  isHttpUrl,
  tabMatchKey,
  validOrigin,
  type CachedBookmark,
  type CachedCategory,
  type CachedSearchEngine,
  type CachedSession,
  type CachedSmartCollection,
  type CachedWorkspace,
  type NewTabResult,
  type OpenTabEntry,
} from "./types";

async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  try {
    const requestUrl = new URL(input, window.location.href);
    const stored = await browser.storage.local.get([SERVER_KEY, TOKEN_KEY]);
    const storedOrigin = typeof stored[SERVER_KEY] === "string" ? stored[SERVER_KEY] : "";
    const token = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
    if (storedOrigin && token && requestUrl.origin === storedOrigin && requestUrl.pathname.startsWith("/api/")) {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      return window.fetch(input, { ...init, headers });
    }
  } catch {
    // Fall through to unauthenticated fetch; caller handles offline fallback.
  }
  return window.fetch(input, init);
}

export async function defaultRequestJson(path: string): Promise<Record<string, unknown>> {
  const response = await authFetch(new URL(path, `${newTabState.origin}/`).toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Dockmark returned ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

export async function defaultHasOriginPermission(): Promise<boolean> {
  if (!newTabState.origin) return false;
  try {
    return await browser.permissions.contains({ origins: [`${newTabState.origin}/*`] });
  } catch {
    return false;
  }
}

export async function patchCloudAppearance(payload: Record<string, unknown>): Promise<void> {
  if (!newTabState.origin || !(await newTabState.hasOriginPermission())) return;
  try {
    await authFetch(new URL("/api/settings/appearance", `${newTabState.origin}/`).toString(), {
      method: "PATCH",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort cloud preference sync.
  }
}

export async function loadOpenTabs(): Promise<void> {
  if (!newTabState.settings.newTab.showOpenTabs) {
    newTabState.openTabs = [];
    return;
  }
  try {
    const tabs = await browser.tabs.query({});
    newTabState.openTabs = tabs.flatMap((tab): OpenTabEntry[] => (
      tab.id == null || tab.windowId == null || !isHttpUrl(tab.url)
        ? []
        : [{ id: tab.id, windowId: tab.windowId, title: tab.title || tab.url, url: tab.url, active: Boolean(tab.active) }]
    ));
  } catch {
    newTabState.openTabs = [];
  }
}

export async function defaultRefreshCloud({ quiet = false }: { quiet?: boolean } = {}): Promise<boolean> {
  if (newTabState.refreshing || !newTabState.origin) return false;
  const elements = resolveNewTabElements();
  newTabState.refreshing = true;
  if (!quiet) setConnectionKey("refreshing");

  try {
    if (!(await newTabState.hasOriginPermission())) {
      throw new Error(
        newTabI18n.tx(
          "Dockmark site access is not granted. Open the extension popup and reconnect this origin.",
          "尚未授予 Dockmark 站点访问权限，请打开扩展弹窗重新连接该地址。",
        ),
      );
    }

    const previousSessions = asArray<CachedSession>(newTabState.snapshot.sessions);
    const [bookmarkPayload, categoryPayload, workspacePayload, enginePayload, settingsPayload, appearancePayload] = await Promise.all([
      newTabState.requestJson("/api/bookmarks"),
      newTabState.requestJson("/api/categories"),
      newTabState.requestJson("/api/workspaces"),
      newTabState.requestJson("/api/search-engines"),
      newTabState.requestJson("/api/settings/browser"),
      newTabState.requestJson("/api/settings/appearance").catch(() => null),
    ]);

    let sessions = previousSessions;
    try {
      const sessionPayload = await newTabState.requestJson("/api/sessions");
      sessions = asArray<CachedSession>(sessionPayload?.sessions);
    } catch {
      // Sessions are additive launcher data; keep previous cached sessions on failure.
    }

    const rawTags = settingsPayload?.bookmarkTags;
    const bookmarkTags: Record<string, unknown> = rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)
      ? (rawTags as Record<string, unknown>)
      : {};

    newTabState.settings = normalizeBrowserSettings(settingsPayload?.settings);
    const remoteAppearance = appearancePayload?.settings as { preference?: unknown; locale?: unknown } | undefined;
    const appearanceApi = getAppearanceApi();
    const appearancePreference = appearanceApi?.apply(
      remoteAppearance?.preference ?? newTabState.snapshot.appearancePreference ?? "system",
    ) ?? "system";
    const remoteLocale = typeof remoteAppearance?.locale === "string" ? remoteAppearance.locale : null;
    const localePreference = remoteLocale
      ? newTabI18n.apply(remoteLocale).preference
      : newTabI18n.currentPreference();

    newTabState.snapshot = {
      version: CACHE_VERSION,
      origin: newTabState.origin,
      syncedAt: new Date().toISOString(),
      bookmarks: asArray<CachedBookmark>(bookmarkPayload?.bookmarks).map((bookmark) => ({
        ...bookmark,
        tags: asArray<unknown>(bookmarkTags[bookmark?.id])
          .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0),
      })),
      categories: asArray<CachedCategory>(categoryPayload?.categories),
      workspaces: asArray<CachedWorkspace>(workspacePayload?.workspaces),
      sessions,
      searchEngines: asArray<CachedSearchEngine>(enginePayload?.engines),
      smartCollections: asArray<CachedSmartCollection>(settingsPayload?.smartCollections),
      inboxBookmarkIds: asArray<unknown>(settingsPayload?.inboxBookmarkIds)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      appearancePreference,
      localePreference,
    };

    await browser.storage.local.set({
      [CACHE_KEY]: newTabState.snapshot,
      [SETTINGS_KEY]: newTabState.settings,
    });
    await loadOpenTabs();
    setConnectionKey("online", "online");
    setOfflineMessage("");
    elements.setup.hidden = true;
    newTabState.renderSnapshot();
    return true;
  } catch (error) {
    const hasCache = Boolean(
      newTabState.snapshot.syncedAt
      || newTabState.snapshot.bookmarks.length > 0
      || newTabState.snapshot.workspaces.length > 0,
    );
    setConnectionKey(hasCache ? "offline-cache" : "offline", "offline");
    if (hasCache) {
      setOfflineKey("refresh-failed-cached");
    } else {
      setOfflineMessage(
        error instanceof Error
          ? error.message
          : newTabI18n.tx(
              "Dockmark is unavailable and there is no local snapshot yet.",
              "无法连接 Dockmark，且当前没有可用的本地快照。",
            ),
      );
    }
    elements.setup.hidden = hasCache;
    return false;
  } finally {
    newTabState.refreshing = false;
  }
}

export async function navigateCurrent(url: string): Promise<void> {
  if (!isHttpUrl(url)) return;
  try {
    await browser.tabs.update({ url });
  } catch {
    window.location.assign(url);
  }
}

async function activateTab(tab: OpenTabEntry): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

async function openWorkspace(workspace: CachedWorkspace): Promise<void> {
  const items = asArray(workspace?.items)
    .filter((item) => isHttpUrl(item?.url))
    .map((item) => ({
      url: item.url,
      openMode: item.openMode === "new-tab" || item.openMode === "pinned" ? item.openMode : "reuse",
    }));
  if (items.length === 0) return;

  const current = await browser.tabs.getCurrent().catch(() => undefined);
  const tabs = await browser.tabs.query({});
  const byUrl = new Map<string, Browser.tabs.Tab>();
  for (const tab of tabs) {
    if (tab.id == null || !isHttpUrl(tab.url)) continue;
    const key = tabMatchKey(tab.url);
    if (!byUrl.has(key)) byUrl.set(key, tab);
  }

  let firstTabId: number | null = null;
  for (const item of items) {
    const key = tabMatchKey(item.url);
    const reusable = item.openMode === "new-tab" ? undefined : byUrl.get(key);
    if (reusable?.id != null) {
      if (item.openMode === "pinned" && !reusable.pinned) {
        await browser.tabs.update(reusable.id, { pinned: true });
      }
      firstTabId ??= reusable.id;
      continue;
    }
    const created = await browser.tabs.create({ url: item.url, active: false, pinned: item.openMode === "pinned" });
    if (created.id == null) continue;
    firstTabId ??= created.id;
    byUrl.set(key, created);
  }

  if (firstTabId != null) {
    const first = await browser.tabs.update(firstTabId, { active: true });
    if (first?.windowId != null) await browser.windows.update(first.windowId, { focused: true });
  }
  if (current?.id != null && current.id !== firstTabId) {
    await browser.tabs.remove(current.id).catch(() => undefined);
  }
}

async function restoreSession(session: CachedSession): Promise<void> {
  const items = asArray(session?.items)
    .filter((item) => isHttpUrl(item?.url))
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  if (items.length === 0) return;

  const current = await browser.tabs.getCurrent().catch(() => undefined);
  const createdTabIds: number[] = [];
  for (const item of items.slice(0, 300)) {
    const created = await browser.tabs.create({
      url: item.url,
      active: false,
      pinned: Boolean(item.pinned),
    });
    if (created.id != null) createdTabIds.push(created.id);
  }

  const firstTabId = createdTabIds[0];
  if (firstTabId != null) {
    const first = await browser.tabs.update(firstTabId, { active: true });
    if (first?.windowId != null) await browser.windows.update(first.windowId, { focused: true });
  }
  if (current?.id != null && current.id !== firstTabId) {
    await browser.tabs.remove(current.id).catch(() => undefined);
  }
}

export async function defaultExecuteResult(result: NewTabResult | undefined): Promise<void> {
  if (!result) return;
  const elements = resolveNewTabElements();
  if (result.kind === "search-shortcut" && result.engine?.keyword) {
    elements.search.value = `!${result.engine.keyword} `;
    newTabState.activeResult = 0;
    newTabState.renderSearchResults();
    elements.search.focus();
    return;
  }
  if (result.kind === "collection" && result.collection?.name) {
    elements.search.value = `@${result.collection.name}`;
    newTabState.activeResult = 0;
    newTabState.renderSearchResults();
    elements.search.focus();
    return;
  }
  if (result.kind === "session" && result.session) {
    await restoreSession(result.session);
    return;
  }
  if (result.kind === "tab" && result.tab) {
    await activateTab(result.tab);
    return;
  }
  if (result.kind === "workspace" && result.workspace) {
    await openWorkspace(result.workspace);
    return;
  }
  if (result.url) {
    await navigateCurrent(result.url);
  }
}

export async function openResultInTab(result: NewTabResult | undefined, active: boolean): Promise<void> {
  const url = result?.kind === "tab" ? result.tab?.url : result?.url;
  if (!isHttpUrl(url)) {
    await newTabState.executeResult(result);
    return;
  }
  await browser.tabs.create({ url, active });
}

export async function openManagePage(): Promise<void> {
  const elements = resolveNewTabElements();
  const stored = await browser.storage.local.get(SERVER_KEY).catch(() => ({} as Record<string, unknown>));
  const targetOrigin = validOrigin(stored[SERVER_KEY]) || newTabState.origin;
  if (!targetOrigin) {
    elements.setup.hidden = false;
    setOfflineKey("connect-first");
    return;
  }
  const target = new URL("/app", `${targetOrigin}/`).toString();
  await navigateCurrent(target);
}

export async function clearLocalSnapshot(): Promise<void> {
  const elements = resolveNewTabElements();
  await browser.storage.local.remove(CACHE_KEY);
  newTabState.snapshot = emptySnapshot();
  newTabState.activeFilter = { type: "all", id: null };
  elements.search.value = "";
  newTabState.visibleResults = [];
  newTabState.activeResult = 0;
  newTabState.renderSnapshot();
  setConnectionKey(newTabState.origin ? "cache-cleared" : "not-connected", newTabState.origin ? "offline" : "");
  setOfflineKey(newTabState.origin ? "cache-cleared-connected" : "cache-cleared-local");
  elements.setup.hidden = Boolean(newTabState.origin);
}
