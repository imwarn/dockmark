import { browser } from "wxt/browser";

const SERVER_KEY = "dockmarkServerUrl";
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
  nativeBookmarks: false,
  localHealth: false,
} as const;

type RestoreItem = {
  url: string;
  pinned?: boolean;
};

type WorkspaceBridgeItem = {
  url: string;
  openMode: "reuse" | "new-tab" | "pinned";
};

function bridgeStatus() {
  return {
    connected: true as const,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    extensionVersion: browser.runtime.getManifest().version,
    capabilities: BRIDGE_CAPABILITIES,
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

export default defineBackground(() => {
  void syncBridgeRegistration();

  browser.tabs.onCreated.addListener(scheduleTabsChanged);
  browser.tabs.onRemoved.addListener(scheduleTabsChanged);
  browser.tabs.onActivated.addListener(scheduleTabsChanged);
  browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.pinned !== undefined) {
      scheduleTabsChanged();
    }
  });

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message?.type === "dockmark:get-capabilities") return bridgeStatus();
    if (message?.type === "dockmark:get-open-tabs") return currentWindowTabs();

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
      throw new Error(`Unknown Dockmark bridge action: ${message.action}`);
    }

    return undefined;
  });
});
