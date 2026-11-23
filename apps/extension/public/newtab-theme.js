/**
 * [INPUT]: depends on localStorage, matchMedia, navigator.language, and optional chrome.storage.local
 * [OUTPUT]: exposes window.dockmarkAppearance ({ STORAGE_KEY, apply, current, cycle, hydrate, resolved }) and sets html[data-theme] and html[lang] before first paint
 * [POS]: head-loaded zero-FOUC theme and locale bootstrapper for apps/extension/public/newtab.html
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
(() => {
  const STORAGE_KEY = "dockmarkAppearanceV1";
  const LOCALE_KEY = "dockmarkLocaleV1";

  function normalize(value) {
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  }

  function normalizeLocale(value) {
    if (typeof value !== "string") return "system";
    const cleaned = value.trim().toLowerCase().replace(/_/g, "-");
    if (cleaned === "en" || cleaned.startsWith("en-")) return "en";
    if (cleaned === "zh" || cleaned.startsWith("zh-")) return "zh-CN";
    return "system";
  }

  function resolveLocale(preference) {
    if (preference === "en" || preference === "zh-CN") return preference;
    const candidate = typeof navigator !== "undefined" ? navigator.language : "en";
    return String(candidate || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  }

  function safeLocalGet(key = STORAGE_KEY) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeLocalSet(value, key = STORAGE_KEY) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage errors in restricted contexts.
    }
  }

  function resolved(preference) {
    if (preference === "system") {
      return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return preference;
  }

  function notify(preference, theme) {
    window.dispatchEvent(new CustomEvent("dockmark:appearance", { detail: { preference, theme } }));
  }

  function apply(preference, persist = true) {
    const normalized = normalize(preference);
    const theme = resolved(normalized);
    document.documentElement.dataset.appearance = normalized;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f7f5" : "#0a0f0c");
    if (persist) {
      safeLocalSet(normalized);
      try {
        chrome?.storage?.local?.set({ [STORAGE_KEY]: normalized }).catch?.(() => undefined);
      } catch {
        // Ignore when running outside extension context.
      }
    }
    notify(normalized, theme);
    return normalized;
  }

  function bootstrapLocaleAttributes() {
    const preference = normalizeLocale(safeLocalGet(LOCALE_KEY));
    const locale = resolveLocale(preference);
    document.documentElement.dataset.localePreference = preference;
    document.documentElement.dataset.locale = locale;
    document.documentElement.lang = locale;
  }

  function current() {
    return normalize(safeLocalGet());
  }

  function cycle() {
    const order = ["system", "light", "dark"];
    const next = order[(order.indexOf(current()) + 1) % order.length];
    return apply(next, true);
  }

  async function hydrate() {
    const localRaw = safeLocalGet();
    if (localRaw !== null) return apply(localRaw, false);
    try {
      const stored = await chrome?.storage?.local?.get(STORAGE_KEY);
      if (stored && stored[STORAGE_KEY] !== undefined) {
        return apply(stored[STORAGE_KEY], false);
      }
    } catch {
      // Fall back to system appearance.
    }
    return apply("system", false);
  }

  apply(current(), false);
  bootstrapLocaleAttributes();

  const media = matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => {
    if (current() === "system") apply("system", false);
  });

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) apply(event.newValue, false);
  });

  try {
    chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) return;
      const nextValue = changes[STORAGE_KEY].newValue;
      const normalized = apply(nextValue, false);
      if (nextValue === undefined) {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      } else {
        safeLocalSet(normalized);
      }
    });
  } catch {
    // Ignore outside extension context.
  }

  window.dockmarkAppearance = { STORAGE_KEY, apply, current, cycle, hydrate, resolved };
})();
