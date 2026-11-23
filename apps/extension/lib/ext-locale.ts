/**
 * [INPUT]: depends on LOCALE_STORAGE_KEY, normalizeLocalePreference, resolveLocale, tx, normalizeAppearancePreference from @dockmark/core; depends on browser from wxt/browser
 * [OUTPUT]: exports theme and locale persistence, DOM application, storage hydration, and reactive listeners for extension UI pages
 * [POS]: shared UI preference runtime in apps/extension/lib used by popup and local-health-permission entrypoints
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  LOCALE_STORAGE_KEY,
  normalizeAppearancePreference,
  normalizeLocalePreference,
  resolveLocale,
  tx,
  type AppearancePreference,
  type LocalePreference,
  type ResolvedLocale,
} from "@dockmark/core";
import { browser } from "wxt/browser";

export const APPEARANCE_STORAGE_KEY = "dockmarkAppearanceV1";
export { LOCALE_STORAGE_KEY, tx };
export type { AppearancePreference, LocalePreference, ResolvedLocale };

export function resolvedTheme(preference: AppearancePreference): "light" | "dark" {
  if (preference === "system") {
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return preference;
}

export function readLocalAppearance(): AppearancePreference {
  try {
    return normalizeAppearancePreference(localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function readLocalLocalePreference(): LocalePreference {
  try {
    return normalizeLocalePreference(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function applyExtensionAppearance(
  preference: unknown,
  persist = true,
): AppearancePreference {
  const normalized = normalizeAppearancePreference(preference);
  const theme = resolvedTheme(normalized);
  document.documentElement.dataset.appearance = normalized;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4f7f5" : "#0a0f0c");
  if (persist) {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors in restricted contexts.
    }
    void browser.storage.local.set({ [APPEARANCE_STORAGE_KEY]: normalized }).catch(() => undefined);
  }
  return normalized;
}

export function applyExtensionLocale(
  preference: unknown,
  persist = true,
): { preference: LocalePreference; locale: ResolvedLocale } {
  const normalized = normalizeLocalePreference(preference);
  const locale = resolveLocale(normalized);
  document.documentElement.dataset.localePreference = normalized;
  document.documentElement.dataset.locale = locale;
  document.documentElement.lang = locale;
  if (persist) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage errors in restricted contexts.
    }
    void browser.storage.local.set({ [LOCALE_STORAGE_KEY]: normalized }).catch(() => undefined);
  }
  return { preference: normalized, locale };
}

export async function hydrateExtensionPreferences(): Promise<{
  appearance: AppearancePreference;
  localePreference: LocalePreference;
  locale: ResolvedLocale;
}> {
  const rawLocalAppearance = safeGetLocalStorage(APPEARANCE_STORAGE_KEY);
  const rawLocalLocale = safeGetLocalStorage(LOCALE_STORAGE_KEY);

  let storedAppearance: unknown = undefined;
  let storedLocale: unknown = undefined;
  try {
    const stored = await browser.storage.local.get([APPEARANCE_STORAGE_KEY, LOCALE_STORAGE_KEY]);
    storedAppearance = stored[APPEARANCE_STORAGE_KEY];
    storedLocale = stored[LOCALE_STORAGE_KEY];
  } catch {
    // Fall back to localStorage values.
  }

  const appearancePref = rawLocalAppearance !== null
    ? normalizeAppearancePreference(rawLocalAppearance)
    : storedAppearance !== undefined
      ? normalizeAppearancePreference(storedAppearance)
      : "system";

  const localePref = rawLocalLocale !== null
    ? normalizeLocalePreference(rawLocalLocale)
    : storedLocale !== undefined
      ? normalizeLocalePreference(storedLocale)
      : "system";

  const appliedAppearance = applyExtensionAppearance(appearancePref, false);
  const appliedLocale = applyExtensionLocale(localePref, false);
  return {
    appearance: appliedAppearance,
    localePreference: appliedLocale.preference,
    locale: appliedLocale.locale,
  };
}

function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function subscribeExtensionPreferences(handlers: {
  onAppearance?: (preference: AppearancePreference) => void;
  onLocale?: (preference: LocalePreference, locale: ResolvedLocale) => void;
}): () => void {
  const media = matchMedia("(prefers-color-scheme: light)");
  const handleMedia = () => {
    const current = readLocalAppearance();
    if (current === "system") {
      applyExtensionAppearance("system", false);
      handlers.onAppearance?.("system");
    }
  };
  const handleLanguage = () => {
    const current = readLocalLocalePreference();
    if (current === "system") {
      const next = applyExtensionLocale("system", false);
      handlers.onLocale?.(next.preference, next.locale);
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_STORAGE_KEY) {
      const pref = applyExtensionAppearance(event.newValue, false);
      handlers.onAppearance?.(pref);
    } else if (event.key === LOCALE_STORAGE_KEY) {
      const next = applyExtensionLocale(event.newValue, false);
      handlers.onLocale?.(next.preference, next.locale);
    }
  };
  const handleBrowserStorage: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
    changes,
    areaName,
  ) => {
    if (areaName !== "local") return;
    if (changes[APPEARANCE_STORAGE_KEY]) {
      const nextValue = changes[APPEARANCE_STORAGE_KEY].newValue;
      const pref = applyExtensionAppearance(nextValue, false);
      try {
        if (nextValue === undefined) localStorage.removeItem(APPEARANCE_STORAGE_KEY);
        else localStorage.setItem(APPEARANCE_STORAGE_KEY, pref);
      } catch {
        // Ignore storage write errors.
      }
      handlers.onAppearance?.(pref);
    }
    if (changes[LOCALE_STORAGE_KEY]) {
      const nextValue = changes[LOCALE_STORAGE_KEY].newValue;
      const next = applyExtensionLocale(nextValue, false);
      try {
        if (nextValue === undefined) localStorage.removeItem(LOCALE_STORAGE_KEY);
        else localStorage.setItem(LOCALE_STORAGE_KEY, next.preference);
      } catch {
        // Ignore storage write errors.
      }
      handlers.onLocale?.(next.preference, next.locale);
    }
  };

  media.addEventListener("change", handleMedia);
  window.addEventListener("languagechange", handleLanguage);
  window.addEventListener("storage", handleStorage);
  browser.storage.onChanged.addListener(handleBrowserStorage);

  return () => {
    media.removeEventListener("change", handleMedia);
    window.removeEventListener("languagechange", handleLanguage);
    window.removeEventListener("storage", handleStorage);
    browser.storage.onChanged.removeListener(handleBrowserStorage);
  };
}
