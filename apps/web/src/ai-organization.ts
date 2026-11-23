/**
 * [INPUT]: depends on AiSettings, UpdateAiSettingsInput, DEFAULT_AI_SETTINGS, normalizeAiSettings, and ResolvedLocale from @dockmark/core and currentResolvedLocale from ./i18n; calls /api/settings/ai, /api/ai/status, /api/ai/organize, and /api/ai/apply
 * [OUTPUT]: exports AI provider local/cloud settings sync helpers (fetchAiSettings, saveCloudAiSettings, loadAiProviderSettings, saveAiProviderSettings), timeout constants, status fetch, locale-aware suggestion generator, and patch applier
 * [POS]: web client wrapper for AI-assisted bookmark organization and non-secret AI settings sync in apps/web/src; consumed by AiOrganizationSettings.tsx and InboxPage.tsx
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  AI_SETTINGS_VERSION,
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  type AiSettings,
  type ResolvedLocale,
  type UpdateAiSettingsInput,
} from "@dockmark/core";
import { currentResolvedLocale } from "./i18n";

export interface AiProviderSettings {
  endpoint: string;
  model: string;
  timeoutSeconds: number;
}

export interface AiProviderStatus {
  apiKeyConfigured: boolean;
}

export interface AiOrganizationSuggestion {
  bookmarkId: string;
  title: string;
  description: string;
  categoryName: string | null;
  tags: string[];
}

export interface AiOrganizationPatch {
  bookmarkId: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  tags: string[];
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

const STORAGE_KEY = "dockmarkAiProviderV1";
const DEFAULT_ENDPOINT = DEFAULT_AI_SETTINGS.endpoint;
export const MIN_AI_TIMEOUT_SECONDS = 15;
export const MAX_AI_TIMEOUT_SECONDS = 180;
export const DEFAULT_AI_TIMEOUT_SECONDS = DEFAULT_AI_SETTINGS.timeoutSeconds;

function normalizedTimeout(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_AI_TIMEOUT_SECONDS && value <= MAX_AI_TIMEOUT_SECONDS
    ? value
    : DEFAULT_AI_TIMEOUT_SECONDS;
}

export const DEFAULT_AI_PROVIDER: AiProviderSettings = {
  endpoint: DEFAULT_ENDPOINT,
  model: "",
  timeoutSeconds: DEFAULT_AI_TIMEOUT_SECONDS,
};

export function loadAiProviderSettings(): AiProviderSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_PROVIDER;
    const parsed = JSON.parse(raw) as Partial<AiProviderSettings> & { apiKey?: unknown };
    return {
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint.trim() ? parsed.endpoint : DEFAULT_ENDPOINT,
      model: typeof parsed.model === "string" ? parsed.model : "",
      timeoutSeconds: normalizedTimeout(parsed.timeoutSeconds),
    };
  } catch {
    return DEFAULT_AI_PROVIDER;
  }
}

export function saveAiProviderSettings(settings: AiProviderSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      endpoint: settings.endpoint,
      model: settings.model,
      timeoutSeconds: normalizedTimeout(settings.timeoutSeconds),
    }));
  } catch {
    // Ignore storage quota or private browsing errors.
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return payload;
}

export async function fetchAiSettings(): Promise<AiSettings> {
  const response = await request<{ settings: AiSettings }>("/api/settings/ai");
  const cloud = normalizeAiSettings(response.settings);
  const local = loadAiProviderSettings();

  if (!cloud.model.trim() && local.model.trim()) {
    return normalizeAiSettings({
      version: AI_SETTINGS_VERSION,
      endpoint: local.endpoint,
      model: local.model,
      timeoutSeconds: local.timeoutSeconds,
      updatedAt: cloud.updatedAt,
    });
  }

  if (cloud.model.trim() || cloud.updatedAt !== null) {
    saveAiProviderSettings({
      endpoint: cloud.endpoint,
      model: cloud.model,
      timeoutSeconds: cloud.timeoutSeconds,
    });
  }
  return cloud;
}

export async function saveCloudAiSettings(input: UpdateAiSettingsInput): Promise<AiSettings> {
  const response = await request<{ settings: AiSettings }>("/api/settings/ai", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  const settings = normalizeAiSettings(response.settings);
  saveAiProviderSettings({
    endpoint: settings.endpoint,
    model: settings.model,
    timeoutSeconds: settings.timeoutSeconds,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dockmark:ai-settings", { detail: settings }));
  }
  return settings;
}

export function getAiProviderStatus() {
  return request<AiProviderStatus>("/api/ai/status");
}

export async function generateAiOrganizationSuggestions(
  settings: AiProviderSettings,
  bookmarkIds: string[],
  locale: ResolvedLocale = currentResolvedLocale(),
): Promise<AiOrganizationSuggestion[]> {
  if (!settings.endpoint.trim()) throw new Error("Choose an AI provider endpoint before generating suggestions.");
  if (!settings.model.trim()) throw new Error("Choose an AI model before generating suggestions.");
  if (!Number.isInteger(settings.timeoutSeconds) || settings.timeoutSeconds < MIN_AI_TIMEOUT_SECONDS || settings.timeoutSeconds > MAX_AI_TIMEOUT_SECONDS) {
    throw new Error(`AI provider timeout must be between ${MIN_AI_TIMEOUT_SECONDS} and ${MAX_AI_TIMEOUT_SECONDS} seconds.`);
  }
  if (!bookmarkIds.length) throw new Error("Select at least one bookmark.");
  if (bookmarkIds.length > 20) throw new Error("AI organization is limited to 20 bookmarks per request.");

  const response = await request<{ suggestions: AiOrganizationSuggestion[] }>("/api/ai/organize", {
    method: "POST",
    body: JSON.stringify({
      endpoint: settings.endpoint.trim(),
      model: settings.model.trim(),
      timeoutSeconds: settings.timeoutSeconds,
      bookmarkIds,
      locale,
    }),
  });
  return Array.isArray(response.suggestions) ? response.suggestions : [];
}

export async function applyAiOrganizationPatches(patches: AiOrganizationPatch[]) {
  if (!patches.length) throw new Error("Select at least one reviewed AI suggestion to apply.");
  if (patches.length > 20) throw new Error("AI apply is limited to 20 bookmarks per request.");
  return request<{ applied: number; bookmarkIds: string[] }>("/api/ai/apply", {
    method: "POST",
    body: JSON.stringify({ patches }),
  });
}
