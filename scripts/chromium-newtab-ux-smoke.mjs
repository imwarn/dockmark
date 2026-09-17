import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "apps/extension/.output/chrome-mv3-newtab");
const userDataDir = await mkdtemp(path.join(tmpdir(), "dockmark-newtab-ux-"));

const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>${request.url}</title><h1>${request.url}</h1>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Could not start launcher UX target server.");
const origin = `http://127.0.0.1:${address.port}`;

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
  const launcherUrl = `chrome-extension://${extensionId}/newtab.html`;
  const now = new Date().toISOString();

  const page = await context.newPage();
  await page.goto(launcherUrl);
  await page.evaluate(async ({ origin, now }) => {
    await chrome.storage.local.set({
      dockmarkServerUrl: origin,
      dockmarkBrowserSettingsV1: {
        version: 1,
        conflictPreference: "ask",
        newTab: {
          defaultSearchEngineId: "engine-g",
          showOpenTabs: false,
          bookmarkLimit: 12,
          workspaceLimit: 8,
          autoRefresh: false,
        },
        updatedAt: now,
      },
      dockmarkNewTabCacheV1: {
        version: 1,
        origin,
        syncedAt: now,
        bookmarks: [{
          id: "bookmark-ux",
          title: "Cached Target",
          url: `${origin}/bookmark`,
          tags: ["ux"],
          healthPolicy: "normal",
          healthStatus: "unknown",
          position: 0,
          createdAt: now,
          updatedAt: now,
        }],
        categories: [],
        workspaces: [],
        sessions: [{
          id: "session-ux",
          name: "Morning Session",
          sourceDevice: "Smoke browser",
          createdAt: now,
          updatedAt: now,
          items: [{
            id: "session-item-ux",
            sessionId: "session-ux",
            title: "Session target",
            url: `${origin}/session`,
            pinned: false,
            position: 0,
          }],
        }],
        searchEngines: [
          {
            id: "engine-g",
            name: "Google",
            keyword: "g",
            searchUrl: `${origin}/google?q=%s`,
            isDefault: true,
            position: 0,
          },
          {
            id: "engine-gh",
            name: "GitHub",
            keyword: "gh",
            searchUrl: `${origin}/github?q=%s`,
            isDefault: false,
            position: 1,
          },
        ],
        smartCollections: [],
        inboxBookmarkIds: [],
      },
    });
  }, { origin, now });

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  const search = page.locator("#search");

  await search.fill("!");
  await page.getByText("Google", { exact: true }).waitFor();
  await page.getByText("GitHub", { exact: true }).waitFor();
  const renderedKinds = (await page.locator("#command-results .result-kind").allInnerTexts())
    .map((value) => value.toLocaleLowerCase());
  assert.deepEqual(renderedKinds, ["search-shortcut", "search-shortcut"]);

  await search.fill("!gh");
  await page.getByText("GitHub", { exact: true }).waitFor();
  await search.press("Enter");
  assert.equal(await search.inputValue(), "!gh ");
  assert.equal(await search.evaluate((element) => document.activeElement === element), true);

  await search.fill("!gh dockmark");
  await page.getByText("Search GitHub", { exact: true }).waitFor();

  await search.fill("Morning Session");
  const sessionRow = page.locator("#command-results .result-row").filter({ hasText: "Morning Session" }).first();
  await sessionRow.waitFor();
  assert.match(await sessionRow.innerText(), /1 tab/);
  assert.match(await sessionRow.innerText(), /Smoke browser/);

  await search.fill("Cached Target");
  const foregroundPromise = context.waitForEvent("page");
  await search.press("Shift+Enter");
  const foreground = await foregroundPromise;
  await foreground.waitForLoadState("domcontentloaded");
  assert.equal(foreground.url(), `${origin}/bookmark`);

  await page.bringToFront();
  await search.fill("Cached Target");
  const backgroundPromise = context.waitForEvent("page");
  await search.press("Control+Enter");
  const background = await backgroundPromise;
  await background.waitForLoadState("domcontentloaded");
  assert.equal(background.url(), `${origin}/bookmark`);
  assert.equal(await page.evaluate(() => document.visibilityState), "visible");

  await search.evaluate((element) => element.blur());
  await page.locator("body").press("/");
  assert.equal(await search.evaluate((element) => document.activeElement === element), true);

  console.log("✓ New Tab suggests bare ! search-engine shortcuts and Enter accepts them");
  console.log("✓ New Tab searches cached Sessions alongside the existing launcher sources");
  console.log("✓ Shift+Enter opens a selected URL in a foreground tab");
  console.log("✓ Ctrl/Command+Enter opens a selected URL in a background tab");
  console.log("✓ / focuses the launcher input from the New Tab page");
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
