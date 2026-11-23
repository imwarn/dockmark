/**
 * [INPUT]: depends on LOCALE_STORAGE_KEY, SOURCE_LABELS, formatRelativeTime, normalizeLocalePreference, resolveLocale, tx from @dockmark/core; depends on browser from wxt/browser; depends on DockmarkI18nApi from ./types
 * [OUTPUT]: exports newTabI18n runtime, bindNewTabI18nListeners, and shortcutDisplayLabel for bilingual EN/zh-CN New Tab copy and DOM localization
 * [POS]: modular localization layer in apps/extension/lib/newtab replacing legacy public/newtab-i18n.js
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  LOCALE_STORAGE_KEY,
  SOURCE_LABELS,
  formatRelativeTime as coreFormatRelativeTime,
  normalizeLocalePreference,
  resolveLocale,
  tx as coreTx,
  type CommandSource,
  type LauncherShortcutKey,
  type LocalePreference,
  type ResolvedLocale,
} from "@dockmark/core";
import { browser } from "wxt/browser";
import type { DockmarkI18nApi, NewTabResultKind } from "./types";

const CONNECTION_COPY: Record<string, readonly [string, string]> = {
  starting: ["Starting…", "启动中…"],
  refreshing: ["Refreshing…", "刷新中…"],
  online: ["Online · synced", "在线 · 已同步"],
  "offline-cache": ["Offline cache", "离线缓存"],
  offline: ["Offline", "离线"],
  "cache-cleared": ["Cache cleared", "缓存已清除"],
  "not-connected": ["Not connected", "未连接"],
  "cached-not-connected": ["Cached · not connected", "已缓存 · 未连接"],
  "cached-manual": ["Cached · manual refresh", "已缓存 · 手动刷新"],
  "cached-refreshing": ["Cached · refreshing", "已缓存 · 刷新中"],
  connecting: ["Connecting…", "连接中…"],
};

function safeLocalGet(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeLocalSet(value: string): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

function currentPreference(): LocalePreference {
  return normalizeLocalePreference(safeLocalGet());
}

function currentLocale(): ResolvedLocale {
  return resolveLocale(currentPreference());
}

function tx(en: string, zh: string): string {
  return coreTx(currentLocale(), en, zh);
}

function formatRelativeTime(isoValue: string | null | undefined): string {
  return coreFormatRelativeTime(isoValue, currentLocale());
}

function connectionText(key: string): string {
  const pair = CONNECTION_COPY[key];
  return pair ? tx(pair[0], pair[1]) : key;
}

function offlineText(key: string, syncedAt: string | null | undefined): string {
  switch (key) {
    case "refresh-failed-cached":
      return tx(
        `Cloud refresh failed. Using the local snapshot from ${formatRelativeTime(syncedAt)}. Search and launch still work.`,
        `云端刷新失败，正在使用同步于 ${formatRelativeTime(syncedAt)} 的本地快照。搜索与启动仍可正常使用。`,
      );
    case "cache-cleared-connected":
      return tx(
        "Local snapshot cleared. Use Refresh to seed it again. Server connection, settings and bookmark mappings were kept.",
        "本地快照已清除，可点击刷新重新同步。服务器连接、设置与书签映射已保留。",
      );
    case "cache-cleared-local":
      return tx(
        "Local snapshot cleared. Settings and bookmark mappings were kept.",
        "本地快照已清除。设置与书签映射已保留。",
      );
    case "no-origin-cached":
      return tx(
        "No Dockmark origin is configured. Using the last local snapshot.",
        "尚未配置 Dockmark 服务器地址，正在使用上一次本地快照。",
      );
    case "connect-first":
      return tx(
        "Connect a Dockmark origin from the extension popup first.",
        "请先在扩展弹窗中连接 Dockmark 服务器地址。",
      );
    default:
      return "";
  }
}

function kindLabel(kind: NewTabResultKind | string | undefined): string {
  const locale = currentLocale();
  if (kind === "search-shortcut") {
    return coreTx(locale, "Bang", "快捷搜索");
  }
  if (kind && kind in SOURCE_LABELS[locale]) {
    return SOURCE_LABELS[locale][kind as CommandSource];
  }
  return kind ?? "";
}

function applyStaticDom(): void {
  const isZh = currentLocale() === "zh-CN";
  document.title = isZh ? "Dockmark 新标签页" : "Dockmark New Tab";
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-en]")) {
    node.textContent = isZh
      ? (node.getAttribute("data-i18n-zh") || node.getAttribute("data-i18n-en") || "")
      : (node.getAttribute("data-i18n-en") || "");
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-placeholder-en]")) {
    node.setAttribute(
      "placeholder",
      isZh
        ? (node.getAttribute("data-i18n-placeholder-zh") || node.getAttribute("data-i18n-placeholder-en") || "")
        : (node.getAttribute("data-i18n-placeholder-en") || ""),
    );
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-title-en]")) {
    const title = isZh
      ? (node.getAttribute("data-i18n-title-zh") || node.getAttribute("data-i18n-title-en") || "")
      : (node.getAttribute("data-i18n-title-en") || "");
    node.setAttribute("title", title);
    if (node.hasAttribute("aria-label")) node.setAttribute("aria-label", title);
  }
}

function apply(preference: unknown, persist = true): { preference: LocalePreference; locale: ResolvedLocale } {
  const normalized = normalizeLocalePreference(preference);
  const locale = resolveLocale(normalized);
  document.documentElement.dataset.localePreference = normalized;
  document.documentElement.dataset.locale = locale;
  document.documentElement.lang = locale;
  if (persist) {
    safeLocalSet(normalized);
    try {
      void browser?.storage?.local?.set({ [LOCALE_STORAGE_KEY]: normalized }).catch?.(() => undefined);
    } catch {
      // Ignore outside extension context.
    }
  }
  applyStaticDom();
  window.dispatchEvent(new CustomEvent("dockmark:locale", { detail: { preference: normalized, locale } }));
  return { preference: normalized, locale };
}

function toggleLocale(): { preference: LocalePreference; locale: ResolvedLocale } {
  return apply(currentLocale() === "zh-CN" ? "en" : "zh-CN", true);
}

async function hydrate(): Promise<{ preference: LocalePreference; locale: ResolvedLocale }> {
  const localRaw = safeLocalGet();
  if (localRaw !== null) return apply(localRaw, false);
  try {
    const stored = await browser?.storage?.local?.get(LOCALE_STORAGE_KEY);
    if (stored && stored[LOCALE_STORAGE_KEY] !== undefined) {
      return apply(stored[LOCALE_STORAGE_KEY], false);
    }
  } catch {
    // Fall back to system locale.
  }
  return apply("system", false);
}

export function shortcutDisplayLabel(shortcut: LauncherShortcutKey): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  switch (shortcut) {
    case "mod-j":
      return isMac ? "⌘J" : "Ctrl+J";
    case "alt-k":
      return "Alt+K";
    default:
      return isMac ? "⌘K" : "Ctrl+K";
  }
}

export const newTabI18n: DockmarkI18nApi = {
  STORAGE_KEY: LOCALE_STORAGE_KEY,
  normalize: normalizeLocalePreference,
  resolve: (preference, browserLanguage) => resolveLocale(normalizeLocalePreference(preference), browserLanguage),
  currentPreference,
  currentLocale,
  tx,
  formatRelativeTime,
  connectionText,
  offlineText,
  kindLabel,
  apply,
  applyStaticDom,
  hydrate,
  toggleLocale,
};

export function bindNewTabI18nListeners(): void {
  window.addEventListener("languagechange", () => {
    if (currentPreference() === "system") apply("system", false);
  });
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_STORAGE_KEY) apply(event.newValue, false);
  });
  try {
    browser?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[LOCALE_STORAGE_KEY]) return;
      const nextValue = changes[LOCALE_STORAGE_KEY].newValue;
      const applied = apply(nextValue, false);
      if (nextValue === undefined) {
        try {
          localStorage.removeItem(LOCALE_STORAGE_KEY);
        } catch {
          // Ignore storage removal errors.
        }
      } else {
        safeLocalSet(applied.preference);
      }
    });
  } catch {
    // Ignore outside extension context.
  }
}
