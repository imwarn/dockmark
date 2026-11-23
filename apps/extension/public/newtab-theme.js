/**
 * [INPUT]: depends on localStorage, matchMedia, and optional chrome.storage.local
 * [OUTPUT]: exposes window.dockmarkAppearance ({ apply, current, cycle, hydrate }) and updates html[data-theme] before first paint
 * [POS]: head-loaded theme bootstrapper for apps/extension/public/newtab.html
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
(() => {
  const STORAGE_KEY = "dockmarkAppearanceV1";

  function normalize(value) {
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  }

  function safeLocalGet() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function safeLocalSet(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
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
