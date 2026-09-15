import { inferHealthPolicy, normalizeBookmarkUrl, type HealthPolicy } from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface AiOrganizationEnv {
  DB: D1DatabaseLike;
  DOCKMARK_AI_API_KEY?: string;
}

interface BookmarkRow {
  id: string;
  category_id: string | null;
  title: string;
  url: string;
  description: string | null;
  health_policy: HealthPolicy;
}

interface CategoryRow {
  id: string;
  name: string;
}

interface TagRow {
  bookmark_id: string;
  name: string;
}

interface OrganizationSuggestion {
  bookmarkId: string;
  title: string;
  description: string;
  categoryName: string | null;
  tags: string[];
}

export class AiOrganizationHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BOOKMARKS = 20;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new AiOrganizationHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiOrganizationHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AiOrganizationHttpError(400, "invalid_field", `${key} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AiOrganizationHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function bookmarkIds(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    throw new AiOrganizationHttpError(400, "invalid_bookmarks", "Select at least one bookmark.");
  }
  if (value.length > MAX_BOOKMARKS) {
    throw new AiOrganizationHttpError(400, "too_many_bookmarks", `AI organization is limited to ${MAX_BOOKMARKS} bookmarks per request.`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new AiOrganizationHttpError(400, "invalid_bookmarks", "bookmarkIds must contain only bookmark ids.");
    }
    const id = item.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function providerEndpoint(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiOrganizationHttpError(400, "invalid_provider", "Provider endpoint must be a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new AiOrganizationHttpError(400, "invalid_provider", "Provider endpoint must use HTTPS.");
  }
  const normalized = normalizeBookmarkUrl(url.toString());
  if (inferHealthPolicy(normalized) === "local-only") {
    throw new AiOrganizationHttpError(400, "invalid_provider", "Provider endpoint must be a public HTTPS endpoint.");
  }
  return normalized;
}

function extractText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") return message.content;
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
      try {
        return JSON.parse(source.slice(start, end + 1)) as unknown;
      } catch {
        // Fall through to a stable provider error below.
      }
    }
    throw new AiOrganizationHttpError(502, "provider_invalid_json", "AI provider returned text that was not valid JSON.");
  }
}

function normalizeSuggestion(
  value: unknown,
  allowedIds: Set<string>,
  categoryLookup: Map<string, string>,
): OrganizationSuggestion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const bookmarkId = typeof row.bookmarkId === "string" ? row.bookmarkId : "";
  if (!allowedIds.has(bookmarkId)) return null;

  const title = typeof row.title === "string" ? row.title.trim().slice(0, 200) : "";
  const description = typeof row.description === "string" ? row.description.trim().slice(0, 2000) : "";
  const rawCategory = typeof row.categoryName === "string" ? row.categoryName.trim() : "";
  const categoryName = rawCategory ? categoryLookup.get(rawCategory.toLocaleLowerCase()) ?? null : null;

  const tags: string[] = [];
  const seen = new Set<string>();
  const rawTags = Array.isArray(row.tags) ? row.tags : [];
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

  return { bookmarkId, title, description, categoryName, tags };
}

async function loadOrganizationInput(db: D1DatabaseLike, ids: string[]) {
  const placeholders = ids.map(() => "?").join(", ");
  const bookmarksResult = await db.prepare(
    `SELECT id, category_id, title, url, description, health_policy
       FROM bookmarks
      WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<BookmarkRow>();

  const byId = new Map(bookmarksResult.results.map((row) => [row.id, row]));
  const bookmarks = ids.map((id) => byId.get(id)).filter((row): row is BookmarkRow => Boolean(row));
  if (bookmarks.length !== ids.length) {
    throw new AiOrganizationHttpError(404, "bookmark_not_found", "One or more selected bookmarks no longer exist.");
  }
  if (bookmarks.some((bookmark) => bookmark.health_policy !== "normal")) {
    throw new AiOrganizationHttpError(
      409,
      "protected_health_policy",
      "AI organization only accepts bookmarks with HealthPolicy normal. Protected policies were not sent to the provider.",
    );
  }

  const categoriesResult = await db.prepare("SELECT id, name FROM categories ORDER BY position ASC, name COLLATE NOCASE ASC")
    .all<CategoryRow>();
  const tagsResult = await db.prepare(
    `SELECT bt.bookmark_id, t.name
       FROM bookmark_tags bt
       JOIN tags t ON t.id = bt.tag_id
      WHERE bt.bookmark_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE ASC`,
  )
    .bind(...ids)
    .all<TagRow>();

  const tagsByBookmark = new Map<string, string[]>();
  for (const tag of tagsResult.results) {
    const list = tagsByBookmark.get(tag.bookmark_id) ?? [];
    list.push(tag.name);
    tagsByBookmark.set(tag.bookmark_id, list);
  }

  const categoryById = new Map(categoriesResult.results.map((category) => [category.id, category.name]));
  return {
    categories: categoriesResult.results,
    bookmarks: bookmarks.map((bookmark) => ({
      id: bookmark.id,
      title: bookmark.title,
      url: bookmark.url,
      description: bookmark.description ?? "",
      category: bookmark.category_id ? categoryById.get(bookmark.category_id) ?? null : null,
      tags: tagsByBookmark.get(bookmark.id) ?? [],
    })),
  };
}

async function callProvider(
  endpoint: string,
  model: string,
  apiKey: string,
  input: Awaited<ReturnType<typeof loadOrganizationInput>>,
) {
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              categories: input.categories.map((category) => category.name),
              bookmarks: input.bookmarks,
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

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiOrganizationHttpError(502, "provider_response_too_large", "AI provider response was too large.");
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new AiOrganizationHttpError(502, "provider_response_too_large", "AI provider response was too large.");
    }

    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) as unknown : null;
    } catch {
      throw new AiOrganizationHttpError(502, "provider_invalid_response", "AI provider returned a non-JSON HTTP response.");
    }

    if (!response.ok) {
      const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
      const error = record?.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
      const message = typeof error?.message === "string" ? error.message.slice(0, 500) : `AI provider request failed (${response.status}).`;
      throw new AiOrganizationHttpError(502, "provider_error", message);
    }
    return payload;
  } catch (error) {
    if (error instanceof AiOrganizationHttpError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiOrganizationHttpError(504, "provider_timeout", "AI provider request timed out.");
    }
    throw new AiOrganizationHttpError(502, "provider_unavailable", "AI provider could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}

async function organize(request: Request, env: AiOrganizationEnv) {
  const apiKey = env.DOCKMARK_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiOrganizationHttpError(
      503,
      "ai_key_not_configured",
      "Set the DOCKMARK_AI_API_KEY Worker secret before using AI-assisted organization.",
    );
  }

  const body = await readBody(request);
  const endpoint = providerEndpoint(requiredString(body, "endpoint", 4096));
  const model = requiredString(body, "model", 200);
  const ids = bookmarkIds(body.bookmarkIds);
  const input = await loadOrganizationInput(env.DB, ids);
  const payload = await callProvider(endpoint, model, apiKey, input);
  const text = extractText(payload);
  if (!text) {
    throw new AiOrganizationHttpError(502, "provider_missing_output", "AI provider response did not contain a supported text result.");
  }
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiOrganizationHttpError(502, "provider_invalid_suggestions", "AI provider returned an invalid suggestion object.");
  }

  const rawSuggestions = Array.isArray((parsed as Record<string, unknown>).suggestions)
    ? (parsed as Record<string, unknown>).suggestions as unknown[]
    : [];
  const allowedIds = new Set(ids);
  const categoryLookup = new Map(input.categories.map((category) => [category.name.toLocaleLowerCase(), category.name]));
  const normalized = rawSuggestions
    .map((value) => normalizeSuggestion(value, allowedIds, categoryLookup))
    .filter((value): value is OrganizationSuggestion => Boolean(value));
  const byId = new Map(normalized.map((suggestion) => [suggestion.bookmarkId, suggestion]));
  const suggestions = ids.flatMap((id) => {
    const suggestion = byId.get(id);
    return suggestion ? [suggestion] : [];
  });

  return json({ suggestions });
}

export async function handleAiOrganizationApi(
  request: Request,
  env: AiOrganizationEnv,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/ai/status") {
    if (request.method !== "GET") {
      throw new AiOrganizationHttpError(405, "method_not_allowed", "Method not allowed for AI status.");
    }
    return json({ apiKeyConfigured: Boolean(env.DOCKMARK_AI_API_KEY?.trim()) });
  }

  if (pathname === "/api/ai/organize") {
    if (request.method !== "POST") {
      throw new AiOrganizationHttpError(405, "method_not_allowed", "Method not allowed for AI organization.");
    }
    return organize(request, env);
  }

  return null;
}
