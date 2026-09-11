import { browser } from "wxt/browser";

type RestoreItem = {
  url: string;
  pinned?: boolean;
};

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (message) => {
    if (message?.type === "dockmark:get-open-tabs") {
      const tabs = await browser.tabs.query({ currentWindow: true });
      return tabs.map((tab) => ({
        id: tab.id,
        title: tab.title ?? "Untitled tab",
        url: tab.url,
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
      }));
    }

    if (message?.type === "dockmark:activate-tab" && typeof message.tabId === "number") {
      const tab = await browser.tabs.update(message.tabId, { active: true });
      if (tab?.windowId != null) {
        await browser.windows.update(tab.windowId, { focused: true });
      }
      return { ok: Boolean(tab) };
    }

    if (message?.type === "dockmark:restore-session" && Array.isArray(message.items)) {
      const items = (message.items as RestoreItem[]).filter((item) => isHttpUrl(item?.url));
      const createdTabIds: number[] = [];

      for (const item of items) {
        const tab = await browser.tabs.create({
          url: item.url,
          active: false,
          pinned: Boolean(item.pinned),
        });
        if (tab.id != null) createdTabIds.push(tab.id);
      }

      const firstTabId = createdTabIds[0];
      if (firstTabId != null) {
        const first = await browser.tabs.update(firstTabId, { active: true });
        if (first?.windowId != null) {
          await browser.windows.update(first.windowId, { focused: true });
        }
      }

      return { ok: true, opened: createdTabIds.length };
    }

    return undefined;
  });
});
