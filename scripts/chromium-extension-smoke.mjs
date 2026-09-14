import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "apps/extension/.output/chrome-mv3");
const userDataDir = await mkdtemp(path.join(tmpdir(), "dockmark-chromium-"));

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>${request.url === "/two" ? "Dockmark Target Two" : "Dockmark Target One"}</title><h1>Dockmark smoke target</h1>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start smoke target server.");
const origin = `http://127.0.0.1:${address.port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntil(read, predicate, { timeoutMs = 4000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  do {
    lastValue = await read();
    if (predicate(lastValue)) return lastValue;
    await sleep(intervalMs);
  } while (Date.now() < deadline);
  return lastValue;
}

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(serviceWorker.url()).host;
  assert.ok(extensionId, "MV3 service worker should expose an extension id.");

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForLoadState("domcontentloaded");

  const manifest = await popup.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.version, "0.7.0");
  assert.ok(!manifest.permissions?.includes("bookmarks"), "Bookmarks should not be a required install-time permission.");
  assert.ok(manifest.optional_permissions?.includes("bookmarks"), "Bookmarks should be declared as an optional permission.");
  assert.equal(manifest.chrome_url_overrides, undefined, "The standard Dockmark build must not override the browser new tab page.");

  const capabilities = await popup.evaluate(async () =>
    chrome.runtime.sendMessage({ type: "dockmark:get-capabilities" }),
  );
  assert.equal(capabilities.connected, true);
  assert.equal(capabilities.protocolVersion, 1);
  assert.equal(capabilities.extensionVersion, "0.7.0");
  assert.equal(capabilities.capabilities.openTabs, true);
  assert.equal(capabilities.capabilities.workspaceReuse, true);
  assert.equal(capabilities.capabilities.workspacePinned, true);
  assert.equal(capabilities.capabilities.sessionPinned, true);
  assert.equal(capabilities.capabilities.nativeBookmarks, true);
  assert.equal(capabilities.capabilities.nativeBookmarkSync, true);
  assert.equal(capabilities.capabilities.nativeBookmarkWriteback, true);
  assert.equal(capabilities.permissions.nativeBookmarks, false);
  assert.equal(capabilities.capabilities.localHealth, false);

  const first = await context.newPage();
  await first.goto(`${origin}/one`);
  const second = await context.newPage();
  await second.goto(`${origin}/two`);

  const tabs = await popup.evaluate(async () =>
    chrome.runtime.sendMessage({ type: "dockmark:get-open-tabs" }),
  );
  const firstTab = tabs.find((tab) => tab.url === `${origin}/one`);
  const secondTab = tabs.find((tab) => tab.url === `${origin}/two`);
  assert.ok(firstTab?.id != null, "The extension should enumerate the first browser tab.");
  assert.ok(secondTab?.id != null, "The extension should enumerate the second browser tab.");

  await popup.evaluate(async (tabId) =>
    chrome.runtime.sendMessage({ type: "dockmark:activate-tab", tabId }),
    firstTab.id,
  );
  const afterActivate = await popup.evaluate(async () =>
    chrome.runtime.sendMessage({ type: "dockmark:get-open-tabs" }),
  );
  assert.equal(afterActivate.find((tab) => tab.id === firstTab.id)?.active, true);

  const restoredUrl = `${origin}/restored`;
  const restore = await popup.evaluate(async (url) =>
    chrome.runtime.sendMessage({
      type: "dockmark:restore-session",
      items: [{ url, pinned: true }],
    }),
    restoredUrl,
  );
  assert.equal(restore.opened, 1);

  const restoredTabs = await pollUntil(
    () => popup.evaluate(async () => chrome.runtime.sendMessage({ type: "dockmark:get-open-tabs" })),
    (currentTabs) => currentTabs.some((tab) => tab.url === restoredUrl && tab.pinned === true),
  );
  const restored = restoredTabs.find((tab) => tab.url === restoredUrl);
  assert.ok(restored, "Session restore should expose the restored tab within the polling window.");
  assert.equal(restored.pinned, true, "Session restore should preserve pinned state.");

  console.log(`✓ Dockmark Chromium extension loaded: ${extensionId}`);
  console.log("✓ Capability handshake protocol 1 / extension 0.7.0");
  console.log("✓ Native bookmark import, mapping sync and explicit writeback capabilities advertised");
  console.log("✓ Native bookmark capability is optional and ungranted by default");
  console.log("✓ Standard build does not override the browser new tab page");
  console.log("✓ Open-tab enumeration and activation");
  console.log("✓ Pinned Session restore");
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
