import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPaths = [
  "apps/web/src/styles.css",
  "apps/web/src/theme.css",
  "apps/web/src/security.css",
  "apps/web/src/search-engines.css",
  "apps/web/src/responsive-shell.css",
];
const css = (await Promise.all(cssPaths.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");

const utilityButtons = ["Workspace", "Inbox", "Collections", "Duplicates", "Settings", "Sign out"];
const sectionButtons = ["Launcher", "Workspaces", "Sessions", "Bookmarks", "Search", "Transfer", "Extension"];

function fixture() {
  return `<!doctype html>
    <html data-theme="light">
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
      <body>
        <div class="private-utility-bar">
          <a class="private-utility-brand"><span>D·</span><b>Public page</b></a>
          <nav>${utilityButtons.map((label) => `<button>${label}</button>`).join("")}</nav>
        </div>
        <main class="shell">
          <header class="topbar">
            <button class="brand brand-button"><span class="brand-mark">D·</span><span>Dockmark</span></button>
            <nav class="workspace-section-nav">${sectionButtons.map((label) => `<button class="ghost">${label}</button>`).join("")}</nav>
          </header>
          <section class="hero">
            <p class="eyebrow">YOUR PERSONAL LAUNCHER</p>
            <h1>Everything you return to,<br>one command away.</h1>
            <div class="command">
              <span class="search-icon">⌕</span>
              <input value="github">
              <span class="command-shortcuts"><kbd>⌘ K</kbd></span>
            </div>
          </section>
          <section class="panel">
            <div class="panel-heading"><span>Command results</span><span class="muted">Browser bridge · 20 open tabs</span></div>
            <div class="results">
              <button class="result result-button"><span class="favicon">↗</span><span class="result-copy"><strong>Example result with a deliberately long title that must stay inside the responsive shell</strong><small>https://example.com/a/very/long/path/that/should/ellipsis</small></span><span class="pill">Open tab</span></button>
            </div>
            <div class="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> select <kbd>Enter</kbd> run <kbd>Tab</kbd> accept bang</span><span><kbd>Shift</kbd>/<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> new tab <kbd>/</kbd> focus <kbd>Esc</kbd> clear</span></div>
          </section>
          <section class="management" style="min-height:1600px">
            <div class="management-grid">
              <aside class="manager-sidebar form-card">Sticky sidebar</aside>
              <div class="manager-main"><div class="form-card" style="height:1400px">Long content</div></div>
            </div>
          </section>
        </main>
      </body>
    </html>`;
}

const browser = await chromium.launch({ channel: "chromium", headless: true });
try {
  const page = await browser.newPage();

  for (const width of [1280, 900, 720, 390]) {
    await page.setViewportSize({ width, height: 720 });
    await page.setContent(fixture(), { waitUntil: "domcontentloaded" });

    const layout = await page.evaluate(() => {
      const utility = document.querySelector(".private-utility-bar");
      const secondary = document.querySelector(".topbar");
      const sectionNav = document.querySelector(".workspace-section-nav");
      const utilityNav = document.querySelector(".private-utility-bar nav");
      const sidebar = document.querySelector(".manager-sidebar");
      const brand = document.querySelector(".topbar .brand");
      const brandLabel = document.querySelector(".topbar .brand > span:not(.brand-mark)");
      if (!(utility instanceof HTMLElement) || !(secondary instanceof HTMLElement) || !(sectionNav instanceof HTMLElement) || !(utilityNav instanceof HTMLElement) || !(sidebar instanceof HTMLElement) || !(brand instanceof HTMLElement) || !(brandLabel instanceof HTMLElement)) {
        throw new Error("Responsive shell fixture is incomplete.");
      }
      return {
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
        utilityHeight: utility.getBoundingClientRect().height,
        secondaryHeight: secondary.getBoundingClientRect().height,
        secondaryTop: getComputedStyle(secondary).top,
        secondaryPosition: getComputedStyle(secondary).position,
        sidebarTop: getComputedStyle(sidebar).top,
        sectionNavOverflowing: sectionNav.scrollWidth > sectionNav.clientWidth,
        utilityNavOverflowing: utilityNav.scrollWidth > utilityNav.clientWidth,
        brandDisplay: getComputedStyle(brand).display,
        brandLabelDisplay: getComputedStyle(brandLabel).display,
      };
    });

    assert.ok(layout.documentWidth <= width + 1, `${width}px viewport should not have document-level horizontal overflow.`);
    assert.ok(layout.bodyWidth <= width + 1, `${width}px viewport should not have body-level horizontal overflow.`);
    assert.equal(layout.utilityHeight, 46);
    assert.equal(layout.secondaryHeight, 64);
    assert.equal(layout.secondaryPosition, "sticky");
    assert.equal(layout.secondaryTop, "46px");
    assert.equal(layout.sidebarTop, "128px");

    if (width === 1280) {
      assert.notEqual(layout.brandLabelDisplay, "none", "Desktop should keep the Dockmark secondary brand label.");
    }
    if (width === 720) {
      assert.equal(layout.brandLabelDisplay, "none", "Tablet layout should reclaim space by hiding the secondary brand label.");
    }
    if (width === 390) {
      assert.equal(layout.brandDisplay, "none", "Phone layout should dedicate the secondary bar to section navigation.");
      assert.equal(layout.sectionNavOverflowing, true, "Phone section navigation should scroll within its own bar instead of widening the page.");
      assert.equal(layout.utilityNavOverflowing, true, "Phone utility navigation should scroll within the utility bar instead of widening the page.");
    }

    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(50);
    const sticky = await page.evaluate(() => {
      const utility = document.querySelector(".private-utility-bar")?.getBoundingClientRect();
      const secondary = document.querySelector(".topbar")?.getBoundingClientRect();
      return { utilityTop: utility?.top, secondaryTop: secondary?.top };
    });
    assert.ok(Math.abs((sticky.utilityTop ?? 999) - 0) <= 1, `${width}px utility bar should remain pinned to the viewport top.`);
    assert.ok(Math.abs((sticky.secondaryTop ?? 999) - 46) <= 1, `${width}px workspace nav should remain pinned directly below the utility bar.`);
  }

  console.log("✓ Web shell has no document-level horizontal overflow at 1280/900/720/390px");
  console.log("✓ Utility and workspace navigation remain stacked and sticky while scrolling");
  console.log("✓ Tablet and phone breakpoints reclaim nav space without clipping the page");
  console.log("✓ Internal sticky sidebars offset below both navigation bars");
} finally {
  await browser.close();
}
