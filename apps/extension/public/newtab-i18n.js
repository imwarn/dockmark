/**
 * [INPUT]: depends on localStorage, navigator.language, and optional chrome.storage.local
 * [OUTPUT]: exposes window.dockmarkI18n ({ STORAGE_KEY, normalize, resolve, currentPreference, currentLocale, tx, formatRelativeTime, connectionText, offlineText, apply, applyStaticDom, hydrate, toggleLocale })
 * [POS]: head-loaded EN/zh-CN localization runtime and copy catalog for apps/extension/public/newtab.html and its classic launcher scripts
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
(() => {
  const STORAGE_KEY = "dockmarkLocaleV1";

  const CONNECTION_COPY = {
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

  function normalize(value) {
    if (typeof value !== "string") return "system";
    const cleaned = value.trim().toLowerCase().replace(/_/g, "-");
    if (cleaned === "en" || cleaned.startsWith("en-")) return "en";
    if (cleaned === "zh" || cleaned.startsWith("zh-")) return "zh-CN";
    return "system";
  }

  function resolve(preference, browserLanguage) {
    const normalized = normalize(preference);
    if (normalized === "en" || normalized === "zh-CN") return normalized;
    const candidate = typeof browserLanguage === "string" && browserLanguage
      ? browserLanguage
      : (typeof navigator !== "undefined" ? navigator.language : "en");
    return String(candidate || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  }

  function safeLocalGet() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }

  function safeLocalSet(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
  }

  function currentPreference() { return normalize(safeLocalGet()); }
  function currentLocale() { return resolve(currentPreference()); }
  function tx(en, zh) { return currentLocale() === "zh-CN" ? zh : en; }

  function formatRelativeTime(isoValue) {
    const isZh = currentLocale() === "zh-CN";
    if (!isoValue) return isZh ? "从未" : "never";
    const timestamp = Date.parse(isoValue);
    if (!Number.isFinite(timestamp)) return isZh ? "未知" : "unknown";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 45) return isZh ? "刚刚" : "just now";
    if (seconds < 3600) {
      const mins = Math.round(seconds / 60);
      return isZh ? `${mins} 分钟前` : `${mins}m ago`;
    }
    if (seconds < 86400) {
      const hours = Math.round(seconds / 3600);
      return isZh ? `${hours} 小时前` : `${hours}h ago`;
    }
    const days = Math.round(seconds / 86400);
    return isZh ? `${days} 天前` : `${days}d ago`;
  }

  function connectionText(key) {
    const pair = CONNECTION_COPY[key];
    return pair ? tx(pair[0], pair[1]) : key;
  }

  function offlineText(key, syncedAt) {
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
        return tx("Local snapshot cleared. Settings and bookmark mappings were kept.", "本地快照已清除。设置与书签映射已保留。");
      case "no-origin-cached":
        return tx("No Dockmark origin is configured. Using the last local snapshot.", "尚未配置 Dockmark 服务器地址，正在使用上一次本地快照。");
      case "connect-first":
        return tx("Connect a Dockmark origin from the extension popup first.", "请先在扩展弹窗中连接 Dockmark 服务器地址。");
      default:
        return "";
    }
  }

  function applyStaticDom() {
    const isZh = currentLocale() === "zh-CN";
    document.title = isZh ? "Dockmark 新标签页" : "Dockmark New Tab";
    for (const node of document.querySelectorAll("[data-i18n-en]")) {
      node.textContent = isZh ? (node.getAttribute("data-i18n-zh") || node.getAttribute("data-i18n-en") || "") : (node.getAttribute("data-i18n-en") || "");
    }
    for (const node of document.querySelectorAll("[data-i18n-placeholder-en]")) {
      node.setAttribute("placeholder", isZh ? (node.getAttribute("data-i18n-placeholder-zh") || node.getAttribute("data-i18n-placeholder-en") || "") : (node.getAttribute("data-i18n-placeholder-en") || ""));
    }
    for (const node of document.querySelectorAll("[data-i18n-title-en]")) {
      const title = isZh ? (node.getAttribute("data-i18n-title-zh") || node.getAttribute("data-i18n-title-en") || "") : (node.getAttribute("data-i18n-title-en") || "");
      node.setAttribute("title", title);
      if (node.hasAttribute("aria-label")) node.setAttribute("aria-label", title);
    }
  }

  function apply(preference, persist = true) {
    const normalized = normalize(preference);
    const locale = resolve(normalized);
    document.documentElement.dataset.localePreference = normalized;
    document.documentElement.dataset.locale = locale;
    document.documentElement.lang = locale;
    if (persist) {
      safeLocalSet(normalized);
      try { chrome?.storage?.local?.set({ [STORAGE_KEY]: normalized }).catch?.(() => undefined); } catch { /* ignore */ }
    }
    applyStaticDom();
    window.dispatchEvent(new CustomEvent("dockmark:locale", { detail: { preference: normalized, locale } }));
    return { preference: normalized, locale };
  }

  function toggleLocale() {
    return apply(currentLocale() === "zh-CN" ? "en" : "zh-CN", true);
  }

  async function hydrate() {
    const localRaw = safeLocalGet();
    if (localRaw !== null) return apply(localRaw, false);
    try {
      const stored = await chrome?.storage?.local?.get(STORAGE_KEY);
      if (stored && stored[STORAGE_KEY] !== undefined) return apply(stored[STORAGE_KEY], false);
    } catch { /* fall back */ }
    return apply("system", false);
  }

  apply(currentPreference(), false);
  window.addEventListener("languagechange", () => { if (currentPreference() === "system") apply("system", false); });
  window.addEventListener("storage", (event) => { if (event.key === STORAGE_KEY) apply(event.newValue, false); });

  try {
    chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) return;
      const nextValue = changes[STORAGE_KEY].newValue;
      const applied = apply(nextValue, false);
      if (nextValue === undefined) {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      } else {
        safeLocalSet(applied.preference);
      }
    });
  } catch { /* ignore */ }

  window.dockmarkI18n = {
    STORAGE_KEY, normalize, resolve, currentPreference, currentLocale, tx,
    formatRelativeTime, connectionText, offlineText, apply, applyStaticDom, hydrate, toggleLocale,
  };
})();
