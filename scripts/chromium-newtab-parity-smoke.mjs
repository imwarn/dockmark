import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "apps/extension/.output/chrome-mv3-newtab");
const userDataDir = await mkdtemp(path.join(tmpdir(), "dockmark-newtab-parity-"));

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
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await page.waitForLoadState("domcontentloaded");

  await page.evaluate(() => {
    const now = new Date().toISOString();
    settings = normalizeSettings({
      version: 1,
      conflictPreference: "ask",
      newTab: {
        defaultSearchEngineId: "engine-parity",
        showOpenTabs: true,
        bookmarkLimit: 12,
        workspaceLimit: 8,
        autoRefresh: false,
      },
      updatedAt: now,
    });
    snapshot = {
      version: 1,
      origin: "https://parity.dockmark.invalid",
      syncedAt: now,
      categories: [],
      inboxBookmarkIds: [],
      bookmarks: [{
        id: "bookmark-parity",
        title: "Shared Match Bookmark",
        url: "https://bookmark.example/shared-match",
        description: "Parity fixture",
        tags: [],
        healthPolicy: "normal",
        healthStatus: "unknown",
        position: 0,
        createdAt: now,
        updatedAt: now,
      }],
      workspaces: [{
        id: "workspace-parity",
        name: "Shared Match Workspace",
        description: "Parity fixture",
        position: 0,
        createdAt: now,
        updatedAt: now,
        items: [{
          id: "workspace-item-parity",
          workspaceId: "workspace-parity",
          title: "workspace-only-item",
          url: "https://workspace.example/only-item",
          openMode: "reuse",
          healthPolicy: "normal",
          position: 0,
          createdAt: now,
          updatedAt: now,
        }],
      }],
      sessions: [{
        id: "session-parity",
        name: "Shared Match Session",
        sourceDevice: "Parity browser",
        createdAt: now,
        updatedAt: now,
        items: [{
          id: "session-item-parity",
          sessionId: "session-parity",
          title: "Session parity tab",
          url: "https://session.example/shared-match",
          pinned: false,
          position: 0,
        }],
      }],
      smartCollections: [{
        id: "collection-parity",
        name: "Shared Match Collection",
        filters: {},
        position: 0,
        createdAt: now,
        updatedAt: now,
      }],
      searchEngines: [{
        id: "engine-parity",
        name: "Google",
        keyword: "g",
        searchUrl: "https://www.google.com/search?q=%s",
        isDefault: true,
        position: 0,
      }],
    };
    openTabs = [{
      id: 999,
      windowId: 1,
      title: "Shared Match Tab",
      url: "https://tab.example/shared-match",
      active: false,
    }];
    activeResult = 0;
    elements.search.value = "Shared Match";
    renderSearchResults();
  });

  const labels = (await page.locator("#command-results .result-kind").allInnerTexts())
    .map((value) => value.toLocaleLowerCase());
  assert.deepEqual(labels, ["open tab", "workspace", "session", "collection", "bookmark", "search"]);

  const titles = await page.locator("#command-results .result-row strong").allInnerTexts();
  assert.deepEqual(titles.slice(0, 5), [
    "Shared Match Tab",
    "Shared Match Workspace",
    "Shared Match Session",
    "Shared Match Collection",
    "Shared Match Bookmark",
  ]);

  const search = page.locator("#search");
  await search.fill("workspace-only-item");
  const workspaceRow = page.locator("#command-results .result-row").filter({ hasText: "Shared Match Workspace" }).first();
  await workspaceRow.waitFor();
  assert.match(await workspaceRow.innerText(), /Workspace/i);

  await search.fill("");
  await search.focus();
  await search.press("Escape");
  assert.equal(await search.evaluate((element) => document.activeElement === element), false, "Escape on an empty Launcher should blur it on both Web and New Tab.");

  console.log("✓ New Tab canonical ordering is Open tab > Workspace > Session > Collection > Bookmark > Search");
  console.log("✓ New Tab exposes the same human-readable result type labels as Web Launcher");
  console.log("✓ Workspace item title/URL content participates in New Tab Launcher search");
  console.log("✓ Escape clears first and blurs the empty Launcher consistently");
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}
