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
          autoRefresh: true,
        },
        updatedAt: now,
      },
      dockmarkNewTabCacheV1: {
        version: 1,
        origin,
        syncedAt: now,
        bookmarks: [{
          id: "bookmark-old",
          title: "Old Cached Target",
          url: `${origin}/old-bookmark`,
          tags: ["old"],
          healthPolicy: "normal",
          healthStatus: "unknown",
          position: 0,
          createdAt: now,
          updatedAt: now,
        }],
        categories: [],
        workspaces: [],
        sessions: [{
          id: "session-stale",
          name: "Stale Session",
          sourceDevice: "Old cache",
          createdAt: now,
          updatedAt: now,
          items: [{
            id: "session-item-stale",
            sessionId: "session-stale",
            title: "Old session target",
            url: `${origin}/old-session`,
            pinned: false,
            position: 0,
          }],
        }],
        searchEngines: [],
        smartCollections: [],
        inboxBookmarkIds: [],
      },
    });
  }, { origin, now });

  await page.addInitScript(({ origin, now }) => {
    const nativeContains = chrome.permissions.contains.bind(chrome.permissions);
    chrome.permissions.contains = async (query) => {
      if (Array.isArray(query?.origins) && query.origins.includes(`${origin}/*`)) return true;
      return nativeContains(query);
    };

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const requestUrl = new URL(
        typeof input === "string" || input instanceof URL ? input.toString() : input.url,
        window.location.href,
      );
      if (requestUrl.origin !== origin || !requestUrl.pathname.startsWith("/api/")) {
        return nativeFetch(input, init);
      }

      const json = (data) => new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });

      if (requestUrl.pathname === "/api/bookmarks") {
        return json({
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
        });
      }
      if (requestUrl.pathname === "/api/categories") return json({ categories: [] });
      if (requestUrl.pathname === "/api/workspaces") return json({ workspaces: [] });
      if (requestUrl.pathname === "/api/search-engines") {
        return json({
          engines: [
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
        });
      }
      if (requestUrl.pathname === "/api/settings/browser") {
        return json({
          settings: {
            version: 1,
            conflictPreference: "ask",
            newTab: {
              defaultSearchEngineId: "engine-g",
              showOpenTabs: false,
              bookmarkLimit: 12,
              workspaceLimit: 8,
              autoRefresh: true,
            },
            updatedAt: now,
          },
        });
      }
      if (requestUrl.pathname === "/api/sessions") {
        return json({
          sessions: [
            {
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
            },
            {
              id: "session-campus",
              name: "Campus Tools",
              sourceDevice: "Web",
              createdAt: now,
              updatedAt: now,
              items: [{
                id: "session-item-campus",
                sessionId: "session-campus",
                title: "学生电子邮箱服务中心 — 北京信息科技大学 BIST",
                url: "https://mail.bist.edu.cn/mail/",
                pinned: false,
                position: 0,
              }],
            },
          ],
        });
      }
      return json({});
    };
  }, { origin, now });

  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  const search = page.locator("#search");
  await page.getByText("Online · synced", { exact: true }).waitFor();

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

  await search.fill("学生电子");
  const campusByTitle = page.locator("#command-results .result-row").filter({ hasText: "Campus Tools" }).first();
  await campusByTitle.waitFor();
  assert.match(await campusByTitle.innerText(), /学生电子邮箱服务中心/);

  await search.fill("mail.bist");
  const campusByUrl = page.locator("#command-results .result-row").filter({ hasText: "Campus Tools" }).first();
  await campusByUrl.waitFor();
  assert.match(await campusByUrl.innerText(), /mail\.bist\.edu\.cn\/mail/);

  await search.fill("bist.edu.cn/mail");
  await page.locator("#command-results .result-row").filter({ hasText: "Campus Tools" }).first().waitFor();

  const cachedSessionNames = await page.evaluate(async () => {
    const stored = await chrome.storage.local.get("dockmarkNewTabCacheV1");
    return (stored.dockmarkNewTabCacheV1?.sessions ?? []).map((session) => session.name);
  });
  assert.deepEqual(cachedSessionNames, ["Morning Session", "Campus Tools"]);

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

  await search.fill("Morning Session");
  const restorePromise = context.waitForEvent("page");
  await search.press("Enter");
  const restored = await restorePromise;
  await restored.waitForLoadState("domcontentloaded");
  assert.equal(restored.url(), `${origin}/session`);

  console.log("✓ New Tab suggests bare ! search-engine shortcuts and Enter accepts them");
  console.log("✓ New Tab auto refresh hydrates and caches Sessions on the first real launcher load");
  console.log("✓ New Tab searches Sessions by name, tab title and partial tab URL");
  console.log("✓ New Tab restores a cloud-refreshed Session");
  console.log("✓ Shift+Enter opens a selected URL in a foreground tab");
  console.log("✓ Ctrl/Command+Enter opens a selected URL in a background tab");
  console.log("✓ / focuses the launcher input from the New Tab page");
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(userDataDir, { recursive: true, force: true });
}
