import {
  inferHealthPolicy,
  normalizeBookmarkUrl,
  type HealthPolicy,
  type HealthStatus,
} from "@dockmark/core";

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

interface D1BatchDatabaseLike extends D1DatabaseLike {
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
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

interface TagRow {
  id: string;
  name: string;
}

interface BookmarkDetailsInput {
  title: string;
  url: string;
  description: string | null;
  categoryId: string | null;
  healthPolicy?: HealthPolicy;
  tags: string[];
}

export class BookmarkDetailsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const HEALTH_POLICIES = new Set<HealthPolicy>(["normal", "ignore", "local-only", "manual"]);
const MAX_TAGS = 12;

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
    throw new BookmarkDetailsHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookmarkDetailsHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BookmarkDetailsHttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new BookmarkDetailsHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function nullableString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new BookmarkDetailsHttpError(400, "invalid_field", `${key} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new BookmarkDetailsHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed || null;
}

function parseBookmarkUrl(raw: string) {
  try {
    return normalizeBookmarkUrl(raw);
  } catch (error) {
    throw new BookmarkDetailsHttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "url must be a valid HTTP or HTTPS URL.",
    );
  }
}

function parseCategoryId(body: Record<string, unknown>) {
  const value = body.categoryId;
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new BookmarkDetailsHttpError(400, "invalid_field", "categoryId must be a string or null.");
  }
  return value.trim();
}

function parseHealthPolicy(body: Record<string, unknown>, required: boolean) {
  const value = body.healthPolicy;
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !HEALTH_POLICIES.has(value as HealthPolicy)) {
    throw new BookmarkDetailsHttpError(
      400,
      "invalid_field",
      "healthPolicy must be normal, ignore, local-only, or manual.",
    );
  }
  return value as HealthPolicy;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    throw new BookmarkDetailsHttpError(400, "invalid_tags", "tags must be an array of strings.");
  }
  if (value.length > MAX_TAGS) {
    throw new BookmarkDetailsHttpError(400, "invalid_tags", `A bookmark can have at most ${MAX_TAGS} tags.`);
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new BookmarkDetailsHttpError(400, "invalid_tags", "tags must contain only strings.");
    }
    const tag = entry.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) {
      throw new BookmarkDetailsHttpError(400, "invalid_tags", `Tag “${tag.slice(0, 24)}${tag.length > 24 ? "…" : ""}” exceeds the 40-character limit.`);
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) {
    throw new BookmarkDetailsHttpError(400, "invalid_tags", `A bookmark can have at most ${MAX_TAGS} unique tags.`);
  }
  return tags;
}

function parseInput(body: Record<string, unknown>, requirePolicy: boolean): BookmarkDetailsInput {
  return {
    title: requiredString(body, "title", 200),
    url: parseBookmarkUrl(requiredString(body, "url", 4096)),
    description: nullableString(body, "description", 2000),
    categoryId: parseCategoryId(body),
    healthPolicy: parseHealthPolicy(body, requirePolicy),
    tags: normalizeTags(body.tags),
  };
}

function statusForPolicy(policy: HealthPolicy): HealthStatus {
  if (policy === "ignore") return "ignored";
  if (policy === "local-only") return "local-only";
  return "unknown";
}

function bookmarkFromRow(row: BookmarkRow) {
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

const BOOKMARK_SELECT = `SELECT id, category_id, title, url, description, icon_url,
                                health_policy, health_status, position, created_at, updated_at
                           FROM bookmarks`;

async function getBookmark(db: D1DatabaseLike, id: string) {
  return db.prepare(`${BOOKMARK_SELECT} WHERE id = ? LIMIT 1`).bind(id).first<BookmarkRow>();
}

async function validateCategory(db: D1DatabaseLike, categoryId: string | null) {
  if (!categoryId) return;
  const row = await db.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1")
    .bind(categoryId)
    .first<{ id: string }>();
  if (!row) {
    throw new BookmarkDetailsHttpError(400, "invalid_category", "categoryId does not reference an existing category.");
  }
}

async function validateDuplicateUrl(db: D1DatabaseLike, url: string, excludeId?: string) {
  const row = excludeId
    ? await db.prepare("SELECT id FROM bookmarks WHERE url = ? AND id <> ? LIMIT 1").bind(url, excludeId).first<{ id: string }>()
    : await db.prepare("SELECT id FROM bookmarks WHERE url = ? LIMIT 1").bind(url).first<{ id: string }>();
  if (row) throw new BookmarkDetailsHttpError(409, "bookmark_exists", "This URL is already bookmarked.");
}

async function nextPosition(db: D1DatabaseLike, categoryId: string | null) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM bookmarks WHERE category_id IS ?",
  ).bind(categoryId).first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

function isBookmarkUrlUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLocaleLowerCase();
  return normalized.includes("unique") && normalized.includes("bookmarks.url");
}

function batchDb(db: D1DatabaseLike) {
  const candidate = db as D1BatchDatabaseLike;
  if (typeof candidate.batch !== "function") {
    throw new BookmarkDetailsHttpError(500, "batch_unavailable", "D1 batch execution is unavailable in this runtime.");
  }
  return candidate;
}

async function tagStatements(db: D1DatabaseLike, bookmarkId: string, tags: string[]) {
  const existingTags = await db.prepare("SELECT id, name FROM tags").all<TagRow>();
  const tagIdByName = new Map(existingTags.results.map((row) => [row.name.toLocaleLowerCase(), row.id]));
  const statements: D1PreparedStatementLike[] = [
    db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(bookmarkId),
  ];

  for (const name of tags) {
    const key = name.toLocaleLowerCase();
    let tagId = tagIdByName.get(key);
    if (!tagId) {
      tagId = crypto.randomUUID();
      tagIdByName.set(key, tagId);
      statements.push(db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").bind(tagId, name));
    }
    statements.push(
      db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)")
        .bind(bookmarkId, tagId),
    );
  }
  statements.push(db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)"));
  return statements;
}

async function createWithTags(request: Request, db: D1DatabaseLike) {
  const input = parseInput(await readBody(request), false);
  await validateCategory(db, input.categoryId);
  await validateDuplicateUrl(db, input.url);

  const id = crypto.randomUUID();
  const healthPolicy = input.healthPolicy ?? inferHealthPolicy(input.url);
  const healthStatus = statusForPolicy(healthPolicy);
  const position = await nextPosition(db, input.categoryId);
  const statements: D1PreparedStatementLike[] = [
    db.prepare(
      `INSERT INTO bookmarks
        (id, category_id, title, url, description, icon_url, health_policy, health_status, position)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(id, input.categoryId, input.title, input.url, input.description, healthPolicy, healthStatus, position),
  ];
  statements.push(...await tagStatements(db, id, input.tags));

  try {
    await batchDb(db).batch(statements);
  } catch (error) {
    if (error instanceof BookmarkDetailsHttpError) throw error;
    if (isBookmarkUrlUniqueViolation(error)) {
      throw new BookmarkDetailsHttpError(409, "bookmark_exists", "This URL is already bookmarked.");
    }
    throw error;
  }

  const row = await getBookmark(db, id);
  if (!row) throw new BookmarkDetailsHttpError(500, "write_failed", "Bookmark could not be created.");
  return json({ bookmark: bookmarkFromRow(row), tags: input.tags }, { status: 201 });
}

async function updateWithTags(request: Request, db: D1DatabaseLike, id: string) {
  const existing = await getBookmark(db, id);
  if (!existing) throw new BookmarkDetailsHttpError(404, "bookmark_not_found", "Bookmark not found.");

  const input = parseInput(await readBody(request), true);
  await validateCategory(db, input.categoryId);
  await validateDuplicateUrl(db, input.url, id);

  const healthPolicy = input.healthPolicy!;
  const urlChanged = input.url !== existing.url;
  const policyChanged = healthPolicy !== existing.health_policy;
  const healthStatus = urlChanged || policyChanged ? statusForPolicy(healthPolicy) : existing.health_status;
  const statements: D1PreparedStatementLike[] = [
    db.prepare(
      `UPDATE bookmarks
          SET category_id = ?, title = ?, url = ?, description = ?,
              health_policy = ?, health_status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    ).bind(input.categoryId, input.title, input.url, input.description, healthPolicy, healthStatus, id),
  ];
  statements.push(...await tagStatements(db, id, input.tags));

  try {
    await batchDb(db).batch(statements);
  } catch (error) {
    if (error instanceof BookmarkDetailsHttpError) throw error;
    if (isBookmarkUrlUniqueViolation(error)) {
      throw new BookmarkDetailsHttpError(409, "bookmark_exists", "This URL is already bookmarked.");
    }
    throw error;
  }

  const row = await getBookmark(db, id);
  if (!row) throw new BookmarkDetailsHttpError(500, "write_failed", "Bookmark could not be updated.");
  return json({ bookmark: bookmarkFromRow(row), tags: input.tags });
}

export async function handleBookmarkDetailsApi(
  request: Request,
  db: D1DatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/bookmarks/with-tags") {
    if (request.method !== "POST") {
      throw new BookmarkDetailsHttpError(405, "method_not_allowed", "Only POST is supported for atomic bookmark creation.");
    }
    return createWithTags(request, db);
  }

  const match = pathname.match(/^\/api\/bookmarks\/([^/]+)\/with-tags$/);
  if (!match?.[1]) return null;
  if (request.method !== "PUT") {
    throw new BookmarkDetailsHttpError(405, "method_not_allowed", "Only PUT is supported for atomic bookmark and tag updates.");
  }
  return updateWithTags(request, db, decodeURIComponent(match[1]));
}
