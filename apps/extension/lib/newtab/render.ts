/**
 * [INPUT]: depends on newTabI18n and shortcutDisplayLabel from ./i18n; depends on categoryName and collectionMatchesBookmark from ./search; depends on getAppearanceApi, newTabState, and resolveNewTabElements from ./state; depends on types/helpers from ./types
 * [OUTPUT]: exports DOM rendering routines for connection/offline status, topbar controls, filter pills, bookmark/workspace cards, and command results
 * [POS]: presentation layer in apps/extension/lib/newtab decoupled from network sync
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { newTabI18n, shortcutDisplayLabel } from "./i18n";
import { categoryName, collectionMatchesBookmark } from "./search";
import { getAppearanceApi, newTabState, resolveNewTabElements } from "./state";
import {
  asArray,
  displayHost,
  hostMonogram,
  isHttpUrl,
  normalizedTags,
  type ActiveBookmarkFilter,
  type CachedBookmark,
  type CachedCategory,
  type CachedSmartCollection,
  type CachedWorkspace,
} from "./types";

export function renderConnectionState(): void {
  const elements = resolveNewTabElements();
  const state = newTabState.connectionState;
  const label = state.customLabel ?? newTabI18n.connectionText(state.key);
  elements.connection.textContent = label;
  elements.connection.className = `state-chip${state.tone ? ` ${state.tone}` : ""}`;
}

export function setConnection(label: string, tone = ""): void {
  newTabState.connectionState = { key: "", customLabel: label, tone };
  renderConnectionState();
}

export function setConnectionKey(key: string, tone = ""): void {
  newTabState.connectionState = { key, customLabel: null, tone };
  renderConnectionState();
}

export function renderOfflineMessage(): void {
  const elements = resolveNewTabElements();
  const state = newTabState.offlineState;
  const message = state.customMessage || newTabI18n.offlineText(state.key, newTabState.snapshot.syncedAt);
  elements.offline.textContent = message;
  elements.offline.hidden = !message;
}

export function setOfflineMessage(message: string): void {
  newTabState.offlineState = { key: "", customMessage: message || "" };
  renderOfflineMessage();
}

export function setOfflineKey(key: string): void {
  newTabState.offlineState = { key, customMessage: "" };
  renderOfflineMessage();
}

export function syncSearchClearVisibility(): void {
  const elements = resolveNewTabElements();
  if (!elements.searchClear) return;
  elements.searchClear.hidden = elements.search.value.length === 0;
}

export function updateTopbarControls(): void {
  const elements = resolveNewTabElements();
  const appearance = getAppearanceApi();
  if (elements.themeToggle && appearance) {
    const pref = appearance.current();
    const icons: Record<string, string> = { system: "◐", light: "☀", dark: "☾" };
    const labels: Record<string, string> = {
      system: newTabI18n.tx("Theme: System (click to switch)", "主题：跟随系统（点击切换）"),
      light: newTabI18n.tx("Theme: Light (click to switch)", "主题：浅色（点击切换）"),
      dark: newTabI18n.tx("Theme: Dark (click to switch)", "主题：深色（点击切换）"),
    };
    const label = labels[pref] ?? labels.system ?? "";
    elements.themeToggle.textContent = icons[pref] || "◐";
    elements.themeToggle.title = label;
    elements.themeToggle.setAttribute("aria-label", label);
  }
  if (elements.localeToggle) {
    const locale = newTabI18n.currentLocale();
    elements.localeToggle.textContent = locale === "zh-CN" ? "EN" : "中文";
    const title = locale === "zh-CN" ? "Switch to English" : "切换为简体中文";
    elements.localeToggle.title = title;
    elements.localeToggle.setAttribute("aria-label", title);
  }
  if (elements.shortcutKbd) {
    const launcherKey = shortcutDisplayLabel(newTabState.settings.launcherShortcut);
    elements.shortcutKbd.textContent = `${launcherKey} / Alt+Shift+D`;
  }
}

function renderEmpty(container: HTMLElement, message: string): void {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  container.append(empty);
}

function settingsSummary(): string {
  const { newTab } = newTabState.settings;
  const tabs = newTab.showOpenTabs ? newTabI18n.tx("tabs on", "标签页开") : newTabI18n.tx("tabs off", "标签页关");
  const refresh = newTab.autoRefresh ? newTabI18n.tx("auto refresh", "自动刷新") : newTabI18n.tx("manual refresh", "手动刷新");
  return newTabI18n.tx(
    `${newTab.bookmarkLimit} bookmarks · ${newTab.workspaceLimit} workspaces · ${tabs} · ${refresh}`,
    `${newTab.bookmarkLimit} 条书签 · ${newTab.workspaceLimit} 个工作区 · ${tabs} · ${refresh}`,
  );
}

function renderBookmarkFilters(allBookmarks: CachedBookmark[]): void {
  const elements = resolveNewTabElements();
  const container = elements.bookmarkFilters;
  if (!container) return;

  const collections = asArray<CachedSmartCollection>(newTabState.snapshot.smartCollections)
    .filter((item) => typeof item?.name === "string" && item.name.trim().length > 0)
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const categories = asArray<CachedCategory>(newTabState.snapshot.categories)
    .filter((item) => typeof item?.name === "string" && item.name.trim().length > 0)
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));

  if (
    newTabState.activeFilter.type === "collection"
    && !collections.some((item) => item.id === newTabState.activeFilter.id)
  ) {
    newTabState.activeFilter = { type: "all", id: null };
  } else if (
    newTabState.activeFilter.type === "category"
    && newTabState.activeFilter.id !== "__uncategorized__"
    && !categories.some((item) => item.id === newTabState.activeFilter.id)
  ) {
    newTabState.activeFilter = { type: "all", id: null };
  }

  if (collections.length === 0 && categories.length === 0) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.replaceChildren();

  const makePill = (label: string, filter: ActiveBookmarkFilter, isCollection = false) => {
    const isActive = newTabState.activeFilter.type === filter.type && newTabState.activeFilter.id === filter.id;
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(isActive));
    button.className = `filter-pill${isCollection ? " is-collection" : ""}${isActive ? " active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      newTabState.activeFilter = isActive && filter.type !== "all" ? { type: "all", id: null } : filter;
      newTabState.renderSnapshot();
    });
    return button;
  };

  container.append(makePill(newTabI18n.tx("All", "全部"), { type: "all", id: null }));
  for (const collection of collections) {
    container.append(makePill(collection.name.trim(), { type: "collection", id: collection.id }, true));
  }
  for (const category of categories) {
    container.append(makePill(category.name.trim(), { type: "category", id: category.id }, false));
  }
  if (categories.length > 0 && allBookmarks.some((bookmark) => !bookmark.categoryId)) {
    container.append(makePill(newTabI18n.tx("Uncategorized", "未分类"), { type: "category", id: "__uncategorized__" }, false));
  }
}

function applyActiveBookmarkFilter(bookmarks: CachedBookmark[]): CachedBookmark[] {
  const { activeFilter } = newTabState;
  if (activeFilter.type === "collection") {
    const collection = asArray<CachedSmartCollection>(newTabState.snapshot.smartCollections)
      .find((item) => item?.id === activeFilter.id);
    return collection ? bookmarks.filter((bookmark) => collectionMatchesBookmark(collection, bookmark)) : bookmarks;
  }
  if (activeFilter.type === "category") {
    return activeFilter.id === "__uncategorized__"
      ? bookmarks.filter((bookmark) => !bookmark.categoryId)
      : bookmarks.filter((bookmark) => bookmark.categoryId === activeFilter.id);
  }
  return bookmarks;
}

export function syncActiveResultStyles(): void {
  const elements = resolveNewTabElements();
  elements.results.querySelectorAll(".result-row").forEach((row, index) => {
    row.classList.toggle("active", index === newTabState.activeResult);
  });
}

export function defaultRenderSearchResults(): void {
  const elements = resolveNewTabElements();
  syncSearchClearVisibility();
  newTabState.visibleResults = newTabState.buildResults(elements.search.value);
  newTabState.activeResult = Math.min(newTabState.activeResult, Math.max(0, newTabState.visibleResults.length - 1));
  elements.results.replaceChildren();
  elements.results.hidden = newTabState.visibleResults.length === 0;

  newTabState.visibleResults.forEach((result, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `result-row${index === newTabState.activeResult ? " active" : ""}`;
    const copy = document.createElement("span");
    copy.className = "result-copy";
    const title = document.createElement("strong");
    title.textContent = result.title;
    const subtitle = document.createElement("small");
    subtitle.textContent = result.subtitle || "";
    copy.append(title, subtitle);
    const kind = document.createElement("span");
    kind.className = "result-kind";
    kind.textContent = newTabI18n.kindLabel(result.kind);
    row.append(copy, kind);
    row.addEventListener("mouseenter", () => {
      newTabState.activeResult = index;
      syncActiveResultStyles();
    });
    row.addEventListener("click", () => void newTabState.executeResult(result));
    elements.results.append(row);
  });
}

export function defaultRenderSnapshot(): void {
  const elements = resolveNewTabElements();
  const bookmarks = asArray<CachedBookmark>(newTabState.snapshot.bookmarks)
    .filter((bookmark) => isHttpUrl(bookmark?.url))
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const workspaces = asArray<CachedWorkspace>(newTabState.snapshot.workspaces)
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  const { bookmarkLimit, workspaceLimit } = newTabState.settings.newTab;

  updateTopbarControls();
  renderBookmarkFilters(bookmarks);
  const filteredBookmarks = applyActiveBookmarkFilter(bookmarks);
  const isFiltered = newTabState.activeFilter.type !== "all";

  elements.bookmarkCount.textContent = isFiltered
    ? newTabI18n.tx(`${filteredBookmarks.length} matching`, `匹配 ${filteredBookmarks.length} 条`)
    : bookmarkLimit < bookmarks.length
      ? newTabI18n.tx(`${bookmarks.length} cached · ${bookmarkLimit} shown`, `${bookmarks.length} 条已缓存 · 显示 ${bookmarkLimit} 条`)
      : newTabI18n.tx(`${bookmarks.length} cached`, `${bookmarks.length} 条已缓存`);

  elements.workspaceCount.textContent = workspaceLimit < workspaces.length
    ? newTabI18n.tx(`${workspaces.length} cached · ${workspaceLimit} shown`, `${workspaces.length} 个已缓存 · 显示 ${workspaceLimit} 个`)
    : newTabI18n.tx(`${workspaces.length} cached`, `${workspaces.length} 个已缓存`);

  elements.syncStatus.textContent = newTabState.snapshot.syncedAt
    ? newTabI18n.tx(
        `Local snapshot synced ${newTabI18n.formatRelativeTime(newTabState.snapshot.syncedAt)}.`,
        `本地快照同步于 ${newTabI18n.formatRelativeTime(newTabState.snapshot.syncedAt)}。`,
      )
    : newTabI18n.tx("No local snapshot yet.", "暂无本地快照。");
  elements.settingsStatus.textContent = settingsSummary();

  elements.bookmarks.replaceChildren();
  if (bookmarkLimit === 0) {
    renderEmpty(
      elements.bookmarks,
      newTabI18n.tx(
        "Bookmark cards are hidden by New Tab settings. They remain available in command search.",
        "新标签页设置已隐藏书签卡片，仍可通过上方搜索框检索。",
      ),
    );
  } else {
    const visibleList = isFiltered
      ? filteredBookmarks.slice(0, Math.max(bookmarkLimit, 24))
      : filteredBookmarks.slice(0, bookmarkLimit);
    for (const bookmark of visibleList) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bookmark-card";
      const monogram = document.createElement("span");
      monogram.className = "card-monogram";
      monogram.setAttribute("aria-hidden", "true");
      monogram.textContent = hostMonogram(bookmark.url, bookmark.title);
      const body = document.createElement("span");
      body.className = "bookmark-card-body";
      const title = document.createElement("strong");
      title.textContent = bookmark.title || bookmark.url;
      const metaRow = document.createElement("span");
      metaRow.className = "bookmark-card-meta";
      const meta = document.createElement("small");
      meta.textContent = `${categoryName(bookmark.categoryId)} · ${displayHost(bookmark.url)}`;
      metaRow.append(meta);
      const tags = normalizedTags(bookmark);
      if (tags.length > 0) {
        const tagPill = document.createElement("span");
        tagPill.className = "bookmark-tag-pill";
        tagPill.textContent = `#${tags[0]}`;
        metaRow.append(tagPill);
      }
      body.append(title, metaRow);
      button.append(monogram, body);
      button.addEventListener("click", () => {
        void newTabState.executeResult({
          kind: "bookmark",
          title: bookmark.title || bookmark.url,
          subtitle: "",
          url: bookmark.url,
          score: 0,
        });
      });
      elements.bookmarks.append(button);
    }
    if (visibleList.length === 0) {
      renderEmpty(
        elements.bookmarks,
        isFiltered
          ? newTabI18n.tx("No bookmarks match this filter.", "该筛选条件下暂无书签。")
          : newTabI18n.tx(
              "No cached bookmarks yet. Connect once while online to seed this launcher.",
              "暂无缓存书签，联网连接一次后将自动同步到本地启动台。",
            ),
      );
    }
  }

  elements.workspaces.replaceChildren();
  if (workspaceLimit === 0) {
    renderEmpty(
      elements.workspaces,
      newTabI18n.tx(
        "Workspace cards are hidden by New Tab settings. They remain available in command search.",
        "新标签页设置已隐藏工作区卡片，仍可通过上方搜索框检索。",
      ),
    );
  } else {
    for (const workspace of workspaces.slice(0, workspaceLimit)) {
      const items = asArray(workspace.items).filter((item) => isHttpUrl(item?.url));
      const pinnedCount = items.filter((item) => item?.openMode === "pinned").length;
      const newTabCount = items.filter((item) => item?.openMode === "new-tab").length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "workspace-card";
      button.disabled = items.length === 0;
      const head = document.createElement("div");
      head.className = "workspace-head";
      const title = document.createElement("strong");
      title.textContent = workspace.name || newTabI18n.tx("Workspace", "工作区");
      const action = document.createElement("span");
      action.className = "workspace-action";
      action.textContent = items.length > 0 ? newTabI18n.tx("Open →", "打开 →") : newTabI18n.tx("Empty", "空");
      head.append(title, action);
      const meta = document.createElement("div");
      meta.className = "workspace-meta";
      const count = document.createElement("span");
      count.textContent = newTabI18n.tx(`${items.length} tab${items.length === 1 ? "" : "s"}`, `${items.length} 个标签页`);
      meta.append(count);
      if (pinnedCount > 0) {
        const badge = document.createElement("span");
        badge.className = "mode-badge";
        badge.textContent = newTabI18n.tx(`${pinnedCount} pinned`, `${pinnedCount} 固定`);
        meta.append(badge);
      }
      if (newTabCount > 0) {
        const badge = document.createElement("span");
        badge.className = "mode-badge";
        badge.textContent = newTabI18n.tx(`${newTabCount} new`, `${newTabCount} 新开`);
        meta.append(badge);
      }
      button.append(head, meta);
      button.addEventListener("click", () => {
        void newTabState.executeResult({
          kind: "workspace",
          title: workspace.name || newTabI18n.tx("Workspace", "工作区"),
          subtitle: "",
          workspace,
          score: 0,
        });
      });
      elements.workspaces.append(button);
    }
    if (workspaces.length === 0) {
      renderEmpty(elements.workspaces, newTabI18n.tx("No cached Workspaces yet.", "暂无缓存工作区。"));
    }
  }

  newTabState.renderSearchResults();
}
