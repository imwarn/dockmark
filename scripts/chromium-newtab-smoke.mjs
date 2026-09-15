import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "apps/extension/.output/chrome-mv3-newtab");
const userDataDir = await mkdtemp(path.join(tmpdir(), "dockmark-newtab-chromium-"));

const targetServer = createServer((request, response) => {
  const isLive = request.url === "/live";
  const title = isLive ? "Live Only Marker" : "Dockmark clicked target";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
});
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
const targetAddress = targetServer.address();
if (!targetAddress || typeof targetAddress === "string") throw new Error("Could not start New Tab click target server.");
const clickedTargetUrl = `http://127.0.0.1:${targetAddress.port}/clicked`;
const liveTargetUrl = `http://127.0.0.1:${targetAddress.port}/live`;

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
  assert.ok(extensionId, "Dockmark New Tab MV3 worker should expose an extension id.");

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await page.waitForLoadState("domcontentloaded");

  const manifest = await page.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.version, "1.2.0");
  assert.equal(manifest.name, "Dockmark New Tab");
  assert.equal(manifest.chrome_url_overrides?.newtab, "newtab.html");
  const iconHref = await page.locator('link[rel="icon"]').getAttribute("href");
  assert.equal(iconHref, "newtab-icon.svg");
  const iconResponse = await page.request.get(`chrome-extension://${extensionId}/newtab-icon.svg`);
  assert.equal(iconResponse.status(), 200);
  assert.match(await iconResponse.text(), /prefers-color-scheme: dark/);

  const offlineOrigin = "https://offline.dockmark.invalid";
  await page.evaluate(async ({ offlineOrigin, clickedTargetUrl }) => {
    const now = new Date().toISOString();
    await chrome.storage.local.set({
      dockmarkServerUrl: offlineOrigin,
      dockmarkBrowserSettingsV1: {
        version: 1,
        conflictPreference: "ask",
        newTab: {
          defaultSearchEngineId: "engine-2",
          showOpenTabs: false,
          bookmarkLimit: 1,
          workspaceLimit: 1,
          autoRefresh: false,
        },
        updatedAt: now,
      },
      dockmarkNewTabCacheV1: {
        version: 1,
        origin: offlineOrigin,
        syncedAt: new Date(Date.now() - 60_000).toISOString(),
        bookmarks: [
          {
            id: "bookmark-1",
            categoryId: "category-1",
            title: "Cached Example",
            url: clickedTargetUrl,
            description: "Private documentation portal for the developer toolkit.",
            tags: ["docs", "dev"],
            healthPolicy: "normal",
            healthStatus: "unknown",
            position: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "bookmark-2",
            title: "Second Cached Bookmark",
            url: "https://example.org/second",
            description: "Reference archive for later reading.",
            tags: ["reading"],
            healthPolicy: "normal",
            healthStatus: "unknown",
            position: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
        categories: [
          {
            id: "category-1",
            name: "Developer",
            position: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
        workspaces: [
          {
            id: "workspace-1",
            name: "Offline Workspace",
            position: 0,
            createdAt: now,
            updatedAt: now,
            items: [
              {
                id: "workspace-item-1",
                workspaceId: "workspace-1",
                title: "Example",
                url: clickedTargetUrl,
                openMode: "reuse",
                healthPolicy: "normal",
                position: 0,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          {
            id: "workspace-2",
            name: "Second Workspace",
            position: 1,
            createdAt: now,
            updatedAt: now,
            items: [],
          },
        ],
        searchEngines: [
          {
            id: "engine-1",
            name: "Example Search",
            keyword: "e",
            searchUrl: "https://example.com/search?q=%s",
            isDefault: true,
            position: 0,
          },
          {
            id: "engine-2",
            name: "Secondary Search",
            keyword: "s",
            searchUrl: "https://example.org/search?q=%s",
            isDefault: false,
            position: 1,
          },
        ],
      },
    });
  }, { offlineOrigin, clickedTargetUrl });

  const livePage = await context.newPage();
  await livePage.goto(liveTargetUrl);
  await livePage.waitForLoadState("domcontentloaded");

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.bringToFront();
  await page.getByText("Cached Example", { exact: true }).waitFor();
  await page.getByText("Offline Workspace", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("#connection-state")?.textContent?.includes("Cached · manual refresh"));

  assert.equal(await page.locator("#bookmarks .bookmark-card").count(), 1);
  assert.equal(await page.locator("#workspaces .workspace-card").count(), 1);
  assert.match(await page.locator("#bookmark-count").innerText(), /2 cached · 1 shown/);
  assert.match(await page.locator("#workspace-count").innerText(), /2 cached · 1 shown/);
  assert.match(await page.locator("#settings-status").innerText(), /1 bookmarks · 1 workspaces · tabs off · manual refresh/);
  assert.match(await page.locator("#sync-status").innerText(), /Local snapshot synced/);

  await page.locator("#search").fill("Live Only Marker");
  const resultKinds = await page.locator("#command-results .result-kind").allInnerTexts();
  assert.ok(!resultKinds.some((kind) => kind.toLowerCase() === "tab"), "Open-tab results should be hidden when showOpenTabs is disabled.");

  await page.locator("#search").fill("documentation");
  await page.locator("#command-results .result-row").filter({ hasText: "Cached Example" }).first().waitFor();

  await page.locator("#search").fill("Developer");
  await page.locator("#command-results .result-row").filter({ hasText: "Cached Example" }).first().waitFor();

  await page.locator("#search").fill("#docs");
  const tagResult = page.locator("#command-results .result-row").filter({ hasText: "Cached Example" }).first();
  await tagResult.waitFor();
  assert.match(await tagResult.innerText(), /#docs/);

  await page.locator("#search").fill("documentation #dev");
  await page.locator("#command-results .result-row").filter({ hasText: "Cached Example" }).first().waitFor();

  await page.locator("#search").fill("offline query");
  await page.getByText("Search Secondary Search", { exact: true }).waitFor();

  await page.locator("#search").fill("e offline query");
  await page.getByText("Search Example Search", { exact: true }).waitFor();

  await page.locator("#refresh").click();
  await page.waitForFunction(() => document.querySelector("#connection-state")?.textContent?.includes("Offline cache"));
  assert.match(await page.locator("#offline-banner").innerText(), /local snapshot/i);

  // Exercise the real mouse path that previously regressed: hover must update selection
  // without rebuilding the result DOM before the click event can fire.
  await page.locator("#search").fill("Cached Example");
  const bookmarkResult = page.locator("#command-results .result-row").filter({ hasText: "Cached Example" }).first();
  await bookmarkResult.hover();
  await bookmarkResult.click();
  await page.waitForURL(clickedTargetUrl);

  const cachePage = await context.newPage();
  await cachePage.goto(`chrome-extension://${extensionId}/newtab.html`);
  await cachePage.waitForLoadState("domcontentloaded");
  await cachePage.getByText("Cached Example", { exact: true }).waitFor();
  assert.equal(await cachePage.locator("#clear-cache").innerText(), "Clear local snapshot");
  await cachePage.locator("#clear-cache").click();
  await cachePage.waitForFunction(() => document.querySelector("#sync-status")?.textContent?.includes("No local snapshot yet"));
  const storageAfterClear = await cachePage.evaluate(async () => chrome.storage.local.get([
    "dockmarkServerUrl",
    "dockmarkBrowserSettingsV1",
    "dockmarkNewTabCacheV1",
  ]));
  assert.equal(storageAfterClear.dockmarkNewTabCacheV1, undefined);
  assert.equal(storageAfterClear.dockmarkServerUrl, offlineOrigin);
  assert.equal(storageAfterClear.dockmarkBrowserSettingsV1?.newTab?.autoRefresh, false);

  console.log(`✓ Dockmark New Tab variant loaded: ${extensionId}`);
  console.log("✓ New Tab manifest override is isolated to the opt-in variant");
  console.log("✓ Transparent adaptive D dot favicon is packaged and linked");
  console.log("✓ Cached bookmarks and Workspaces render without Dockmark host permission/network");
  console.log("✓ Offline search matches bookmark description, category, tags and combined #tag terms");
  console.log("✓ Local-first settings control card limits, open tabs, default search and auto refresh");
  console.log("✓ Manual refresh remains available when automatic refresh is disabled");
  console.log("✓ Clearing the local snapshot preserves server connection and browser settings");
  console.log("✓ Hovered command results remain clickable and navigate the active New Tab");
} finally {
  await context?.close();
  await new Promise((resolve) => targetServer.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
