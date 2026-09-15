export interface AiProviderSettings {
  endpoint: string;
  model: string;
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

export const DEFAULT_AI_PROVIDER: AiProviderSettings = {
  endpoint: DEFAULT_ENDPOINT,
  model: "",
};

export function loadAiProviderSettings(): AiProviderSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_PROVIDER;
    const parsed = JSON.parse(raw) as Partial<AiProviderSettings> & { apiKey?: unknown };
    return {
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint.trim() ? parsed.endpoint : DEFAULT_ENDPOINT,
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return DEFAULT_AI_PROVIDER;
  }
}

export function saveAiProviderSettings(settings: AiProviderSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
  if (!bookmarkIds.length) throw new Error("Select at least one bookmark.");
  if (bookmarkIds.length > 20) throw new Error("AI organization is limited to 20 bookmarks per request.");

  const response = await request<{ suggestions: AiOrganizationSuggestion[] }>("/api/ai/organize", {
    method: "POST",
    body: JSON.stringify({
      endpoint: settings.endpoint.trim(),
      model: settings.model.trim(),
      bookmarkIds,
    }),
  });
  return Array.isArray(response.suggestions) ? response.suggestions : [];
}
