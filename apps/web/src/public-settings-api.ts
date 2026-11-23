/**
 * [INPUT]: depends on DEFAULT_PUBLIC_PAGE_SETTINGS, normalizePublicPageSettings, PublicPageLayout, PublicPageSettings, and UpdatePublicPageSettingsInput from @dockmark/core; calls /api/settings/public-page
 * [OUTPUT]: exports PUBLIC_SITE_CONFIG_STORAGE_KEY, PUBLIC_LAYOUT_STORAGE_KEY, local cache helpers, fetchPublicPageSettings, savePublicPageSettings, and visitor layout persistence helpers
 * [POS]: Web API and local cache adapter for Personal Navigation Station settings, consumed by PublicPage.tsx and PublicPageSettings.tsx
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  DEFAULT_PUBLIC_PAGE_SETTINGS,
  normalizePublicPageSettings,
  type PublicPageLayout,
  type PublicPageSettings,
  type UpdatePublicPageSettingsInput,
} from "@dockmark/core";

export const PUBLIC_SITE_CONFIG_STORAGE_KEY = "dockmarkPublicSiteConfigV1";
export const PUBLIC_LAYOUT_STORAGE_KEY = "dockmarkPublicLayoutV1";
export const PUBLIC_SITE_CONFIG_EVENT = "dockmark:public-page-settings";

function isPublicPageLayout(value: unknown): value is PublicPageLayout {
  return value === "grid" || value === "compact" || value === "list";
}

export function readLocalPublicPageSettings(): PublicPageSettings {
  try {
    const raw = window.localStorage.getItem(PUBLIC_SITE_CONFIG_STORAGE_KEY);
    return raw
      ? normalizePublicPageSettings(JSON.parse(raw))
      : normalizePublicPageSettings(DEFAULT_PUBLIC_PAGE_SETTINGS);
  } catch {
    return normalizePublicPageSettings(DEFAULT_PUBLIC_PAGE_SETTINGS);
  }
}

export function writeLocalPublicPageSettings(settings: PublicPageSettings) {
  const normalized = normalizePublicPageSettings(settings);
  try {
    window.localStorage.setItem(PUBLIC_SITE_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota or private-browsing failures.
  }
  window.dispatchEvent(new CustomEvent(PUBLIC_SITE_CONFIG_EVENT, { detail: normalized }));
}

export function readVisitorPublicLayout(): PublicPageLayout | null {
  try {
    const raw = window.localStorage.getItem(PUBLIC_LAYOUT_STORAGE_KEY);
    return isPublicPageLayout(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeVisitorPublicLayout(layout: PublicPageLayout) {
  try {
    window.localStorage.setItem(PUBLIC_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Ignore storage quota or private-browsing failures.
  }
}

export async function fetchPublicPageSettings(): Promise<PublicPageSettings> {
  const response = await fetch("/api/settings/public-page", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    settings?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Public page settings request failed (${response.status}).`);
  }
  const normalized = normalizePublicPageSettings(payload.settings);
  writeLocalPublicPageSettings(normalized);
  return normalized;
}

export async function savePublicPageSettings(input: UpdatePublicPageSettingsInput): Promise<PublicPageSettings> {
  const response = await fetch("/api/settings/public-page", {
    method: "PATCH",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    settings?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Could not save public page settings (${response.status}).`);
  }
  const normalized = normalizePublicPageSettings(payload.settings);
  writeLocalPublicPageSettings(normalized);
  return normalized;
}
