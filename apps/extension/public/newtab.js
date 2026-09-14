const SERVER_KEY = "dockmarkServerUrl";
const CACHE_KEY = "dockmarkNewTabCacheV1";
const CACHE_VERSION = 1;
const DEFAULT_SEARCH_URL = "https://www.google.com/search?q=%s";

const elements = {
  connection: document.getElementById("connection-state"),
  refresh: document.getElementById("refresh"),
  manage: document.getElementById("manage"),
  search: document.getElementById("search"),
  results: document.getElementById("command-results"),
  offline: document.getElementById("offline-banner"),
  setup: document.getElementById("setup-card"),
  bookmarks: document.getElementById("bookmarks"),
  workspaces: document.getElementById("workspaces"),
  bookmarkCount: document.getElementById("bookmark-count"),
  workspaceCount: document.getElementById("workspace-count"),
  syncStatus: document.getElementById("sync-status"),
};

let origin = null;
let snapshot = emptySnapshot();
let openTabs = [];
let activeResult = 0;
let visibleResults = [];
let refreshing = false;

function emptySnapshot() {
  return {
    version: CACHE_VERSION,
    origin: "",
    syncedAt: null,
    bookmarks: [],
    categories: [],
    workspaces: [],
    searchEngines: [],
  };
}

function validOrigin(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cacheIsUsable(value, expectedOrigin) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.version === CACHE_VERSION &&
    typeof value.origin === "string" &&
    (!expectedOrigin || value.origin === expectedOrigin) &&
    Array.isArray(value.bookmarks) &&
    Array.isArray(value.workspaces),
  );
}

function timeAgo(value) {
  if (!value) return "never";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function displayHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function categoryName(categoryId) {
  if (!categoryId) return "Uncategorized";
  return snapshot.categories.find((category) => category?.id === categoryId)?.name || "Uncategorized";
}

function setConnection(label, tone = "") {
  elements.connection.textContent = label;
  elements.connection.className = `state-chip${tone ? ` ${tone}` : ""}`;
}

function setOfflineMessage(message) {
  elements.offline.textContent = message || "";
  elements.offline.hidden = !message;
}

function renderEmpty(container, message) {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  container.append(empty);
}

function renderSnapshot() {
  const bookmarks = [...snapshot.bookmarks]
    .filter((bookmark) => isHttpUrl(bookmark?.url))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const workspaces = [...snapshot.workspaces]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  elements.bookmarkCount.textContent = `${bookmarks.length} cached`;
  elements.workspaceCount.textContent = `${workspaces.length} cached`;
  elements.syncStatus.textContent = snapshot.syncedAt
    ? `Local snapshot synced ${timeAgo(snapshot.syncedAt)}.`
    : "No local snapshot yet.";

  elements.bookmarks.replaceChildren();
  for (const bookmark of bookmarks.slice(0, 12)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bookmark-card";
    const title = document.createElement("strong");
    title.textContent = bookmark.title || bookmark.url;
    const meta = document.createElement("small");
    meta.textContent = `${categoryName(bookmark.categoryId)} · ${displayHost(bookmark.url)}`;
    button.append(title, meta);
    button.addEventListener("click", () => void navigateCurrent(bookmark.url));
    elements.bookmarks.append(button);
  }
  if (!bookmarks.length) renderEmpty(elements.bookmarks, "No cached bookmarks yet. Connect once while online to seed this launcher.");

  elements.workspaces.replaceChildren();
  for (const workspace of workspaces.slice(0, 8)) {
    const items = asArray(workspace.items).filter((item) => isHttpUrl(item?.url));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-card";
    button.disabled = !items.length;
    const title = document.createElement("strong");
    title.textContent = workspace.name || "Workspace";
    const meta = document.createElement("div");
    meta.className = "workspace-meta";
    const count = document.createElement("span");
    count.textContent = `${items.length} tab${items.length === 1 ? "" : "s"}`;
    const action = document.createElement("span");
    action.textContent = items.length ? "Open →" : "Empty";
    meta.append(count, action);
    button.append(title, meta);
    button.addEventListener("click", () => void openWorkspace(workspace));
    elements.workspaces.append(button);
  }
  if (!workspaces.length) renderEmpty(elements.workspaces, "No cached Workspaces yet.");

  renderSearchResults();
}

async function requestJson(path) {
  const response = await fetch(new URL(path, `${origin}/`).toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Dockmark returned ${response.status}.`);
  return response.json();
}

async function hasOriginPermission() {
  if (!origin) return false;
  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

async function refreshCloud({ quiet = false } = {}) {
  if (refreshing || !origin) return false;
  refreshing = true;
  if (!quiet) setConnection("Refreshing…");

  try {
    if (!(await hasOriginPermission())) {
      throw new Error("Dockmark site access is not granted. Open the extension popup and reconnect this origin.");
    }

    const [bookmarkPayload, categoryPayload, workspacePayload, enginePayload] = await Promise.all([
      requestJson("/api/bookmarks"),
      requestJson("/api/categories"),
      requestJson("/api/workspaces"),
      requestJson("/api/search-engines"),
    ]);

    snapshot = {
      version: CACHE_VERSION,
      origin,
      syncedAt: new Date().toISOString(),
      bookmarks: asArray(bookmarkPayload.bookmarks),
      categories: asArray(categoryPayload.categories),
      workspaces: asArray(workspacePayload.workspaces),
      searchEngines: asArray(enginePayload.engines),
    };
    await chrome.storage.local.set({ [CACHE_KEY]: snapshot });
    setConnection("Online · synced", "online");
    setOfflineMessage("");
    elements.setup.hidden = true;
    renderSnapshot();
    return true;
  } catch (error) {
    const hasCache = Boolean(snapshot.syncedAt || snapshot.bookmarks.length || snapshot.workspaces.length);
    setConnection(hasCache ? "Offline cache" : "Offline", "offline");
    setOfflineMessage(
      hasCache
        ? `Cloud refresh failed. Using the local snapshot from ${timeAgo(snapshot.syncedAt)}. Search and launch still work.`
        : (error instanceof Error ? error.message : "Dockmark is unavailable and there is no local snapshot yet."),
    );
    elements.setup.hidden = hasCache;
    return false;
  } finally {
    refreshing = false;
  }
}

async function loadOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.flatMap((tab) => {
      if (tab.id == null || tab.windowId == null || !isHttpUrl(tab.url)) return [];
      return [{
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || tab.url,
        url: tab.url,
        active: Boolean(tab.active),
      }];
    });
  } catch {
    openTabs = [];
  }
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
  } catch {
    return DEFAULT_SEARCH_URL.replace("%s", encoded);
  }
}

function searchEngineCommand(rawQuery) {
  const trimmed = rawQuery.trim();
  const engines = snapshot.searchEngines;
  for (const engine of engines) {
    const keyword = typeof engine?.keyword === "string" ? engine.keyword.trim() : "";
    if (!keyword) continue;
    const forms = [`${keyword} `, `!${keyword} `];
    const form = forms.find((value) => trimmed.toLocaleLowerCase().startsWith(value.toLocaleLowerCase()));
    if (!form) continue;
    const query = trimmed.slice(form.length).trim();
    if (!query) return null;
    return { engine, query };
  }
  return null;
}

function buildResults(rawQuery) {
  const query = rawQuery.trim();
  if (!query) return [];

  const directEngine = searchEngineCommand(query);
  if (directEngine) {
    return [{
      kind: "search",
      title: `Search ${directEngine.engine.name}`,
      subtitle: directEngine.query,
      url: searchUrl(directEngine.engine, directEngine.query),
      score: 1000,
    }];
  }

  const results = [];
  for (const tab of openTabs) {
    const score = searchScore(query, tab.title, tab.url, 500);
    if (score >= 0) results.push({ kind: "tab", title: tab.title, subtitle: tab.url, tab, score });
  }
  for (const workspace of snapshot.workspaces) {
    const subtitle = `${asArray(workspace.items).length} tabs`;
    const score = searchScore(query, workspace.name, `${workspace.description || ""} ${subtitle}`, 400);
    if (score >= 0) results.push({ kind: "workspace", title: workspace.name, subtitle, workspace, score });
  }
  for (const bookmark of snapshot.bookmarks) {
    if (!isHttpUrl(bookmark?.url)) continue;
    const score = searchScore(query, bookmark.title, `${bookmark.url} ${categoryName(bookmark.categoryId)}`, 300);
    if (score >= 0) results.push({ kind: "bookmark", title: bookmark.title || bookmark.url, subtitle: bookmark.url, url: bookmark.url, score });
  }

  const defaultEngine = snapshot.searchEngines.find((engine) => engine?.isDefault) || snapshot.searchEngines[0];
  results.push({
    kind: "search",
    title: `Search ${defaultEngine?.name || "the web"}`,
    subtitle: query,
    url: searchUrl(defaultEngine, query),
    score: 100,
  });

  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

function renderSearchResults() {
  const query = elements.search.value;
  visibleResults = buildResults(query);
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
    row.addEventListener("mouseenter", () => { activeResult = index; renderSearchResults(); });
    row.addEventListener("click", () => void executeResult(result));
    elements.results.append(row);
  });
}

async function navigateCurrent(url) {
  if (!isHttpUrl(url)) return;
  try {
    await chrome.tabs.update({ url });
  } catch {
    window.location.assign(url);
  }
}

async function activateTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function openWorkspace(workspace) {
  const items = asArray(workspace?.items)
    .filter((item) => isHttpUrl(item?.url))
    .map((item) => ({
      url: item.url,
      openMode: item.openMode === "new-tab" || item.openMode === "pinned" ? item.openMode : "reuse",
    }));
  if (!items.length) return;

  try {
    const current = await chrome.tabs.getCurrent();
    await chrome.runtime.sendMessage({ type: "dockmark:open-workspace", items });
    if (current?.id != null) await chrome.tabs.remove(current.id).catch(() => undefined);
  } catch {
    for (const item of items) await chrome.tabs.create({ url: item.url, active: false, pinned: item.openMode === "pinned" });
  }
}

async function executeResult(result) {
  if (!result) return;
  if (result.kind === "tab") return activateTab(result.tab);
  if (result.kind === "workspace") return openWorkspace(result.workspace);
  if (result.url) return navigateCurrent(result.url);
}

async function bootstrap() {
  const stored = await chrome.storage.local.get([SERVER_KEY, CACHE_KEY]);
  origin = validOrigin(stored[SERVER_KEY]);
  if (cacheIsUsable(stored[CACHE_KEY], origin)) snapshot = stored[CACHE_KEY];

  await loadOpenTabs();
  renderSnapshot();

  if (!origin) {
    setConnection(snapshot.syncedAt ? "Cached · not connected" : "Not connected", snapshot.syncedAt ? "offline" : "");
    setOfflineMessage(snapshot.syncedAt ? "No Dockmark origin is configured. Using the last local snapshot." : "");
    elements.setup.hidden = Boolean(snapshot.syncedAt);
    return;
  }

  if (snapshot.syncedAt) {
    setConnection("Cached · refreshing");
    elements.setup.hidden = true;
  } else {
    setConnection("Connecting…");
  }
  void refreshCloud({ quiet: Boolean(snapshot.syncedAt) });
}

elements.search.addEventListener("input", () => {
  activeResult = 0;
  renderSearchResults();
});
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

elements.refresh.addEventListener("click", () => void refreshCloud());
elements.manage.addEventListener("click", () => {
  if (origin) void navigateCurrent(origin);
  else {
    elements.setup.hidden = false;
    setOfflineMessage("Connect a Dockmark origin from the extension popup first.");
  }
});

chrome.tabs.onCreated?.addListener(() => void loadOpenTabs().then(renderSearchResults));
chrome.tabs.onRemoved?.addListener(() => void loadOpenTabs().then(renderSearchResults));
chrome.tabs.onUpdated?.addListener((_tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.title !== undefined) void loadOpenTabs().then(renderSearchResults);
});

window.addEventListener("online", () => void refreshCloud({ quiet: true }));
void bootstrap();
