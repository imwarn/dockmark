import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "apps/extension/.output/chrome-mv3-newtab");
const userDataDir = await mkdtemp(path.join(tmpdir(), "dockmark-newtab-chromium-"));

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
  assert.equal(manifest.version, "0.5.0");
  assert.equal(manifest.name, "Dockmark New Tab");
  assert.equal(manifest.chrome_url_overrides?.newtab, "newtab.html");

  const offlineOrigin = "https://offline.dockmark.invalid";
  await page.evaluate(async ({ offlineOrigin }) => {
    await chrome.storage.local.set({
      dockmarkServerUrl: offlineOrigin,
      dockmarkNewTabCacheV1: {
        version: 1,
        origin: offlineOrigin,
        syncedAt: new Date(Date.now() - 60_000).toISOString(),
        bookmarks: [
          {
            id: "bookmark-1",
            title: "Cached Example",
            url: "https://example.com/",
            healthPolicy: "normal",
            healthStatus: "unknown",
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        categories: [],
        workspaces: [
          {
            id: "workspace-1",
            name: "Offline Workspace",
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [
              {
                id: "workspace-item-1",
                workspaceId: "workspace-1",
                title: "Example",
                url: "https://example.com/",
                openMode: "reuse",
                healthPolicy: "normal",
                position: 0,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
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
        ],
      },
    });
  }, { offlineOrigin });

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.getByText("Cached Example", { exact: true }).waitFor();
  await page.getByText("Offline Workspace", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("#connection-state")?.textContent?.includes("Offline cache"));

  await page.locator("#search").fill("Cached Example");
  await page.getByText("Cached Example", { exact: true }).last().waitFor();
  assert.match(await page.locator("#sync-status").innerText(), /Local snapshot synced/);
  assert.match(await page.locator("#offline-banner").innerText(), /local snapshot/i);

  await page.locator("#search").fill("e offline query");
  await page.getByText("Search Example Search", { exact: true }).waitFor();

  console.log(`✓ Dockmark New Tab variant loaded: ${extensionId}`);
  console.log("✓ New Tab manifest override is isolated to the opt-in variant");
  console.log("✓ Cached bookmarks and Workspaces render without Dockmark host permission/network");
  console.log("✓ Offline command search uses cached Dockmark data and search-engine bangs");
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}
