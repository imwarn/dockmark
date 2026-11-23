/**
 * [INPUT]: depends on chrome.storage.local, chrome.tabs, chrome.windows, chrome.permissions, window.dockmarkAppearance, and window.dockmarkI18n
 * [OUTPUT]: defines shared launcher state (origin, snapshot, settings, openTabs, visibleResults), filter pills, bookmark/workspace rendering, and command execution
 * [POS]: core runtime for apps/extension/public/newtab.html extended by newtab-library-cache.js, newtab-search.js, newtab-ux.js, and newtab-parity.js
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
const SERVER_KEY = "dockmarkServerUrl";
const CACHE_KEY = "dockmarkNewTabCacheV1";
const SETTINGS_KEY = "dockmarkBrowserSettingsV1";
const CACHE_VERSION = 1;
const SETTINGS_VERSION = 1;
const DEFAULT_SEARCH_URL = "https://www.google.com/search?q=%s";

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  conflictPreference: "ask",
  newTab: { defaultSearchEngineId: null, showOpenTabs: true, bookmarkLimit: 12, workspaceLimit: 8, autoRefresh: true },
  updatedAt: null,
};

const elements = {
  connection: document.getElementById("connection-state"),
  themeToggle: document.getElementById("theme-toggle"),
  localeToggle: document.getElementById("locale-toggle"),
  refresh: document.getElementById("refresh"),
  manage: document.getElementById("manage"),
  search: document.getElementById("search"),
  results: document.getElementById("command-results"),
  offline: document.getElementById("offline-banner"),
  setup: document.getElementById("setup-card"),
  bookmarkFilters: document.getElementById("bookmark-filters"),
  bookmarks: document.getElementById("bookmarks"),
  workspaces: document.getElementById("workspaces"),
  bookmarkCount: document.getElementById("bookmark-count"),
  workspaceCount: document.getElementById("workspace-count"),
  syncStatus: document.getElementById("sync-status"),
  settingsStatus: document.getElementById("settings-status"),
  clearCache: document.getElementById("clear-cache"),
};

let origin = null;
let snapshot = emptySnapshot();
let settings = normalizeSettings(DEFAULT_SETTINGS);
let openTabs = [];
let activeResult = 0;
let visibleResults = [];
let refreshing = false;
let activeFilter = { type: "all", id: null };
let connectionState = { key: "starting", customLabel: null, tone: "" };
let offlineState = { key: "", customMessage: "" };

function tx(en, zh) {
  return window.dockmarkI18n ? window.dockmarkI18n.tx(en, zh) : en;
}

function emptySnapshot() {
  return {
    version: CACHE_VERSION, origin: "", syncedAt: null,
    bookmarks: [], categories: [], workspaces: [], searchEngines: [],
    smartCollections: [], inboxBookmarkIds: [],
    appearancePreference: "system", localePreference: "system",
  };
}

function normalizeSettings(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawNewTab = input.newTab && typeof input.newTab === "object" && !Array.isArray(input.newTab) ? input.newTab : {};
  const conflictPreference = input.conflictPreference === "browser" || input.conflictPreference === "dockmark" ? input.conflictPreference : "ask";
  const defaultSearchEngineId = typeof rawNewTab.defaultSearchEngineId === "string" && rawNewTab.defaultSearchEngineId.trim() ? rawNewTab.defaultSearchEngineId.trim() : null;
  const bookmarkLimit = Number.isInteger(rawNewTab.bookmarkLimit) ? Math.min(24, Math.max(0, rawNewTab.bookmarkLimit)) : DEFAULT_SETTINGS.newTab.bookmarkLimit;
  const workspaceLimit = Number.isInteger(rawNewTab.workspaceLimit) ? Math.min(12, Math.max(0, rawNewTab.workspaceLimit)) : DEFAULT_SETTINGS.newTab.workspaceLimit;

  return {
    version: SETTINGS_VERSION,
    conflictPreference,
    newTab: {
      defaultSearchEngineId,
      showOpenTabs: typeof rawNewTab.showOpenTabs === "boolean" ? rawNewTab.showOpenTabs : DEFAULT_SETTINGS.newTab.showOpenTabs,
      bookmarkLimit,
      workspaceLimit,
      autoRefresh: typeof rawNewTab.autoRefresh === "boolean" ? rawNewTab.autoRefresh : DEFAULT_SETTINGS.newTab.autoRefresh,
    },
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : null,
  };
}

function validOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch { return null; }
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

function tabMatchKey(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch { return value; }
}

function asArray(value) { return Array.isArray(value) ? value : []; }

function normalizedTags(bookmark) {
  return asArray(bookmark?.tags).filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim());
}

function cacheIsUsable(value, expectedOrigin) {
  return Boolean(
    value && typeof value === "object" && value.version === CACHE_VERSION &&
    typeof value.origin === "string" && (!expectedOrigin || value.origin === expectedOrigin) &&
    Array.isArray(value.bookmarks) && Array.isArray(value.workspaces),
  );
}

function timeAgo(value) {
  return window.dockmarkI18n ? window.dockmarkI18n.formatRelativeTime(value) : String(value || "never");
}

function displayHost(url) {
  try { return new URL(url).host; } catch { return url; }
}

function hostMonogram(url, fallbackTitle) {
  const host = displayHost(url).replace(/^www\./i, "");
  const match = String(host || fallbackTitle || "D").match(/[A-Za-z0-9\u4e00-\u9fff]/);
  return (match?.[0] || "D").toUpperCase();
}

function categoryName(categoryId) {
  if (!categoryId) return tx("Uncategorized", "未分类");
  return snapshot.categories.find((category) => category?.id === categoryId)?.name || tx("Uncategorized", "未分类");
}

function collectionMatchesBookmark(collection, bookmark) {
  if (!collection || !isHttpUrl(bookmark?.url)) return false;
  const filters = collection.filters && typeof collection.filters === "object" && !Array.isArray(collection.filters) ? collection.filters : {};
  if (Object.prototype.hasOwnProperty.call(filters, "categoryId")) {
    if (filters.categoryId === null ? Boolean(bookmark.categoryId) : bookmark.categoryId !== filters.categoryId) return false;
  }
  if (Array.isArray(filters.tags) && filters.tags.length) {
    const tags = new Set(normalizedTags(bookmark).map((tag) => tag.toLocaleLowerCase()));
    if (!filters.tags.every((tag) => typeof tag === "string" && tags.has(tag.toLocaleLowerCase()))) return false;
  }
  if (typeof filters.domain === "string" && filters.domain) {
    let host = "";
    try { host = new URL(bookmark.url).hostname.toLocaleLowerCase(); } catch { return false; }
    const domain = filters.domain.toLocaleLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) return false;
  }
  if (typeof filters.healthStatus === "string" && bookmark.healthStatus !== filters.healthStatus) return false;
  const inboxIds = new Set(asArray(snapshot.inboxBookmarkIds).filter((id) => typeof id === "string" && id.trim()));
  if (filters.inbox === "inbox" && !inboxIds.has(bookmark.id)) return false;
  if (filters.inbox === "library" && inboxIds.has(bookmark.id)) return false;
  return true;
}

function renderConnectionState() {
  const label = connectionState.customLabel ?? (window.dockmarkI18n ? window.dockmarkI18n.connectionText(connectionState.key) : connectionState.key);
  elements.connection.textContent = label;
  elements.connection.className = `state-chip${connectionState.tone ? ` ${connectionState.tone}` : ""}`;
}

function setConnection(label, tone = "") {
  connectionState = { key: "", customLabel: label, tone };
  renderConnectionState();
}

function setConnectionKey(key, tone = "") {
  connectionState = { key, customLabel: null, tone };
  renderConnectionState();
}

function renderOfflineMessage() {
  const message = offlineState.customMessage || (window.dockmarkI18n ? window.dockmarkI18n.offlineText(offlineState.key, snapshot.syncedAt) : "");
  elements.offline.textContent = message;
  elements.offline.hidden = !message;
}

function setOfflineMessage(message) {
  offlineState = { key: "", customMessage: message || "" };
  renderOfflineMessage();
}

function setOfflineKey(key) {
  offlineState = { key, customMessage: "" };
  renderOfflineMessage();
}

function updateTopbarControls() {
  if (elements.themeToggle && window.dockmarkAppearance) {
    const pref = window.dockmarkAppearance.current();
    const icons = { system: "◐", light: "☀", dark: "☾" };
    const labels = {
      system: tx("Theme: System (click to switch)", "主题：跟随系统（点击切换）"),
      light: tx("Theme: Light (click to switch)", "主题：浅色（点击切换）"),
      dark: tx("Theme: Dark (click to switch)", "主题：深色（点击切换）"),
    };
    elements.themeToggle.textContent = icons[pref] || "◐";
    elements.themeToggle.title = labels[pref] || labels.system;
    elements.themeToggle.setAttribute("aria-label", labels[pref] || labels.system);
  }
  if (elements.localeToggle && window.dockmarkI18n) {
    const locale = window.dockmarkI18n.currentLocale();
    elements.localeToggle.textContent = locale === "zh-CN" ? "EN" : "中文";
    const title = locale === "zh-CN" ? "Switch to English" : "切换为简体中文";
    elements.localeToggle.title = title;
    elements.localeToggle.setAttribute("aria-label", title);
  }
}

async function patchCloudAppearance(payload) {
  if (!origin || !(await hasOriginPermission())) return;
  try {
    await fetch(new URL("/api/settings/appearance", `${origin}/`).toString(), {
      method: "PATCH", cache: "no-store", credentials: "omit",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch { /* best-effort cloud sync */ }
}

function renderEmpty(container, message) {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  container.append(empty);
}

function settingsSummary() {
  const tabs = settings.newTab.showOpenTabs ? tx("tabs on", "标签页开") : tx("tabs off", "标签页关");
  const refresh = settings.newTab.autoRefresh ? tx("auto refresh", "自动刷新") : tx("manual refresh", "手动刷新");
  return tx(
    `${settings.newTab.bookmarkLimit} bookmarks · ${settings.newTab.workspaceLimit} workspaces · ${tabs} · ${refresh}`,
    `${settings.newTab.bookmarkLimit} 条书签 · ${settings.newTab.workspaceLimit} 个工作区 · ${tabs} · ${refresh}`,
  );
}

function renderBookmarkFilters(allBookmarks) {
  const container = elements.bookmarkFilters;
  if (!container) return;
  const collections = asArray(snapshot.smartCollections).filter((c) => typeof c?.name === "string" && c.name.trim()).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const categories = asArray(snapshot.categories).filter((c) => typeof c?.name === "string" && c.name.trim()).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (activeFilter.type === "collection" && !collections.some((c) => c.id === activeFilter.id)) activeFilter = { type: "all", id: null };
  else if (activeFilter.type === "category" && activeFilter.id !== "__uncategorized__" && !categories.some((c) => c.id === activeFilter.id)) activeFilter = { type: "all", id: null };

  if (!collections.length && !categories.length) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.replaceChildren();

  const makePill = (label, filter, isCollection = false) => {
    const isActive = activeFilter.type === filter.type && activeFilter.id === filter.id;
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.setAttribute("aria-selected", String(isActive));
    button.className = `filter-pill${isCollection ? " is-collection" : ""}${isActive ? " active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      activeFilter = isActive && filter.type !== "all" ? { type: "all", id: null } : filter;
      renderSnapshot();
    });
    return button;
  };

  container.append(makePill(tx("All", "全部"), { type: "all", id: null }));
  for (const collection of collections) container.append(makePill(collection.name.trim(), { type: "collection", id: collection.id }, true));
  for (const category of categories) container.append(makePill(category.name.trim(), { type: "category", id: category.id }, false));
  if (categories.length && allBookmarks.some((b) => !b.categoryId)) {
    container.append(makePill(tx("Uncategorized", "未分类"), { type: "category", id: "__uncategorized__" }, false));
  }
}

function applyActiveBookmarkFilter(bookmarks) {
  if (activeFilter.type === "collection") {
    const collection = asArray(snapshot.smartCollections).find((item) => item?.id === activeFilter.id);
    return collection ? bookmarks.filter((bookmark) => collectionMatchesBookmark(collection, bookmark)) : bookmarks;
  }
  if (activeFilter.type === "category") {
    return activeFilter.id === "__uncategorized__"
      ? bookmarks.filter((bookmark) => !bookmark.categoryId)
      : bookmarks.filter((bookmark) => bookmark.categoryId === activeFilter.id);
  }
  return bookmarks;
}

function renderSnapshot() {
  const bookmarks = [...snapshot.bookmarks].filter((b) => isHttpUrl(b?.url)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const workspaces = [...snapshot.workspaces].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const bookmarkLimit = settings.newTab.bookmarkLimit;
  const workspaceLimit = settings.newTab.workspaceLimit;

  renderBookmarkFilters(bookmarks);
  const filteredBookmarks = applyActiveBookmarkFilter(bookmarks);
  const isFiltered = activeFilter.type !== "all";

  elements.bookmarkCount.textContent = isFiltered
    ? tx(`${filteredBookmarks.length} matching`, `匹配 ${filteredBookmarks.length} 条`)
    : bookmarkLimit < bookmarks.length
      ? tx(`${bookmarks.length} cached · ${bookmarkLimit} shown`, `${bookmarks.length} 条已缓存 · 显示 ${bookmarkLimit} 条`)
      : tx(`${bookmarks.length} cached`, `${bookmarks.length} 条已缓存`);

  elements.workspaceCount.textContent = workspaceLimit < workspaces.length
    ? tx(`${workspaces.length} cached · ${workspaceLimit} shown`, `${workspaces.length} 个已缓存 · 显示 ${workspaceLimit} 个`)
    : tx(`${workspaces.length} cached`, `${workspaces.length} 个已缓存`);

  elements.syncStatus.textContent = snapshot.syncedAt
    ? tx(`Local snapshot synced ${timeAgo(snapshot.syncedAt)}.`, `本地快照同步于 ${timeAgo(snapshot.syncedAt)}。`)
    : tx("No local snapshot yet.", "暂无本地快照。");
  elements.settingsStatus.textContent = settingsSummary();

  elements.bookmarks.replaceChildren();
  if (bookmarkLimit === 0) {
    renderEmpty(elements.bookmarks, tx("Bookmark cards are hidden by New Tab settings. They remain available in command search.", "新标签页设置已隐藏书签卡片，仍可通过上方搜索框检索。"));
  } else {
    const visibleList = isFiltered ? filteredBookmarks.slice(0, Math.max(bookmarkLimit, 24)) : filteredBookmarks.slice(0, bookmarkLimit);
    for (const bookmark of visibleList) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bookmark-card";
      const monogram = document.createElement("span");
      monogram.className = "card-monogram";
      monogram.setAttribute("aria-hidden", "true");
      monogram.textContent = hostMonogram(bookmark.url, bookmark.title);
      const body = document.createElement("span");
      body.className = "bookmark-card-body";
      const title = document.createElement("strong");
      title.textContent = bookmark.title || bookmark.url;
      const metaRow = document.createElement("span");
      metaRow.className = "bookmark-card-meta";
      const meta = document.createElement("small");
      meta.textContent = `${categoryName(bookmark.categoryId)} · ${displayHost(bookmark.url)}`;
      metaRow.append(meta);
      const tags = normalizedTags(bookmark);
      if (tags.length) {
        const tagPill = document.createElement("span");
        tagPill.className = "bookmark-tag-pill";
        tagPill.textContent = `#${tags[0]}`;
        metaRow.append(tagPill);
      }
      body.append(title, metaRow);
      button.append(monogram, body);
      button.addEventListener("click", () => void navigateCurrent(bookmark.url));
      elements.bookmarks.append(button);
    }
    if (!visibleList.length) {
      renderEmpty(elements.bookmarks, isFiltered ? tx("No bookmarks match this filter.", "该筛选条件下暂无书签。") : tx("No cached bookmarks yet. Connect once while online to seed this launcher.", "暂无缓存书签，联网连接一次后将自动同步到本地启动台。"));
    }
  }

  elements.workspaces.replaceChildren();
  if (workspaceLimit === 0) {
    renderEmpty(elements.workspaces, tx("Workspace cards are hidden by New Tab settings. They remain available in command search.", "新标签页设置已隐藏工作区卡片，仍可通过上方搜索框检索。"));
  } else {
    for (const workspace of workspaces.slice(0, workspaceLimit)) {
      const items = asArray(workspace.items).filter((item) => isHttpUrl(item?.url));
      const pinnedCount = items.filter((item) => item?.openMode === "pinned").length;
      const newTabCount = items.filter((item) => item?.openMode === "new-tab").length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "workspace-card";
      button.disabled = !items.length;
      const head = document.createElement("div");
      head.className = "workspace-head";
      const title = document.createElement("strong");
      title.textContent = workspace.name || tx("Workspace", "工作区");
      const action = document.createElement("span");
      action.className = "workspace-action";
      action.textContent = items.length ? tx("Open →", "打开 →") : tx("Empty", "空");
      head.append(title, action);
      const meta = document.createElement("div");
      meta.className = "workspace-meta";
      const count = document.createElement("span");
      count.textContent = tx(`${items.length} tab${items.length === 1 ? "" : "s"}`, `${items.length} 个标签页`);
      meta.append(count);
      if (pinnedCount > 0) {
        const badge = document.createElement("span");
        badge.className = "mode-badge";
        badge.textContent = tx(`${pinnedCount} pinned`, `${pinnedCount} 固定`);
        meta.append(badge);
      }
      if (newTabCount > 0) {
        const badge = document.createElement("span");
        badge.className = "mode-badge";
        badge.textContent = tx(`${newTabCount} new`, `${newTabCount} 新开`);
        meta.append(badge);
      }
      button.append(head, meta);
      button.addEventListener("click", () => void openWorkspace(workspace));
      elements.workspaces.append(button);
    }
    if (!workspaces.length) renderEmpty(elements.workspaces, tx("No cached Workspaces yet.", "暂无缓存工作区。"));
  }

  renderSearchResults();
}

async function requestJson(path) {
  const response = await fetch(new URL(path, `${origin}/`).toString(), {
    method: "GET", cache: "no-store", credentials: "omit", headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Dockmark returned ${response.status}.`);
  return response.json();
}

async function hasOriginPermission() {
  if (!origin) return false;
  try { return await chrome.permissions.contains({ origins: [`${origin}/*`] }); } catch { return false; }
}

async function refreshCloud({ quiet = false } = {}) {
  if (refreshing || !origin) return false;
  refreshing = true;
  if (!quiet) setConnectionKey("refreshing");

  try {
    if (!(await hasOriginPermission())) {
      throw new Error(tx("Dockmark site access is not granted. Open the extension popup and reconnect this origin.", "尚未授予 Dockmark 站点访问权限，请打开扩展弹窗重新连接该地址。"));
    }
    const [bookmarkPayload, categoryPayload, workspacePayload, enginePayload, settingsPayload, appearancePayload] = await Promise.all([
      requestJson("/api/bookmarks"),
      requestJson("/api/categories"),
      requestJson("/api/workspaces"),
      requestJson("/api/search-engines"),
      requestJson("/api/settings/browser"),
      requestJson("/api/settings/appearance").catch(() => null),
    ]);

    settings = normalizeSettings(settingsPayload.settings);
    const appearancePreference = window.dockmarkAppearance?.apply(appearancePayload?.settings?.preference ?? snapshot.appearancePreference ?? "system") ?? "system";
    const remoteLocale = typeof appearancePayload?.settings?.locale === "string" ? appearancePayload.settings.locale : null;
    const localePreference = remoteLocale
      ? (window.dockmarkI18n?.apply(remoteLocale)?.preference ?? "system")
      : (window.dockmarkI18n?.currentPreference() ?? "system");

    snapshot = {
      version: CACHE_VERSION, origin, syncedAt: new Date().toISOString(),
      bookmarks: asArray(bookmarkPayload.bookmarks), categories: asArray(categoryPayload.categories),
      workspaces: asArray(workspacePayload.workspaces), searchEngines: asArray(enginePayload.engines),
      smartCollections: asArray(settingsPayload?.smartCollections), inboxBookmarkIds: asArray(settingsPayload?.inboxBookmarkIds),
      appearancePreference, localePreference,
    };
    await chrome.storage.local.set({ [CACHE_KEY]: snapshot, [SETTINGS_KEY]: settings });
    await loadOpenTabs();
    setConnectionKey("online", "online");
    setOfflineMessage("");
    elements.setup.hidden = true;
    renderSnapshot();
    return true;
  } catch (error) {
    const hasCache = Boolean(snapshot.syncedAt || snapshot.bookmarks.length || snapshot.workspaces.length);
    setConnectionKey(hasCache ? "offline-cache" : "offline", "offline");
    if (hasCache) setOfflineKey("refresh-failed-cached");
    else setOfflineMessage(error instanceof Error ? error.message : tx("Dockmark is unavailable and there is no local snapshot yet.", "无法连接 Dockmark，且当前没有可用的本地快照。"));
    elements.setup.hidden = hasCache;
    return false;
  } finally {
    refreshing = false;
  }
}

async function loadOpenTabs() {
  if (!settings.newTab.showOpenTabs) { openTabs = []; return; }
  try {
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.flatMap((tab) => (
      tab.id == null || tab.windowId == null || !isHttpUrl(tab.url)
        ? []
        : [{ id: tab.id, windowId: tab.windowId, title: tab.title || tab.url, url: tab.url, active: Boolean(tab.active) }]
    ));
  } catch { openTabs = []; }
}

function searchScore(query, title, subtitle, base) {
  const needle = query.toLocaleLowerCase();
  const primary = String(title || "").toLocaleLowerCase();
  const secondary = String(subtitle || "").toLocaleLowerCase();
  if (primary === needle) return base + 90;
  if (primary.startsWith(needle)) return base + 60;
  if (primary.includes(needle)) return base + 35;
  if (secondary.includes(needle)) return base + 15;
  return -1;
}

function searchUrl(engine, query) {
  const template = typeof engine?.searchUrl === "string" && engine.searchUrl ? engine.searchUrl : DEFAULT_SEARCH_URL;
  const encoded = encodeURIComponent(query);
  if (template.includes("%s")) return template.replaceAll("%s", encoded);
  try {
    const url = new URL(template);
    url.searchParams.set("q", query);
    return url.toString();
  } catch { return DEFAULT_SEARCH_URL.replace("%s", encoded); }
}

function searchEngineCommand(rawQuery) {
  const trimmed = rawQuery.trim();
  for (const engine of snapshot.searchEngines) {
    const keyword = typeof engine?.keyword === "string" ? engine.keyword.trim() : "";
    if (!keyword) continue;
    const form = [`${keyword} `, `!${keyword} `].find((v) => trimmed.toLocaleLowerCase().startsWith(v.toLocaleLowerCase()));
    if (!form) continue;
    const query = trimmed.slice(form.length).trim();
    if (!query) return null;
    return { engine, query };
  }
  return null;
}

function preferredSearchEngine() {
  const configuredId = settings.newTab.defaultSearchEngineId;
  if (configuredId) {
    const configured = snapshot.searchEngines.find((engine) => engine?.id === configuredId);
    if (configured) return configured;
  }
  return snapshot.searchEngines.find((engine) => engine?.isDefault) || snapshot.searchEngines[0];
}

function buildResults(rawQuery) {
  const query = rawQuery.trim();
  if (!query) return [];
  const directEngine = searchEngineCommand(query);
  if (directEngine) {
    return [{ kind: "search", title: tx(`Search ${directEngine.engine.name}`, `使用 ${directEngine.engine.name} 搜索`), subtitle: directEngine.query, url: searchUrl(directEngine.engine, directEngine.query), score: 1000 }];
  }
  const results = [];
  for (const tab of openTabs) {
    const score = searchScore(query, tab.title, tab.url, 500);
    if (score >= 0) results.push({ kind: "tab", title: tab.title, subtitle: tab.url, tab, score });
  }
  for (const workspace of snapshot.workspaces) {
    const count = asArray(workspace.items).length;
    const subtitle = tx(`${count} tab${count === 1 ? "" : "s"}`, `${count} 个标签页`);
    const score = searchScore(query, workspace.name, `${workspace.description || ""} ${subtitle}`, 400);
    if (score >= 0) results.push({ kind: "workspace", title: workspace.name, subtitle, workspace, score });
  }
  for (const bookmark of snapshot.bookmarks) {
    if (!isHttpUrl(bookmark?.url)) continue;
    const score = searchScore(query, bookmark.title, `${bookmark.url} ${categoryName(bookmark.categoryId)}`, 300);
    if (score >= 0) results.push({ kind: "bookmark", title: bookmark.title || bookmark.url, subtitle: bookmark.url, url: bookmark.url, score });
  }
  const defaultEngine = preferredSearchEngine();
  results.push({ kind: "search", title: tx(`Search ${defaultEngine?.name || "the web"}`, `使用 ${defaultEngine?.name || "网页搜索"} 搜索`), subtitle: query, url: searchUrl(defaultEngine, query), score: 100 });
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

function syncActiveResultStyles() {
  elements.results.querySelectorAll(".result-row").forEach((row, index) => row.classList.toggle("active", index === activeResult));
}

function renderSearchResults() {
  visibleResults = buildResults(elements.search.value);
  activeResult = Math.min(activeResult, Math.max(0, visibleResults.length - 1));
  elements.results.replaceChildren();
  elements.results.hidden = !visibleResults.length;

  visibleResults.forEach((result, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `result-row${index === activeResult ? " active" : ""}`;
    const copy = document.createElement("span");
    copy.className = "result-copy";
    const title = document.createElement("strong");
    title.textContent = result.title;
    const subtitle = document.createElement("small");
    subtitle.textContent = result.subtitle || "";
    copy.append(title, subtitle);
    const kind = document.createElement("span");
    kind.className = "result-kind";
    kind.textContent = result.kind;
    row.append(copy, kind);
    row.addEventListener("mouseenter", () => { activeResult = index; syncActiveResultStyles(); });
    row.addEventListener("click", () => void executeResult(result));
    elements.results.append(row);
  });
}

async function navigateCurrent(url) {
  if (!isHttpUrl(url)) return;
  try { await chrome.tabs.update({ url }); } catch { window.location.assign(url); }
}

async function activateTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function openWorkspace(workspace) {
  const items = asArray(workspace?.items).filter((item) => isHttpUrl(item?.url)).map((item) => ({
    url: item.url,
    openMode: item.openMode === "new-tab" || item.openMode === "pinned" ? item.openMode : "reuse",
  }));
  if (!items.length) return;
  const current = await chrome.tabs.getCurrent().catch(() => null);
  const tabs = await chrome.tabs.query({});
  const byUrl = new Map();
  for (const tab of tabs) {
    if (tab.id == null || !isHttpUrl(tab.url)) continue;
    const key = tabMatchKey(tab.url);
    if (!byUrl.has(key)) byUrl.set(key, tab);
  }
  let firstTabId = null;
  for (const item of items) {
    const key = tabMatchKey(item.url);
    const reusable = item.openMode === "new-tab" ? null : byUrl.get(key);
    if (reusable?.id != null) {
      if (item.openMode === "pinned" && !reusable.pinned) await chrome.tabs.update(reusable.id, { pinned: true });
      firstTabId ??= reusable.id;
      continue;
    }
    const created = await chrome.tabs.create({ url: item.url, active: false, pinned: item.openMode === "pinned" });
    if (created.id == null) continue;
    firstTabId ??= created.id;
    byUrl.set(key, created);
  }
  if (firstTabId != null) {
    const first = await chrome.tabs.update(firstTabId, { active: true });
    if (first?.windowId != null) await chrome.windows.update(first.windowId, { focused: true });
  }
  if (current?.id != null && current.id !== firstTabId) await chrome.tabs.remove(current.id).catch(() => undefined);
}

async function executeResult(result) {
  if (!result) return;
  if (result.kind === "tab") return activateTab(result.tab);
  if (result.kind === "workspace") return openWorkspace(result.workspace);
  if (result.url) return navigateCurrent(result.url);
}

async function clearLocalSnapshot() {
  await chrome.storage.local.remove(CACHE_KEY);
  snapshot = emptySnapshot();
  activeFilter = { type: "all", id: null };
  elements.search.value = "";
  visibleResults = [];
  activeResult = 0;
  renderSnapshot();
  setConnectionKey(origin ? "cache-cleared" : "not-connected", origin ? "offline" : "");
  setOfflineKey(origin ? "cache-cleared-connected" : "cache-cleared-local");
  elements.setup.hidden = Boolean(origin);
}

async function bootstrap() {
  window.dockmarkI18n?.applyStaticDom();
  updateTopbarControls();
  await Promise.all([window.dockmarkAppearance?.hydrate?.(), window.dockmarkI18n?.hydrate?.()]);

  const stored = await chrome.storage.local.get([SERVER_KEY, CACHE_KEY, SETTINGS_KEY]);
  origin = validOrigin(stored[SERVER_KEY]);
  settings = normalizeSettings(stored[SETTINGS_KEY]);
  if (cacheIsUsable(stored[CACHE_KEY], origin)) snapshot = stored[CACHE_KEY];
  if (snapshot.appearancePreference) window.dockmarkAppearance?.apply(snapshot.appearancePreference);
  if (snapshot.localePreference && localStorage.getItem(window.dockmarkI18n?.STORAGE_KEY || "dockmarkLocaleV1") === null) {
    window.dockmarkI18n?.apply(snapshot.localePreference, false);
  }

  updateTopbarControls();
  await loadOpenTabs();
  renderSnapshot();

  if (!origin) {
    setConnectionKey(snapshot.syncedAt ? "cached-not-connected" : "not-connected", snapshot.syncedAt ? "offline" : "");
    if (snapshot.syncedAt) setOfflineKey("no-origin-cached");
    else setOfflineMessage("");
    elements.setup.hidden = Boolean(snapshot.syncedAt);
    return;
  }
  if (snapshot.syncedAt && !settings.newTab.autoRefresh) {
    setConnectionKey("cached-manual");
    elements.setup.hidden = true;
    return;
  }
  setConnectionKey(snapshot.syncedAt ? "cached-refreshing" : "connecting");
  if (snapshot.syncedAt) elements.setup.hidden = true;
  void refreshCloud({ quiet: Boolean(snapshot.syncedAt) });
}

elements.search.addEventListener("input", () => { activeResult = 0; renderSearchResults(); });
elements.search.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" && visibleResults.length) {
    event.preventDefault();
    activeResult = (activeResult + 1) % visibleResults.length;
    renderSearchResults();
  } else if (event.key === "ArrowUp" && visibleResults.length) {
    event.preventDefault();
    activeResult = (activeResult - 1 + visibleResults.length) % visibleResults.length;
    renderSearchResults();
  } else if (event.key === "Enter" && visibleResults.length) {
    event.preventDefault();
    void executeResult(visibleResults[activeResult] || visibleResults[0]);
  } else if (event.key === "Escape") {
    elements.search.value = "";
    visibleResults = [];
    elements.results.hidden = true;
  }
});

elements.themeToggle?.addEventListener("click", () => {
  const next = window.dockmarkAppearance?.cycle?.();
  updateTopbarControls();
  if (next) void patchCloudAppearance({ preference: next });
});
elements.localeToggle?.addEventListener("click", () => {
  const next = window.dockmarkI18n?.toggleLocale?.();
  updateTopbarControls();
  if (next?.preference) void patchCloudAppearance({ locale: next.preference });
});
window.addEventListener("dockmark:appearance", () => updateTopbarControls());
window.addEventListener("dockmark:locale", () => { updateTopbarControls(); renderConnectionState(); renderOfflineMessage(); renderSnapshot(); });

elements.refresh.addEventListener("click", () => void refreshCloud());
elements.clearCache.addEventListener("click", () => void clearLocalSnapshot());
elements.manage.addEventListener("click", () => {
  if (origin) void navigateCurrent(origin);
  else { elements.setup.hidden = false; setOfflineKey("connect-first"); }
});

chrome.tabs.onCreated?.addListener(() => void loadOpenTabs().then(renderSearchResults));
chrome.tabs.onRemoved?.addListener(() => void loadOpenTabs().then(renderSearchResults));
chrome.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.title !== undefined) void loadOpenTabs().then(renderSearchResults);
});
window.addEventListener("online", () => { if (settings.newTab.autoRefresh) void refreshCloud({ quiet: true }); });
void bootstrap();
