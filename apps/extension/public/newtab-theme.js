(() => {
  const STORAGE_KEY = "dockmarkAppearanceV1";

  function normalize(value) {
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  }

  function resolved(preference) {
    if (preference === "system") {
      return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    return preference;
  }

  function apply(preference, persist = true) {
    const normalized = normalize(preference);
    const theme = resolved(normalized);
    document.documentElement.dataset.appearance = normalized;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f7f5" : "#0a0f0c");
    if (persist) localStorage.setItem(STORAGE_KEY, normalized);
    return normalized;
  }

  function current() {
    return normalize(localStorage.getItem(STORAGE_KEY));
  }

  apply(current(), false);
  const media = matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", () => {
    if (current() === "system") apply("system", false);
  });

  window.dockmarkAppearance = { apply, current };
})();
