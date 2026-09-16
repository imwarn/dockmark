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

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

const STORAGE_KEY = "dockmarkAiProviderV1";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const MIN_AI_TIMEOUT_SECONDS = 15;
export const MAX_AI_TIMEOUT_SECONDS = 180;
export const DEFAULT_AI_TIMEOUT_SECONDS = 90;

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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...settings,
    timeoutSeconds: normalizedTimeout(settings.timeoutSeconds),
  }));
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

export function getAiProviderStatus() {
  return request<AiProviderStatus>("/api/ai/status");
}

export async function generateAiOrganizationSuggestions(
  settings: AiProviderSettings,
  bookmarkIds: string[],
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
    }),
  });
  return Array.isArray(response.suggestions) ? response.suggestions : [];
}
