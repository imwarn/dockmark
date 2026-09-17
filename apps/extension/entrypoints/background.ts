import { browser } from "wxt/browser";
import { checkLocalHealth } from "../lib/local-health";
import { registerLauncherAccess } from "../lib/launcher-access";

const SERVER_KEY = "dockmarkServerUrl";
const NATIVE_BOOKMARK_MAPPINGS_KEY = "dockmarkNativeBookmarkMappingsV1";
const BRIDGE_SCRIPT_ID = "dockmark-web-bridge";
const BRIDGE_FILE = "/dockmark-bridge.js";
const BRIDGE_PROTOCOL_VERSION = 1;
const BRIDGE_CAPABILITIES = {
  openTabs: true,
  activateTabs: true,
  workspaceReuse: true,
  workspacePinned: true,
  sessionRestore: true,
  sessionPinned: true,
  nativeBookmarks: true,
  nativeBookmarkSync: true,
  nativeBookmarkWriteback: true,
  localHealth: true,
} as const;

type RestoreItem = {
  url: string;
  pinned?: boolean;
};

type WorkspaceBridgeItem = {
  url: string;
  openMode: "reuse" | "new-tab" | "pinned";
};

type NativeBookmarkItem = {
  id: string;
  parentId?: string;
  title: string;
  url: string;
  folderPath: string[];
  dateAdded?: number;
};

type NativeBookmarkMapping = {
  browserBookmarkId: string;
  dockmarkBookmarkId: string;
  url: string;
  mappedAt: string;
};

async function hasNativeBookmarkPermission() {
  return browser.permissions.contains({ permissions: ["bookmarks"] });
}

async function bridgeStatus() {
  return {
    connected: true as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    extensionVersion: browser.runtime.getManifest().version,
    capabilities: BRIDGE_CAPABILITIES,
    permissions: {
      nativeBookmarks: await hasNativeBookmarkPermission(),
    },
  };
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hostPattern(origin: string) {
  return `${origin}/*`;
}

function urlOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function tabMatchKey(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

async function configuredOrigin() {
  const stored = await browser.storage.local.get(SERVER_KEY);
  const value = stored[SERVER_KEY];
  return typeof value === "string" && value ? value : null;
}

async function registerBridge(origin: string) {
  const allowed = await browser.permissions.contains({ origins: [hostPattern(origin)] });
  if (!allowed) throw new Error("Dockmark site access has not been granted.");

  try {
    await browser.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] });
  } catch {
    // It is safe to continue when the bridge has not been registered yet.
  }

  await browser.scripting.registerContentScripts([{
    id: BRIDGE_SCRIPT_ID,
    matches: [hostPattern(origin)],
    js: [BRIDGE_FILE],
    runAt: "document_start",
  }]);

  const openDockmarkTabs = await browser.tabs.query({ url: hostPattern(origin) });
  await Promise.all(openDockmarkTabs.map(async (tab) => {
    if (tab.id == null) return;
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, files: [BRIDGE_FILE] });
    } catch {
      // A tab may disappear between query and injection.
    }
  }));
}

async function syncBridgeRegistration() {
  const origin = await configuredOrigin();
  if (!origin) return;
  const allowed = await browser.permissions.contains({ origins: [hostPattern(origin)] });
  if (!allowed) return;
  await registerBridge(origin);
}

async function currentWindowTabs() {
  const tabs = await browser.tabs.query({ currentWindow: true });
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title ?? "Untitled tab",
    url: tab.url,
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
  }));
}

async function bridgeOpenTabs() {
  const dockmarkOrigin = await configuredOrigin();
  const tabs = await browser.tabs.query({});
  return tabs.flatMap((tab) => {
    if (tab.id == null || tab.windowId == null || !isHttpUrl(tab.url)) return [];
    if (dockmarkOrigin && urlOrigin(tab.url) === dockmarkOrigin) return [];
    return [{
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title ?? tab.url,
      url: tab.url,
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
    }];
  });
}

async function activateTab(tabId: number) {
  const tab = await browser.tabs.update(tabId, { active: true });
  if (tab?.windowId != null) await browser.windows.update(tab.windowId, { focused: true });
  return { ok: Boolean(tab) };
}

async function restoreItems(items: RestoreItem[]) {
  const createdTabIds: number[] = [];
  for (const item of items.slice(0, 300)) {
    if (!isHttpUrl(item?.url)) continue;
    const tab = await browser.tabs.create({
      url: item.url,
      active: false,
      pinned: Boolean(item.pinned),
    });
    if (tab.id != null) createdTabIds.push(tab.id);
  }

  const firstTabId = createdTabIds[0];
  if (firstTabId != null) await activateTab(firstTabId);
  return { ok: true, opened: createdTabIds.length };
}

async function openWorkspace(items: WorkspaceBridgeItem[]) {
  const validItems = items.slice(0, 200).filter((item) =>
    isHttpUrl(item?.url) && (item.openMode === "reuse" || item.openMode === "new-tab" || item.openMode === "pinned"),
  );
  const existingTabs = await browser.tabs.query({});
  const byUrl = new Map<string, (typeof existingTabs)[number]>();
  for (const tab of existingTabs) {
    if (tab.id == null || !isHttpUrl(tab.url)) continue;
    const key = tabMatchKey(tab.url);
    if (!byUrl.has(key)) byUrl.set(key, tab);
  }

  let opened = 0;
  let reused = 0;
  let pinned = 0;
  let firstTabId: number | null = null;

  for (const item of validItems) {
    const key = tabMatchKey(item.url);
    const reusable = item.openMode === "new-tab" ? undefined : byUrl.get(key);

    if (reusable?.id != null) {
      reused += 1;
      firstTabId ??= reusable.id;
      if (item.openMode === "pinned") {
        if (!reusable.pinned) await browser.tabs.update(reusable.id, { pinned: true });
        pinned += 1;
      }
      continue;
    }

    const tab = await browser.tabs.create({
      url: item.url,
      active: false,
      pinned: item.openMode === "pinned",
    });
    if (tab.id == null) continue;
    opened += 1;
    if (item.openMode === "pinned") pinned += 1;
    firstTabId ??= tab.id;
    byUrl.set(key, tab);
  }

  if (firstTabId != null) await activateTab(firstTabId);
  return { opened, reused, pinned };
}

async function loadNativeBookmarkMappings() {
  const stored = await browser.storage.local.get(NATIVE_BOOKMARK_MAPPINGS_KEY);
  const value = stored[NATIVE_BOOKMARK_MAPPINGS_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, NativeBookmarkMapping>;
  return value as Record<string, NativeBookmarkMapping>;
}

async function flattenNativeBookmarks() {
  if (!(await hasNativeBookmarkPermission())) {
    throw new Error("Native bookmark access is not enabled. Open the Dockmark extension and enable it first.");
  }

  const roots = await browser.bookmarks.getTree();
  const output: NativeBookmarkItem[] = [];

  function walk(node: (typeof roots)[number], folderPath: string[]) {
    if (node.url) {
      output.push({
        id: node.id,
        ...(node.parentId ? { parentId: node.parentId } : {}),
        title: node.title?.trim() || node.url,
        url: node.url,
        folderPath,
        ...(typeof node.dateAdded === "number" ? { dateAdded: node.dateAdded } : {}),
      });
      return;
    }

    const nextPath = node.title?.trim() ? [...folderPath, node.title.trim()] : folderPath;
    for (const child of node.children ?? []) walk(child, nextPath);
  }

  for (const root of roots) walk(root, []);
  return output;
}

async function nativeBookmarkSnapshot() {
  const bookmarks = await flattenNativeBookmarks();
  const storedMappings = await loadNativeBookmarkMappings();
  return { bookmarks, mappings: Object.values(storedMappings) };
}

async function saveNativeBookmarkMappings(items: unknown[]) {
  const mappings = await loadNativeBookmarkMappings();
  let saved = 0;

  for (const item of items.slice(0, 5000)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const browserBookmarkId = typeof record.browserBookmarkId === "string" ? record.browserBookmarkId : "";
    const dockmarkBookmarkId = typeof record.dockmarkBookmarkId === "string" ? record.dockmarkBookmarkId : "";
    const url = typeof record.url === "string" ? record.url : "";
    if (!browserBookmarkId || !dockmarkBookmarkId || !isHttpUrl(url)) continue;

    const previous = mappings[browserBookmarkId];
    mappings[browserBookmarkId] = {
      browserBookmarkId,
      dockmarkBookmarkId,
      url,
      mappedAt: previous?.mappedAt ?? new Date().toISOString(),
    };
    saved += 1;
  }

  await browser.storage.local.set({ [NATIVE_BOOKMARK_MAPPINGS_KEY]: mappings });
  return { saved };
}

async function removeNativeBookmarkMappings(browserBookmarkIds: unknown[]) {
  const mappings = await loadNativeBookmarkMappings();
  let removed = 0;

  for (const value of browserBookmarkIds.slice(0, 5000)) {
    if (typeof value !== "string" || !value || !mappings[value]) continue;
    delete mappings[value];
    removed += 1;
  }

  if (removed) await browser.storage.local.set({ [NATIVE_BOOKMARK_MAPPINGS_KEY]: mappings });
  return { removed };
}

async function writeMappedNativeBookmark(payload: unknown) {
  if (!(await hasNativeBookmarkPermission())) {
    throw new Error("Native bookmark access is not enabled.");
  }
  if (!payload || typeof payload !== "object") throw new Error("Bookmark writeback payload is required.");

  const record = payload as Record<string, unknown>;
  const browserBookmarkId = typeof record.browserBookmarkId === "string" ? record.browserBookmarkId : "";
  const dockmarkBookmarkId = typeof record.dockmarkBookmarkId === "string" ? record.dockmarkBookmarkId : "";
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 200) : "";
  const url = typeof record.url === "string" ? record.url : "";
  if (!browserBookmarkId || !dockmarkBookmarkId || !title || !isHttpUrl(url)) {
    throw new Error("A mapped browser bookmark id, Dockmark bookmark id, title and HTTP/HTTPS URL are required.");
  }

  const mappings = await loadNativeBookmarkMappings();
  const mapping = mappings[browserBookmarkId];
  if (!mapping || mapping.dockmarkBookmarkId !== dockmarkBookmarkId) {
    throw new Error("Dockmark can only write back to the browser bookmark currently linked by this mapping.");
  }

  const existing = await browser.bookmarks.get(browserBookmarkId);
  const bookmark = existing[0];
  if (!bookmark?.url) throw new Error("The mapped browser bookmark no longer exists or is not a bookmark.");

  const updated = await browser.bookmarks.update(browserBookmarkId, { title, url });
  return {
    id: updated.id,
    title: updated.title?.trim() || url,
    url: updated.url ?? url,
  };
}

async function assertTrustedBridgeSender(senderUrl: string | undefined) {
  const origin = await configuredOrigin();
  if (!origin || urlOrigin(senderUrl) !== origin) {
    throw new Error("Browser bridge request did not come from the configured Dockmark site.");
  }
}

async function broadcastBridgeEvent(event: string) {
  const origin = await configuredOrigin();
  if (!origin) return;
  const tabs = await browser.tabs.query({ url: hostPattern(origin) });
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id == null) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: "dockmark:bridge:event", event });
    } catch {
      // The target page may not have the bridge loaded yet.
    }
  }));
}

let broadcastTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleTabsChanged() {
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcastTimer = undefined;
    void broadcastBridgeEvent("tabs-changed");
  }, 120);
}

let bookmarkBroadcastTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBookmarksChanged() {
  if (bookmarkBroadcastTimer) clearTimeout(bookmarkBroadcastTimer);
  bookmarkBroadcastTimer = setTimeout(() => {
    bookmarkBroadcastTimer = undefined;
    void broadcastBridgeEvent("bookmarks-changed");
  }, 180);
}

let bookmarkListenersRegistered = false;
function registerBookmarkListeners() {
  if (bookmarkListenersRegistered) return;
  browser.bookmarks.onCreated.addListener(scheduleBookmarksChanged);
  browser.bookmarks.onRemoved.addListener(scheduleBookmarksChanged);
  browser.bookmarks.onChanged.addListener(scheduleBookmarksChanged);
  browser.bookmarks.onMoved.addListener(scheduleBookmarksChanged);
  bookmarkListenersRegistered = true;
}

async function syncBookmarkListeners() {
  if (await hasNativeBookmarkPermission()) registerBookmarkListeners();
}

export default defineBackground(() => {
  registerLauncherAccess();
  void syncBridgeRegistration();
  void syncBookmarkListeners();

  browser.tabs.onCreated.addListener(scheduleTabsChanged);
  browser.tabs.onRemoved.addListener(scheduleTabsChanged);
  browser.tabs.onActivated.addListener(scheduleTabsChanged);
  browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.pinned !== undefined) {
      scheduleTabsChanged();
    }
  });

  browser.permissions.onAdded.addListener(() => {
    void syncBookmarkListeners();
    void broadcastBridgeEvent("capabilities-changed");
  });
  browser.permissions.onRemoved.addListener(() => void broadcastBridgeEvent("capabilities-changed"));

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message?.type === "dockmark:get-capabilities") return bridgeStatus();
    if (message?.type === "dockmark:get-open-tabs") return currentWindowTabs();

    if (message?.type === "dockmark:local-health-permission-updated") {
      void broadcastBridgeEvent("local-health-permission-updated");
      return { ok: true };
    }

    if (message?.type === "dockmark:activate-tab" && typeof message.tabId === "number") {
      return activateTab(message.tabId);
    }

    if (message?.type === "dockmark:restore-session" && Array.isArray(message.items)) {
      return restoreItems(message.items as RestoreItem[]);
    }

    if (message?.type === "dockmark:configure-bridge" && typeof message.origin === "string") {
      const origin = new URL(message.origin).origin;
      await registerBridge(origin);
      return { ok: true };
    }

    if (message?.type === "dockmark:web-bridge" && typeof message.action === "string") {
      await assertTrustedBridgeSender(sender.tab?.url);

      if (message.action === "status") return bridgeStatus();
      if (message.action === "get-open-tabs") {
        return { tabs: await bridgeOpenTabs() };
      }
      if (message.action === "activate-tab") {
        const tabId = (message.payload as { tabId?: unknown } | undefined)?.tabId;
        if (typeof tabId !== "number") throw new Error("tabId must be a number.");
        return activateTab(tabId);
      }
      if (message.action === "open-workspace") {
        const items = (message.payload as { items?: unknown } | undefined)?.items;
        if (!Array.isArray(items)) throw new Error("Workspace items must be an array.");
        return openWorkspace(items as WorkspaceBridgeItem[]);
      }
      if (message.action === "restore-session") {
        const items = (message.payload as { items?: unknown } | undefined)?.items;
        if (!Array.isArray(items)) throw new Error("Session items must be an array.");
        return restoreItems(items as RestoreItem[]);
      }
      if (message.action === "check-local-health") {
        const url = (message.payload as { url?: unknown } | undefined)?.url;
        if (!isHttpUrl(url)) throw new Error("Local health URL must use HTTP or HTTPS.");
        return checkLocalHealth(url);
      }
      if (message.action === "get-native-bookmarks") {
        return nativeBookmarkSnapshot();
      }
      if (message.action === "save-native-bookmark-mappings") {
        const items = (message.payload as { items?: unknown } | undefined)?.items;
        if (!Array.isArray(items)) throw new Error("Bookmark mappings must be an array.");
        const result = await saveNativeBookmarkMappings(items);
        void broadcastBridgeEvent("bookmarks-changed");
        return result;
      }
      if (message.action === "remove-native-bookmark-mappings") {
        const ids = (message.payload as { browserBookmarkIds?: unknown } | undefined)?.browserBookmarkIds;
        if (!Array.isArray(ids)) throw new Error("browserBookmarkIds must be an array.");
        const result = await removeNativeBookmarkMappings(ids);
        void broadcastBridgeEvent("bookmarks-changed");
        return result;
      }
      if (message.action === "write-native-bookmark") {
        const result = await writeMappedNativeBookmark(message.payload);
        void broadcastBridgeEvent("bookmarks-changed");
        return result;
      }
      throw new Error(`Unknown Dockmark bridge action: ${message.action}`);
    }

    return undefined;
  });
});
