/**
 * [INPUT]: depends on LOCALE_STORAGE_KEY, normalizeAppearanceSettings, normalizeLocalePreference, resolveLocale, and appearance/locale types from @dockmark/core
 * [OUTPUT]: exports APPEARANCE_STORAGE_KEY, applyAppearance, applyLocalePreference, localAppearance, fetchAppearanceSettings, saveAppearanceSettings, saveAppearanceAndLocale, syncAppearanceFromCloud, and bindSystemAppearanceListener
 * [POS]: React-free DOM theme/locale application and /api/settings/appearance client in apps/web/src; consumed by main.tsx, AppearanceSettings.tsx, and i18n.ts
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  LOCALE_STORAGE_KEY,
  normalizeAppearanceSettings,
  normalizeLocalePreference,
  resolveLocale,
  type AppearancePreference,
  type AppearanceSettings,
  type LocalePreference,
  type ResolvedLocale,
  type UpdateAppearanceSettingsInput,
} from "@dockmark/core";

export const APPEARANCE_STORAGE_KEY = "dockmarkAppearanceV1";

function resolvedTheme(preference: AppearancePreference) {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return preference;
}

function updateThemeMetadata(theme: "light" | "dark") {
  const color = theme === "light" ? "#f4f7f5" : "#0a0f0c";
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = color;

  const foreground = theme === "light" ? "#173126" : "#b8e0c5";
  const background = theme === "light" ? "#f4f7f5" : "#0a0f0c";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${background}"/><path d="M17 15h14c11 0 18 6.4 18 17s-7 17-18 17H17V15Zm13.5 26c6.5 0 10.5-3.4 10.5-9s-4-9-10.5-9H25v18h5.5Z" fill="${foreground}"/><circle cx="52" cy="47" r="4" fill="${foreground}"/></svg>`;
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement("link");
    icon.rel = "icon";
    document.head.append(icon);
  }
  icon.type = "image/svg+xml";
  icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyAppearance(preference: AppearancePreference, persist = true) {
  const theme = resolvedTheme(preference);
  document.documentElement.dataset.appearance = preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  updateThemeMetadata(theme);
  if (persist) localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  window.dispatchEvent(new CustomEvent("dockmark:appearance", { detail: { preference, theme } }));
}

export function applyLocalePreference(preference: LocalePreference, persist = true): ResolvedLocale {
  const normalized = normalizeLocalePreference(preference);
  const resolved = resolveLocale(normalized);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.localePreference = normalized;
    document.documentElement.dataset.locale = resolved;
    document.documentElement.lang = resolved;
  }
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
    } catch {
      // Ignore storage write failures in restricted browser contexts.
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dockmark:locale", { detail: { preference: normalized, locale: resolved } }));
  }
  return resolved;
}

export function localAppearance(): AppearancePreference {
  const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export async function fetchAppearanceSettings(): Promise<AppearanceSettings> {
  const response = await fetch("/api/settings/appearance", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as {
    settings?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `Appearance request failed (${response.status}).`);
  return normalizeAppearanceSettings(payload.settings);
}

export async function saveAppearanceAndLocale(input: UpdateAppearanceSettingsInput): Promise<AppearanceSettings> {
  const response = await fetch("/api/settings/appearance", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as {
    settings?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? `Appearance update failed (${response.status}).`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return normalizeAppearanceSettings(payload.settings);
}

export async function saveAppearanceSettings(preference: AppearancePreference): Promise<AppearanceSettings> {
  return saveAppearanceAndLocale({ preference });
}

export async function syncAppearanceFromCloud(): Promise<AppearanceSettings | null> {
  try {
    const settings = await fetchAppearanceSettings();
    applyAppearance(settings.preference);
    applyLocalePreference(settings.locale);
    return settings;
  } catch {
    return null;
  }
}

export function bindSystemAppearanceListener() {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const listener = () => {
    if (localAppearance() === "system") applyAppearance("system", false);
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
