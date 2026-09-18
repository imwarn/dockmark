import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPackage = JSON.parse(await readFile(path.join(root, "apps/extension/package.json"), "utf8"));
const expectedExtensionVersion = extensionPackage.version;
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
  assert.equal(manifest.version, expectedExtensionVersion);
  assert.equal(manifest.name, "Dockmark New Tab");
  assert.equal(manifest.icons?.[128], "icons/dockmark-128.png");
  assert.equal(manifest.chrome_url_overrides?.newtab, "newtab.html");
  const iconHref = await page.locator('link[rel="icon"]').getAttribute("href");
  assert.equal(iconHref, "newtab-icon.svg");
  const iconText = await page.evaluate(async () => {
    const response = await fetch("newtab-icon.svg");
    if (!response.ok) throw new Error(`New Tab icon request failed (${response.status}).`);
    return response.text();
  });
  assert.match(iconText, /prefers-color-scheme: dark/);

  // Exercise the final refresh wrapper without a live Dockmark server. The request
  // shim lets us count endpoint reads while still running the real cache assembly,
  // storage write, render and enhanced-search wrappers inside the extension page.
  const refreshProbe = await page.evaluate(async (clickedTargetUrl) => {
    const now = new Date().toISOString();
    const counts = {};
    origin = "https://snapshot-smoke.dockmark.invalid";
    hasOriginPermission = async () => true;
    requestJson = async (path) => {
      counts[path] = (counts[path] || 0) + 1;
      if (path === "/api/bookmarks") {
        return {
          bookmarks: [{
            id: "online-bookmark",
            categoryId: "online-category",
            title: "Online Cached Example",
            url: clickedTargetUrl,
            description: "Fresh cloud bookmark for single-pass snapshot validation.",
            healthPolicy: "normal",
            healthStatus: "unknown",
            position: 0,
            createdAt: now,
            updatedAt: now,
          }],
        };
      }
      if (path === "/api/categories") {
        return { categories: [{ id: "online-category", name: "Online", position: 0, createdAt: now, updatedAt: now }] };
      }
      if (path === "/api/workspaces") return { workspaces: [] };
      if (path === "/api/search-engines") {
        return {
          engines: [{
            id: "engine-online",
            name: "Online Search",
            keyword: "o",
            searchUrl: "https://example.com/search?q=%s",
            isDefault: true,
            position: 0,
          }],
        };
      }
      if (path === "/api/settings/appearance") {
        return { settings: { version: 1, preference: "light", updatedAt: now } };
      }
      if (path === "/api/settings/browser") {
        return {
          settings: {
            version: 1,
            conflictPreference: "ask",
            newTab: {
              defaultSearchEngineId: "engine-online",
              showOpenTabs: false,
              bookmarkLimit: 12,
              workspaceLimit: 8,
              autoRefresh: false,
            },
            updatedAt: now,
          },
          bookmarkTags: { "online-bookmark": ["online", "dev"] },
          smartCollections: [{
            id: "online-collection",
            name: "Online dev",
            filters: { categoryId: "online-category", tags: ["dev"], inbox: "inbox" },
            position: 0,
            createdAt: now,
            updatedAt: now,
          }],
          inboxBookmarkIds: ["online-bookmark"],
        };
      }
      throw new Error(`Unexpected New Tab smoke endpoint: ${path}`);
    };

    await chrome.storage.local.remove(["dockmarkNewTabCacheV1", "dockmarkBrowserSettingsV1"]);
    const refreshed = await refreshCloud();
    const stored = await chrome.storage.local.get("dockmarkNewTabCacheV1");
    return { refreshed, counts, snapshot: stored.dockmarkNewTabCacheV1 };
  }, clickedTargetUrl);
  assert.equal(refreshProbe.refreshed, true);
  assert.equal(refreshProbe.counts["/api/settings/browser"], 1, "A current New Tab refresh should read /api/settings/browser exactly once.");
  assert.equal(refreshProbe.counts["/api/settings/appearance"], 1, "A current New Tab refresh should read the shared Web appearance exactly once.");
  assert.equal(refreshProbe.snapshot.appearancePreference, "light");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  assert.deepEqual(refreshProbe.snapshot.bookmarks?.[0]?.tags, ["online", "dev"]);
  assert.equal(refreshProbe.snapshot.smartCollections?.[0]?.name, "Online dev");
  assert.deepEqual(refreshProbe.snapshot.inboxBookmarkIds, ["online-bookmark"]);
  await page.locator("#search").fill("#dev");
  await page.locator("#command-results .result-row").filter({ hasText: "Online Cached Example" }).first().waitFor();
  await page.locator("#search").fill("Online dev");
  await page.locator("#command-results .result-row").filter({ hasText: "Online dev" }).first().waitFor();

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
        smartCollections: [
          {
            id: "collection-1",
            name: "Developer docs",
            filters: { categoryId: "category-1", tags: ["dev"] },
            position: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "collection-2",
            name: "Inbox reading",
            filters: { inbox: "inbox", tags: ["reading"] },
            position: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
        inboxBookmarkIds: ["bookmark-2"],
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

  await page.locator("#search").fill("Developer docs");
  const collectionResult = page.locator("#command-results .result-row").filter({ hasText: "Developer docs" }).first();
  await collectionResult.waitFor();
  assert.match(await collectionResult.innerText(), /collection/i);
  assert.match(await collectionResult.innerText(), /1 bookmark/i);
  await collectionResult.click();
  assert.equal(await page.locator("#search").inputValue(), "@Developer docs");
  await page.locator("#command-results .result-row").filter({ hasText: "Cached Example" }).first().waitFor();
  assert.equal(await page.locator("#command-results .result-row").filter({ hasText: "Second Cached Bookmark" }).count(), 0);

  await page.locator("#search").fill("Inbox reading");
  const inboxCollection = page.locator("#command-results .result-row").filter({ hasText: "Inbox reading" }).first();
  await inboxCollection.waitFor();
  await inboxCollection.click();
  assert.equal(await page.locator("#search").inputValue(), "@Inbox reading");
  await page.locator("#command-results .result-row").filter({ hasText: "Second Cached Bookmark" }).first().waitFor();
  assert.equal(await page.locator("#command-results .result-row").filter({ hasText: "Cached Example" }).count(), 0);

  await page.locator("#search").fill("offline query");
  await page.getByText("Search Secondary Search for “offline query”", { exact: true }).waitFor();

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
  console.log("✓ Transparent adaptive D dot favicon and manifest brand icons are packaged");
  console.log("✓ Current refresh reads browser settings once and persists tags, Smart Collections and Inbox membership atomically");
  console.log("✓ Cached bookmarks and Workspaces render without Dockmark host permission/network");
  console.log("✓ Offline search matches bookmark description, category, tags and combined #tag terms");
  console.log("✓ Cached Smart Collections are searchable and browse their matching bookmarks offline");
  console.log("✓ Inbox-state Smart Collections use cached Inbox membership offline");
  console.log("✓ Local-first settings control card limits, open tabs, default search and auto refresh");
  console.log("✓ Manual refresh remains available when automatic refresh is disabled");
  console.log("✓ Clearing the local snapshot preserves server connection and browser settings");
  console.log("✓ Hovered command results remain clickable and navigate the active New Tab");
} finally {
  await context?.close();
  await new Promise((resolve) => targetServer.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
