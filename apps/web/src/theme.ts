import {
  normalizeAppearanceSettings,
  type AppearancePreference,
  type AppearanceSettings,
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

export async function saveAppearanceSettings(preference: AppearancePreference): Promise<AppearanceSettings> {
  const response = await fetch("/api/settings/appearance", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preference }),
  });
  const payload = await response.json().catch(() => ({})) as {
    settings?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? `Appearance update failed (${response.status}).`);
  return normalizeAppearanceSettings(payload.settings);
}

export async function syncAppearanceFromCloud() {
  try {
    const settings = await fetchAppearanceSettings();
    applyAppearance(settings.preference);
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
