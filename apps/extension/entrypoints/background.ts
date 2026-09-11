import { browser } from "wxt/browser";

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
      if (tab.windowId != null) {
        await browser.windows.update(tab.windowId, { focused: true });
      }
      return { ok: true };
    }

    return undefined;
  });
});
