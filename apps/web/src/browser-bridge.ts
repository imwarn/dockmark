export const BRIDGE_PROTOCOL_VERSION = 1;

export interface BridgeCapabilities {
  openTabs: boolean;
  activateTabs: boolean;
  workspaceReuse: boolean;
  workspacePinned: boolean;
  sessionRestore: boolean;
  sessionPinned: boolean;
  nativeBookmarks: boolean;
  nativeBookmarkSync?: boolean;
  localHealth: boolean;
}

export interface BridgePermissions {
  nativeBookmarks: boolean;
}

export interface BrowserBridgeStatus {
  connected: true;
  protocolVersion: number;
  extensionVersion: string;
  capabilities: BridgeCapabilities;
  permissions?: BridgePermissions;
}

export interface BridgeTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
}

export interface BridgeWorkspaceItem {
  url: string;
  openMode: "reuse" | "new-tab" | "pinned";
}

export interface BridgeSessionItem {
  url: string;
  pinned?: boolean;
}

export interface BridgeWorkspaceResult {
  opened: number;
  reused: number;
  pinned: number;
}

export interface NativeBrowserBookmark {
  id: string;
  parentId?: string;
  title: string;
  url: string;
  folderPath: string[];
  dateAdded?: number;
}

export interface NativeBookmarkMapping {
  browserBookmarkId: string;
  dockmarkBookmarkId: string;
  url: string;
  mappedAt: string;
}

export interface NativeBookmarkSnapshot {
  bookmarks: NativeBrowserBookmark[];
  mappings: NativeBookmarkMapping[];
}

interface BridgeRequestMessage {
  source: "dockmark-web";
  type: "dockmark:bridge:request";
  requestId: string;
  action: string;
  payload?: unknown;
}

interface BridgeResponseMessage {
  source: "dockmark-extension";
  type: "dockmark:bridge:response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface BridgeEventMessage {
  source: "dockmark-extension";
  type: "dockmark:bridge:event";
  event: string;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const pending = new Map<string, PendingRequest>();
const listeners = new Set<(event: string) => void>();
let installed = false;

function installListener() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("message", (event: MessageEvent<BridgeResponseMessage | BridgeEventMessage>) => {
    if (event.source !== window || !event.data || event.data.source !== "dockmark-extension") return;

    if (event.data.type === "dockmark:bridge:event") {
      for (const listener of listeners) listener(event.data.event);
      return;
    }

    if (event.data.type !== "dockmark:bridge:response") return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    pending.delete(event.data.requestId);
    window.clearTimeout(request.timeout);

    if (event.data.ok) request.resolve(event.data.result);
    else request.reject(new Error(event.data.error ?? "Browser bridge request failed."));
  });
}

async function request<T>(action: string, payload?: unknown, timeoutMs = 1200): Promise<T> {
  installListener();
  const requestId = crypto.randomUUID();
  const message: BridgeRequestMessage = {
    source: "dockmark-web",
    type: "dockmark:bridge:request",
    requestId,
    action,
    ...(payload === undefined ? {} : { payload }),
  };

  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Dockmark browser extension is not connected."));
    }, timeoutMs);

    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timeout,
    });
    window.postMessage(message, window.location.origin);
  });
}

export async function getRawBridgeStatus(): Promise<BrowserBridgeStatus> {
  return request<BrowserBridgeStatus>("status", undefined, 600);
}

export async function getBridgeStatus(): Promise<BrowserBridgeStatus> {
  const status = await getRawBridgeStatus();
  if (!status.connected || status.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw new Error(
      `Dockmark browser bridge protocol ${status.protocolVersion ?? "unknown"} is incompatible with Web protocol ${BRIDGE_PROTOCOL_VERSION}.`,
    );
  }
  return status;
}

export async function getOpenTabs() {
  const response = await request<{ tabs: BridgeTab[] }>("get-open-tabs");
  return response.tabs;
}

export async function activateBridgeTab(tabId: number) {
  return request<{ ok: boolean }>("activate-tab", { tabId });
}

export async function openWorkspaceWithBridge(items: BridgeWorkspaceItem[]) {
  return request<BridgeWorkspaceResult>("open-workspace", { items }, 4000);
}

export async function restoreSessionWithBridge(items: BridgeSessionItem[]) {
  return request<{ ok: boolean; opened: number }>("restore-session", { items }, 4000);
}

export async function getNativeBookmarksWithBridge() {
  return request<NativeBookmarkSnapshot>("get-native-bookmarks", undefined, 5000);
}

export async function saveNativeBookmarkMappingsWithBridge(
  items: Array<Pick<NativeBookmarkMapping, "browserBookmarkId" | "dockmarkBookmarkId" | "url">>,
) {
  return request<{ saved: number }>("save-native-bookmark-mappings", { items }, 5000);
}

export async function removeNativeBookmarkMappingsWithBridge(browserBookmarkIds: string[]) {
  return request<{ removed: number }>("remove-native-bookmark-mappings", { browserBookmarkIds }, 5000);
}

export function onBridgeEvent(listener: (event: string) => void) {
  installListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
