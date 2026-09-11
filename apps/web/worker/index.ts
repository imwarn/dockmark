import {
  inferHealthPolicy,
  normalizeBookmarkUrl,
  type Bookmark,
  type Category,
  type HealthPolicy,
  type HealthStatus,
} from "@dockmark/core";
import { checkBookmarkHealth, listBookmarkHealthChecks } from "./health-check";
import { handleWorkspaceApi, WorkspaceHttpError } from "./workspaces";

interface Env {
  DB: D1DatabaseLike;
}

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface BookmarkRow {
  id: string;
  category_id: string | null;
  title: string;
  url: string;
  description: string | null;
  icon_url: string | null;
  health_policy: HealthPolicy;
  health_status: HealthStatus;
  position: number;
  created_at: string;
  updated_at: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const HEALTH_POLICIES = new Set<HealthPolicy>([
  "normal",
  "ignore",
  "local-only",
  "manual",
]);

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function problem(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

function categoryFromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    ...(row.icon ? { icon: row.icon } : {}),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bookmarkFromRow(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    ...(row.category_id ? { categoryId: row.category_id } : {}),
    title: row.title,
    url: row.url,
    ...(row.description ? { description: row.description } : {}),
    ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
    healthPolicy: row.health_policy,
    healthStatus: row.health_status,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", "Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_field", `${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function nullableString(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null | undefined {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_field", `${key} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed || null;
}

function optionalPosition(body: Record<string, unknown>): number | undefined {
  if (!hasOwn(body, "position")) return undefined;
  const value = body.position;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, "invalid_field", "position must be a non-negative integer.");
  }
  return value;
}

function optionalHealthPolicy(body: Record<string, unknown>): HealthPolicy | undefined {
  if (!hasOwn(body, "healthPolicy")) return undefined;
  const value = body.healthPolicy;
  if (typeof value !== "string" || !HEALTH_POLICIES.has(value as HealthPolicy)) {
    throw new HttpError(
      400,
      "invalid_field",
      "healthPolicy must be normal, ignore, local-only, or manual.",
    );
  }
  return value as HealthPolicy;
}

function parseBookmarkUrl(raw: string) {
  try {
    return normalizeBookmarkUrl(raw);
  } catch (error) {
    throw new HttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "url must be a valid HTTP or HTTPS URL.",
    );
  }
}

function statusForPolicy(policy: HealthPolicy): HealthStatus {
  if (policy === "ignore") return "ignored";
  if (policy === "local-only") return "local-only";
  return "unknown";
}

async function categoryExists(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  return Boolean(row);
}

async function getCategoryRow(env: Env, id: string) {
  return env.DB.prepare(
    "SELECT id, name, icon, position, created_at, updated_at FROM categories WHERE id = ?",
  )
    .bind(id)
    .first<CategoryRow>();
}

async function getBookmarkRow(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT id, category_id, title, url, description, icon_url,
            health_policy, health_status, position, created_at, updated_at
       FROM bookmarks
      WHERE id = ?`,
  )
    .bind(id)
    .first<BookmarkRow>();
}

async function nextCategoryPosition(env: Env) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM categories",
  ).first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function nextBookmarkPosition(env: Env, categoryId: string | null) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM bookmarks WHERE category_id IS ?",
  )
    .bind(categoryId)
    .first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function listCategories(env: Env) {
  const result = await env.DB.prepare(
    "SELECT id, name, icon, position, created_at, updated_at FROM categories ORDER BY position ASC, name COLLATE NOCASE ASC",
  ).all<CategoryRow>();
  return result.results.map(categoryFromRow);
}

async function createCategory(request: Request, env: Env) {
  const body = await readBody(request);
  const name = requiredString(body, "name", 80);
  const icon = optionalString(body, "icon", 64) ?? null;

  const duplicate = await env.DB.prepare(
    "SELECT id FROM categories WHERE lower(name) = lower(?) LIMIT 1",
  )
    .bind(name)
    .first<{ id: string }>();
  if (duplicate) {
    throw new HttpError(409, "category_exists", "A category with this name already exists.");
  }

  const position = optionalPosition(body) ?? (await nextCategoryPosition(env));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO categories (id, name, icon, position) VALUES (?, ?, ?, ?)",
  )
    .bind(id, name, icon, position)
    .run();

  const row = await getCategoryRow(env, id);
  if (!row) throw new HttpError(500, "write_failed", "Category could not be created.");
  return json({ category: categoryFromRow(row) }, { status: 201 });
}

async function updateCategory(request: Request, env: Env, id: string) {
  const existing = await getCategoryRow(env, id);
  if (!existing) throw new HttpError(404, "category_not_found", "Category not found.");

  const body = await readBody(request);
  const name = hasOwn(body, "name") ? requiredString(body, "name", 80) : existing.name;
  const iconInput = nullableString(body, "icon", 64);
  const icon = iconInput === undefined ? existing.icon : iconInput;
  const position = optionalPosition(body) ?? existing.position;

  if (name !== existing.name) {
    const duplicate = await env.DB.prepare(
      "SELECT id FROM categories WHERE lower(name) = lower(?) AND id <> ? LIMIT 1",
    )
      .bind(name, id)
      .first<{ id: string }>();
    if (duplicate) {
      throw new HttpError(409, "category_exists", "A category with this name already exists.");
    }
  }

  await env.DB.prepare(
    "UPDATE categories SET name = ?, icon = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  )
    .bind(name, icon, position, id)
    .run();

  const row = await getCategoryRow(env, id);
  if (!row) throw new HttpError(500, "write_failed", "Category could not be updated.");
  return json({ category: categoryFromRow(row) });
}

async function deleteCategory(env: Env, id: string) {
  const existing = await getCategoryRow(env, id);
  if (!existing) throw new HttpError(404, "category_not_found", "Category not found.");
  await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

async function listBookmarks(url: URL, env: Env) {
  const categoryId = url.searchParams.get("categoryId");
  const base = `SELECT id, category_id, title, url, description, icon_url,
                       health_policy, health_status, position, created_at, updated_at
                  FROM bookmarks`;

  const result = categoryId
    ? await env.DB.prepare(`${base} WHERE category_id = ? ORDER BY position ASC, title COLLATE NOCASE ASC`)
        .bind(categoryId)
        .all<BookmarkRow>()
    : await env.DB.prepare(`${base} ORDER BY position ASC, title COLLATE NOCASE ASC`).all<BookmarkRow>();

  return result.results.map(bookmarkFromRow);
}

async function createBookmark(request: Request, env: Env) {
  const body = await readBody(request);
  const title = requiredString(body, "title", 200);
  const rawUrl = requiredString(body, "url", 4096);
  const url = parseBookmarkUrl(rawUrl);
  const description = optionalString(body, "description", 2000) ?? null;
  const iconUrl = optionalString(body, "iconUrl", 4096) ?? null;

  let categoryId: string | null = null;
  if (hasOwn(body, "categoryId")) {
    const value = body.categoryId;
    if (value !== null && (typeof value !== "string" || !value.trim())) {
      throw new HttpError(400, "invalid_field", "categoryId must be a string or null.");
    }
    categoryId = typeof value === "string" ? value.trim() : null;
  }
  if (categoryId && !(await categoryExists(env, categoryId))) {
    throw new HttpError(400, "invalid_category", "categoryId does not reference an existing category.");
  }

  const duplicate = await env.DB.prepare("SELECT id FROM bookmarks WHERE url = ? LIMIT 1")
    .bind(url)
    .first<{ id: string }>();
  if (duplicate) {
    throw new HttpError(409, "bookmark_exists", "This URL is already bookmarked.");
  }

  const healthPolicy = optionalHealthPolicy(body) ?? inferHealthPolicy(url);
  const healthStatus = statusForPolicy(healthPolicy);
  const position = optionalPosition(body) ?? (await nextBookmarkPosition(env, categoryId));
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO bookmarks
      (id, category_id, title, url, description, icon_url, health_policy, health_status, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      categoryId,
      title,
      url,
      description,
      iconUrl,
      healthPolicy,
      healthStatus,
      position,
    )
    .run();

  const row = await getBookmarkRow(env, id);
  if (!row) throw new HttpError(500, "write_failed", "Bookmark could not be created.");
  return json({ bookmark: bookmarkFromRow(row) }, { status: 201 });
}

async function updateBookmark(request: Request, env: Env, id: string) {
  const existing = await getBookmarkRow(env, id);
  if (!existing) throw new HttpError(404, "bookmark_not_found", "Bookmark not found.");

  const body = await readBody(request);
  const title = hasOwn(body, "title") ? requiredString(body, "title", 200) : existing.title;
  const urlChanged = hasOwn(body, "url");
  const url = urlChanged
    ? parseBookmarkUrl(requiredString(body, "url", 4096))
    : existing.url;
  const descriptionInput = nullableString(body, "description", 2000);
  const description = descriptionInput === undefined ? existing.description : descriptionInput;
  const iconInput = nullableString(body, "iconUrl", 4096);
  const iconUrl = iconInput === undefined ? existing.icon_url : iconInput;

  let categoryId = existing.category_id;
  if (hasOwn(body, "categoryId")) {
    const value = body.categoryId;
    if (value !== null && (typeof value !== "string" || !value.trim())) {
      throw new HttpError(400, "invalid_field", "categoryId must be a string or null.");
    }
    categoryId = typeof value === "string" ? value.trim() : null;
  }
  if (categoryId && !(await categoryExists(env, categoryId))) {
    throw new HttpError(400, "invalid_category", "categoryId does not reference an existing category.");
  }

  if (url !== existing.url) {
    const duplicate = await env.DB.prepare(
      "SELECT id FROM bookmarks WHERE url = ? AND id <> ? LIMIT 1",
    )
      .bind(url, id)
      .first<{ id: string }>();
    if (duplicate) {
      throw new HttpError(409, "bookmark_exists", "This URL is already bookmarked.");
    }
  }

  const explicitPolicy = optionalHealthPolicy(body);
  const healthPolicy =
    explicitPolicy ??
    (urlChanged && (existing.health_policy === "normal" || existing.health_policy === "local-only")
      ? inferHealthPolicy(url)
      : existing.health_policy);
  const policyChanged = healthPolicy !== existing.health_policy;
  const healthStatus =
    urlChanged || policyChanged ? statusForPolicy(healthPolicy) : existing.health_status;
  const position = optionalPosition(body) ?? existing.position;

  await env.DB.prepare(
    `UPDATE bookmarks
        SET category_id = ?, title = ?, url = ?, description = ?, icon_url = ?,
            health_policy = ?, health_status = ?, position = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(
      categoryId,
      title,
      url,
      description,
      iconUrl,
      healthPolicy,
      healthStatus,
      position,
      id,
    )
    .run();

  const row = await getBookmarkRow(env, id);
  if (!row) throw new HttpError(500, "write_failed", "Bookmark could not be updated.");
  return json({ bookmark: bookmarkFromRow(row) });
}

async function deleteBookmark(env: Env, id: string) {
  const existing = await getBookmarkRow(env, id);
  if (!existing) throw new HttpError(404, "bookmark_not_found", "Bookmark not found.");
  await env.DB.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

function routeId(pathname: string, collection: "categories" | "bookmarks") {
  const match = pathname.match(new RegExp(`^/api/${collection}/([^/]+)$`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function healthRoute(pathname: string) {
  const match = pathname.match(/^\/api\/bookmarks\/([^/]+)\/(check|health)$/);
  if (!match?.[1] || !match[2]) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] };
}

async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (pathname === "/api/health") {
    let database = "unknown";
    try {
      const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      database = row?.ok === 1 ? "ok" : "error";
    } catch {
      database = "unavailable";
    }
    return json({ service: "dockmark", status: "ok", database });
  }

  const workspaceResponse = await handleWorkspaceApi(request, env.DB, pathname);
  if (workspaceResponse) return workspaceResponse;

  if (pathname === "/api/categories") {
    if (request.method === "GET") return json({ categories: await listCategories(env) });
    if (request.method === "POST") return createCategory(request, env);
    throw new HttpError(405, "method_not_allowed", "Method not allowed for categories.");
  }

  const categoryId = routeId(pathname, "categories");
  if (categoryId) {
    if (request.method === "GET") {
      const row = await getCategoryRow(env, categoryId);
      if (!row) throw new HttpError(404, "category_not_found", "Category not found.");
      return json({ category: categoryFromRow(row) });
    }
    if (request.method === "PATCH") return updateCategory(request, env, categoryId);
    if (request.method === "DELETE") return deleteCategory(env, categoryId);
    throw new HttpError(405, "method_not_allowed", "Method not allowed for category.");
  }

  if (pathname === "/api/bookmarks") {
    if (request.method === "GET") return json({ bookmarks: await listBookmarks(url, env) });
    if (request.method === "POST") return createBookmark(request, env);
    throw new HttpError(405, "method_not_allowed", "Method not allowed for bookmarks.");
  }

  const health = healthRoute(pathname);
  if (health) {
    if (health.action === "check" && request.method === "POST") {
      return checkBookmarkHealth(env.DB, health.id);
    }
    if (health.action === "health" && request.method === "GET") {
      return listBookmarkHealthChecks(env.DB, health.id);
    }
    throw new HttpError(405, "method_not_allowed", "Method not allowed for bookmark health.");
  }

  const bookmarkId = routeId(pathname, "bookmarks");
  if (bookmarkId) {
    if (request.method === "GET") {
      const row = await getBookmarkRow(env, bookmarkId);
      if (!row) throw new HttpError(404, "bookmark_not_found", "Bookmark not found.");
      return json({ bookmark: bookmarkFromRow(row) });
    }
    if (request.method === "PATCH") return updateBookmark(request, env, bookmarkId);
    if (request.method === "DELETE") return deleteBookmark(env, bookmarkId);
    throw new HttpError(405, "method_not_allowed", "Method not allowed for bookmark.");
  }

  throw new HttpError(404, "not_found", "API route not found.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof HttpError || error instanceof WorkspaceHttpError) {
        return problem(error.status, error.code, error.message);
      }
      console.error("Dockmark API error", error);
      return problem(500, "internal_error", "An unexpected server error occurred.");
    }
  },
};
