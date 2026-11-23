/**
 * [INPUT]: depends on apps/web/src shell, settings, and ui-polish stylesheets and playwright Chromium
 * [OUTPUT]: verifies zero horizontal overflow, sticky 46px/64px/128px geometry, zero inner focus-outline on composite search boxes, 5-tab Settings subnav fit, and responsive nav behavior at 1280/900/720/390px in both English and Simplified Chinese
 * [POS]: Chromium responsive shell layout smoke test in scripts/
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPaths = [
  "apps/web/src/styles.css",
  "apps/web/src/theme.css",
  "apps/web/src/ui-polish.css",
  "apps/web/src/security.css",
  "apps/web/src/settings.css",
  "apps/web/src/search-engines.css",
  "apps/web/src/responsive-shell.css",
];
const css = (await Promise.all(cssPaths.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");

const LOCALE_FIXTURES = [
  {
    locale: "en",
    publicLabel: "Public page",
    utilityButtons: ["Workspace", "Inbox", "Collections", "Duplicates", "Settings"],
    themeLabel: "System",
    langToggle: "中文",
    signOutLabel: "Sign out",
    sectionButtons: ["Launcher", "Workspaces", "Sessions", "Bookmarks", "Search", "Transfer", "Extension"],
    settingsTabs: [
      { label: "Appearance & Language", detail: "Theme mode and interface language." },
      { label: "Browser", detail: "New Tab launcher, shortcuts and sync." },
      { label: "AI Service", detail: "OpenAI-compatible endpoint, model and Worker key status." },
      { label: "Security", detail: "Pairing codes and trusted extensions." },
      { label: "Public Page", detail: "Navigation station look, publishing and order." },
    ],
    resultHeading: "Command results",
    bridgeMeta: "Browser bridge · 20 open tabs",
    resultPill: "Open tab",
    expectPhoneSectionOverflow: true,
  },
  {
    locale: "zh-CN",
    publicLabel: "公开主页",
    utilityButtons: ["工作台", "收件箱", "智能合集", "重复项", "设置"],
    themeLabel: "跟随系统",
    langToggle: "EN",
    signOutLabel: "退出",
    sectionButtons: ["启动台", "工作区", "会话", "书签", "搜索", "导入导出", "扩展"],
    settingsTabs: [
      { label: "外观与语言", detail: "主题模式与界面显示语言。" },
      { label: "浏览器与新标签页", detail: "新标签页启动台、快捷键与同步。" },
      { label: "AI 服务", detail: "OpenAI 兼容接口、模型预设与 Worker 密钥状态。" },
      { label: "安全与设备", detail: "配对码与已配对扩展管理。" },
      { label: "公开主页", detail: "导航站外观配置、书签公开与排序。" },
    ],
    resultHeading: "命令结果",
    bridgeMeta: "浏览器桥接 · 20 个打开的标签页",
    resultPill: "打开的标签页",
    expectPhoneSectionOverflow: false,
  },
];

function fixture(copy) {
  return `<!doctype html>
    <html lang="${copy.locale}" data-theme="light" data-locale="${copy.locale}">
      <head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
      <body>
        <div class="private-utility-bar">
          <a class="private-utility-brand"><span>D·</span><b>${copy.publicLabel}</b></a>
          <nav>
            ${copy.utilityButtons.map((label) => `<button type="button">${label}</button>`).join("")}
            <span class="private-utility-divider" aria-hidden="true"></span>
            <span class="utility-quick-group">
              <button class="utility-quick-toggle" type="button"><span>◐</span><span>${copy.themeLabel}</span></button>
              <button class="utility-quick-toggle" type="button">${copy.langToggle}</button>
            </span>
            <button type="button">${copy.signOutLabel}</button>
          </nav>
        </div>
        <main class="shell">
          <header class="topbar">
            <button class="brand brand-button"><span class="brand-mark">D·</span><span>Dockmark</span></button>
            <nav class="workspace-section-nav">${copy.sectionButtons.map((label) => `<button class="ghost" type="button">${label}</button>`).join("")}</nav>
          </header>
          <section class="hero">
            <div class="command">
              <span class="search-icon">⌕</span>
              <input value="github">
              <span class="command-shortcuts"><kbd>⌘ K</kbd></span>
            </div>
          </section>
          <section class="panel">
            <div class="panel-heading"><span>${copy.resultHeading}</span><span class="muted">${copy.bridgeMeta}</span></div>
            <div class="results">
              <button class="result result-button"><span class="favicon">↗</span><span class="result-copy"><strong>Example result with a deliberately long title that must stay inside the responsive shell</strong><small>https://example.com/a/very/long/path/that/should/ellipsis</small></span><span class="pill">${copy.resultPill}</span></button>
            </div>
            <div class="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> select <kbd>Enter</kbd> run <kbd>Tab</kbd> accept bang</span><span><kbd>Shift</kbd>/<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> new tab <kbd>/</kbd> focus <kbd>Esc</kbd> clear</span></div>
          </section>
          <section aria-label="Settings subnav fixture">
            <nav class="settings-subnav">
              ${copy.settingsTabs.map((tab, index) => `<button type="button" class="${index === 2 ? "active" : ""}"><strong>${tab.label}</strong><span>${tab.detail}</span></button>`).join("")}
            </nav>
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

  for (const copy of LOCALE_FIXTURES) {
    for (const width of [1280, 900, 720, 390]) {
      await page.setViewportSize({ width, height: 720 });
      await page.setContent(fixture(copy), { waitUntil: "domcontentloaded" });

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
        const navButtons = [
          ...utilityNav.querySelectorAll("button"),
          ...sectionNav.querySelectorAll("button"),
        ];
        const maxNavButtonHeight = Math.max(...navButtons.map((button) => button.getBoundingClientRect().height));
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
          maxNavButtonHeight,
        };
      });

      assert.ok(layout.documentWidth <= width + 1, `[${copy.locale}] ${width}px viewport should not have document-level horizontal overflow.`);
      assert.ok(layout.bodyWidth <= width + 1, `[${copy.locale}] ${width}px viewport should not have body-level horizontal overflow.`);
      assert.equal(layout.utilityHeight, 46, `[${copy.locale}] ${width}px utility bar should stay 46px tall.`);
      assert.equal(layout.secondaryHeight, 64, `[${copy.locale}] ${width}px secondary topbar should stay 64px tall.`);
      assert.equal(layout.secondaryPosition, "sticky");
      assert.equal(layout.secondaryTop, "46px");
      assert.equal(layout.sidebarTop, "128px");
      assert.ok(layout.maxNavButtonHeight <= 42, `[${copy.locale}] ${width}px nav labels should stay single-line (got ${layout.maxNavButtonHeight}px).`);

      const settingsSubnav = await page.evaluate(() => {
        const nav = document.querySelector(".settings-subnav");
        if (!(nav instanceof HTMLElement)) throw new Error("Settings subnav fixture is missing.");
        const buttons = [...nav.querySelectorAll("button")];
        const rect = nav.getBoundingClientRect();
        return {
          count: buttons.length,
          overflowing: nav.scrollWidth > nav.clientWidth + 1,
          rightEdge: rect.right,
          allInsideViewport: buttons.every((btn) => btn.getBoundingClientRect().right <= window.innerWidth + 1),
        };
      });
      assert.equal(settingsSubnav.count, 5, `[${copy.locale}] ${width}px Settings subnav should render all 5 tabs.`);
      assert.equal(settingsSubnav.overflowing, false, `[${copy.locale}] ${width}px Settings subnav should fit without horizontal overflow.`);
      assert.equal(settingsSubnav.allInsideViewport, true, `[${copy.locale}] ${width}px all 5 Settings tabs should remain within the viewport.`);

      // Verify zero inner focus-outline bug on .command input while .command outer container highlights cleanly.
      const commandBefore = await page.evaluate(() => {
        const wrapper = document.querySelector(".command");
        if (!(wrapper instanceof HTMLElement)) throw new Error(".command wrapper missing.");
        return { borderColor: getComputedStyle(wrapper).borderColor, boxShadow: getComputedStyle(wrapper).boxShadow };
      });
      await page.locator(".command input").focus();
      await page.waitForFunction(
        (beforeBorder) => {
          const wrapper = document.querySelector(".command");
          return wrapper instanceof HTMLElement && getComputedStyle(wrapper).borderColor !== beforeBorder;
        },
        commandBefore.borderColor,
        { timeout: 1000 },
      );
      const commandFocus = await page.evaluate(() => {
        const wrapper = document.querySelector(".command");
        const input = document.querySelector(".command input");
        if (!(wrapper instanceof HTMLElement) || !(input instanceof HTMLInputElement)) throw new Error(".command input missing.");
        const wrapperStyle = getComputedStyle(wrapper);
        const inputStyle = getComputedStyle(input);
        return {
          isActive: document.activeElement === input,
          inputOutlineStyle: inputStyle.outlineStyle,
          inputBoxShadow: inputStyle.boxShadow,
          wrapperBorderColor: wrapperStyle.borderColor,
          wrapperBoxShadow: wrapperStyle.boxShadow,
        };
      });
      assert.equal(commandFocus.isActive, true, `[${copy.locale}] ${width}px .command input should receive focus.`);
      assert.equal(commandFocus.inputOutlineStyle, "none", `[${copy.locale}] ${width}px .command input must never draw an inner focus outline.`);
      assert.equal(commandFocus.inputBoxShadow, "none", `[${copy.locale}] ${width}px .command input must not draw an inner focus shadow.`);
      assert.notEqual(commandFocus.wrapperBorderColor, commandBefore.borderColor, `[${copy.locale}] ${width}px .command outer border should highlight when focused.`);
      assert.notEqual(commandFocus.wrapperBoxShadow, commandBefore.boxShadow, `[${copy.locale}] ${width}px .command outer container should gain a focus ring.`);
      await page.locator(".command input").blur();

      if (width === 1280) {
        assert.notEqual(layout.brandLabelDisplay, "none", `[${copy.locale}] Desktop should keep the Dockmark secondary brand label.`);
      }
      if (width === 720) {
        assert.equal(layout.brandLabelDisplay, "none", `[${copy.locale}] Tablet layout should reclaim space by hiding the secondary brand label.`);
      }
      if (width === 390) {
        assert.equal(layout.brandDisplay, "none", `[${copy.locale}] Phone layout should dedicate the secondary bar to section navigation.`);
        if (copy.expectPhoneSectionOverflow) {
          assert.equal(layout.sectionNavOverflowing, true, `[${copy.locale}] Phone section navigation should scroll within its own bar instead of widening the page.`);
        }
        assert.equal(layout.utilityNavOverflowing, true, `[${copy.locale}] Phone utility navigation should scroll within the utility bar instead of widening the page.`);
      }

      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(50);
      const sticky = await page.evaluate(() => {
        const utility = document.querySelector(".private-utility-bar")?.getBoundingClientRect();
        const secondary = document.querySelector(".topbar")?.getBoundingClientRect();
        return { utilityTop: utility?.top, secondaryTop: secondary?.top };
      });
      assert.ok(Math.abs((sticky.utilityTop ?? 999) - 0) <= 1, `[${copy.locale}] ${width}px utility bar should remain pinned to the viewport top.`);
      assert.ok(Math.abs((sticky.secondaryTop ?? 999) - 46) <= 1, `[${copy.locale}] ${width}px workspace nav should remain pinned directly below the utility bar.`);
    }
  }

  console.log("✓ Web shell has no document-level horizontal overflow at 1280/900/720/390px in both EN and zh-CN");
  console.log("✓ Utility and workspace navigation remain stacked, single-line, and sticky while scrolling");
  console.log("✓ All 5 Settings subnav tabs (including AI Service) fit cleanly across 1280/900/720/390px without overflow");
  console.log("✓ Focused .command input has zero inner outline while the outer .command wrapper highlights cleanly");
  console.log("✓ Tablet and phone breakpoints reclaim nav space without clipping the page");
  console.log("✓ Internal sticky sidebars offset below both navigation bars");
} finally {
  await browser.close();
}
