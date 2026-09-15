import type { Bookmark, Category } from "@dockmark/core";

export interface AiProviderSettings {
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface AiOrganizationSuggestion {
  bookmarkId: string;
  title: string;
  description: string;
  categoryName: string | null;
  tags: string[];
}

export interface AiOrganizationInput {
  bookmarks: Bookmark[];
  categories: Category[];
  bookmarkTags: Record<string, string[]>;
}

const STORAGE_KEY = "dockmarkAiProviderV1";
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

export const DEFAULT_AI_PROVIDER: AiProviderSettings = {
  endpoint: DEFAULT_ENDPOINT,
  model: "",
  apiKey: "",
};

export function loadAiProviderSettings(): AiProviderSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_PROVIDER;
    const parsed = JSON.parse(raw) as Partial<AiProviderSettings>;
    return {
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint.trim() ? parsed.endpoint : DEFAULT_ENDPOINT,
      model: typeof parsed.model === "string" ? parsed.model : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return DEFAULT_AI_PROVIDER;
  }
}

export function saveAiProviderSettings(settings: AiProviderSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearAiProviderKey() {
  const current = loadAiProviderSettings();
  saveAiProviderSettings({ ...current, apiKey: "" });
}

function validateEndpoint(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Provider endpoint must be a valid URL.");
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Provider endpoint must use HTTPS, except localhost development endpoints.");
  }
  return url.toString();
}

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return message.content;

  const output = Array.isArray(record.output) ? record.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const source = fenced ?? trimmed;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(source.slice(start, end + 1)) as unknown;
    }
    throw new Error("AI provider returned text that was not valid JSON.");
  }
}

function normalizeSuggestion(
  value: unknown,
  allowedIds: Set<string>,
  categoryNames: Map<string, string>,
): AiOrganizationSuggestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const bookmarkId = typeof row.bookmarkId === "string" ? row.bookmarkId : "";
  if (!allowedIds.has(bookmarkId)) return null;

  const title = typeof row.title === "string" ? row.title.trim().slice(0, 200) : "";
  const description = typeof row.description === "string" ? row.description.trim().slice(0, 2000) : "";
  const rawCategory = typeof row.categoryName === "string" ? row.categoryName.trim() : "";
  const categoryName = rawCategory ? categoryNames.get(rawCategory.toLocaleLowerCase()) ?? null : null;

  const rawTags = Array.isArray(row.tags) ? row.tags : [];
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of rawTags) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 5) break;
  }

  return {
    bookmarkId,
    title,
    description,
    categoryName,
    tags,
  };
}

export async function generateAiOrganizationSuggestions(
  settings: AiProviderSettings,
  input: AiOrganizationInput,
): Promise<AiOrganizationSuggestion[]> {
  const endpoint = validateEndpoint(settings.endpoint);
  const model = settings.model.trim();
  if (!model) throw new Error("Choose an AI model before generating suggestions.");
  if (!input.bookmarks.length) throw new Error("Select at least one bookmark.");
  if (input.bookmarks.length > 20) throw new Error("AI organization is limited to 20 bookmarks per request.");

  const categoryNames = input.categories.map((category) => category.name);
  const requestBookmarks = input.bookmarks.map((bookmark) => ({
    id: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    description: bookmark.description ?? "",
    category: bookmark.categoryId
      ? input.categories.find((category) => category.id === bookmark.categoryId)?.name ?? null
      : null,
    tags: input.bookmarkTags[bookmark.id] ?? [],
  }));

  const system = [
    "You organize a personal bookmark library.",
    "Return JSON only as an object with a suggestions array.",
    "Each suggestion must contain bookmarkId, title, description, categoryName, tags.",
    "categoryName must be null or exactly one of the supplied existing category names; never invent a category.",
    "Use at most 5 concise tags per bookmark.",
    "Clean titles conservatively and keep product/site names recognizable.",
    "Descriptions should be concise factual summaries, not marketing copy.",
    "Never propose a URL, health policy, health status, deletion, browser write, or any other field.",
    "Do not omit a selected bookmark.",
  ].join(" ");

  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (settings.apiKey.trim()) headers.set("authorization", `Bearer ${settings.apiKey.trim()}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            categories: categoryNames,
            bookmarks: requestBookmarks,
            responseShape: {
              suggestions: [
                {
                  bookmarkId: "bookmark id",
                  title: "clean title",
                  description: "short description",
                  categoryName: "existing category name or null",
                  tags: ["tag"],
                },
              ],
            },
          }),
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    const error = record?.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
    const message = typeof error?.message === "string" ? error.message : `AI provider request failed (${response.status}).`;
    throw new Error(message);
  }

  const text = extractText(payload);
  if (!text) throw new Error("AI provider response did not contain a supported text result.");
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI provider returned an invalid suggestion object.");
  }

  const suggestions = Array.isArray((parsed as Record<string, unknown>).suggestions)
    ? (parsed as Record<string, unknown>).suggestions as unknown[]
    : [];
  const allowedIds = new Set(input.bookmarks.map((bookmark) => bookmark.id));
  const categoryLookup = new Map(input.categories.map((category) => [category.name.toLocaleLowerCase(), category.name]));
  const normalized = suggestions
    .map((value) => normalizeSuggestion(value, allowedIds, categoryLookup))
    .filter((value): value is AiOrganizationSuggestion => Boolean(value));

  const byId = new Map(normalized.map((suggestion) => [suggestion.bookmarkId, suggestion]));
  return input.bookmarks.flatMap((bookmark) => {
    const suggestion = byId.get(bookmark.id);
    return suggestion ? [suggestion] : [];
  });
}
