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

export interface CaptureInboxDbLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface BookmarkRow {
  id: string;
  category_id: string | null;
  category_name?: string | null;
  title: string;
  url: string;
  description: string | null;
  icon_url: string | null;
  health_policy: HealthPolicy;
  health_status: HealthStatus;
  position: number;
  inbox_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CaptureInput {
  title: string;
  url: string;
}

export class CaptureInboxHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new CaptureInboxHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CaptureInboxHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new CaptureInboxHttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new CaptureInboxHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function parseBookmarkUrl(raw: string) {
  try {
    return normalizeBookmarkUrl(raw);
  } catch (error) {
    throw new CaptureInboxHttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "url must be a valid HTTP or HTTPS URL.",
    );
  }
}

function parseCaptureInput(value: unknown, index?: number): CaptureInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CaptureInboxHttpError(
      400,
      "invalid_field",
      index === undefined ? "Capture input must be an object." : `items[${index}] must be an object.`,
    );
  }
  const record = value as Record<string, unknown>;
  const title = requiredString(record, "title", 200);
  const url = parseBookmarkUrl(requiredString(record, "url", 4096));
  return { title, url };
}

function parseCaptureItems(body: Record<string, unknown>) {
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw new CaptureInboxHttpError(400, "invalid_field", "items must be a non-empty array.");
  }
  if (rawItems.length > 100) {
    throw new CaptureInboxHttpError(400, "invalid_field", "A reviewed capture can contain at most 100 tabs.");
  }
  return rawItems.map((item, index) => parseCaptureInput(item, index));
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
    ...(row.category_name ? { categoryName: row.category_name } : {}),
    title: row.title,
    url: row.url,
    ...(row.description ? { description: row.description } : {}),
    ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
    healthPolicy: row.health_policy,
    healthStatus: row.health_status,
    position: row.position,
    ...(row.inbox_at ? { inboxAt: row.inbox_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BOOKMARK_SELECT = `SELECT b.id, b.category_id, c.name AS category_name,
                                b.title, b.url, b.description, b.icon_url,
                                b.health_policy, b.health_status, b.position,
                                b.inbox_at, b.created_at, b.updated_at
                           FROM bookmarks b
                      LEFT JOIN categories c ON c.id = b.category_id`;

async function nextBookmarkPosition(db: CaptureInboxDbLike, categoryId: string | null) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM bookmarks WHERE category_id IS ?",
  )
    .bind(categoryId)
    .first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function duplicateForUrl(db: CaptureInboxDbLike, url: string) {
  return db.prepare(`${BOOKMARK_SELECT} WHERE b.url = ? LIMIT 1`)
    .bind(url)
    .first<BookmarkRow>();
}

async function insertCapture(db: CaptureInboxDbLike, input: CaptureInput) {
  const healthPolicy = inferHealthPolicy(input.url);
  const healthStatus = statusForPolicy(healthPolicy);
  const position = await nextBookmarkPosition(db, null);
  const id = crypto.randomUUID();

  await db.prepare(
    `INSERT INTO bookmarks
      (id, category_id, title, url, description, icon_url, health_policy, health_status, position, inbox_at)
     VALUES (?, NULL, ?, ?, NULL, NULL, ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(id, input.title, input.url, healthPolicy, healthStatus, position)
    .run();

  const row = await db.prepare(`${BOOKMARK_SELECT} WHERE b.id = ? LIMIT 1`)
    .bind(id)
    .first<BookmarkRow>();
  if (!row) throw new CaptureInboxHttpError(500, "write_failed", "Captured bookmark could not be created.");
  return row;
}

async function captureBookmark(request: Request, db: CaptureInboxDbLike) {
  const input = parseCaptureInput(await readBody(request));
  const duplicate = await duplicateForUrl(db, input.url);
  if (duplicate) {
    return json({
      result: "duplicate",
      bookmark: bookmarkFromRow(duplicate),
      duplicateState: duplicate.inbox_at ? "inbox" : "library",
    });
  }

  const row = await insertCapture(db, input);
  return json({ result: "created", bookmark: bookmarkFromRow(row) }, { status: 201 });
}

async function reviewCaptureBatch(request: Request, db: CaptureInboxDbLike) {
  const items = parseCaptureItems(await readBody(request));
  const firstIndexByUrl = new Map<string, number>();
  const reviewed = [] as Array<Record<string, unknown>>;

  for (const [index, item] of items.entries()) {
    const duplicateOf = firstIndexByUrl.get(item.url);
    if (duplicateOf !== undefined) {
      reviewed.push({
        index,
        title: item.title,
        url: item.url,
        state: "selection-duplicate",
        duplicateOf,
      });
      continue;
    }
    firstIndexByUrl.set(item.url, index);

    const duplicate = await duplicateForUrl(db, item.url);
    if (duplicate) {
      reviewed.push({
        index,
        title: item.title,
        url: item.url,
        state: "duplicate",
        duplicateState: duplicate.inbox_at ? "inbox" : "library",
        bookmark: bookmarkFromRow(duplicate),
      });
      continue;
    }

    reviewed.push({ index, title: item.title, url: item.url, state: "new" });
  }

  return json({ items: reviewed });
}

async function captureBatch(request: Request, db: CaptureInboxDbLike) {
  const items = parseCaptureItems(await readBody(request));
  const seen = new Set<string>();
  const results = [] as Array<Record<string, unknown>>;
  let createdCount = 0;
  let duplicateCount = 0;
  let skippedCount = 0;

  for (const [index, item] of items.entries()) {
    if (seen.has(item.url)) {
      skippedCount += 1;
      results.push({ index, title: item.title, url: item.url, result: "selection-duplicate" });
      continue;
    }
    seen.add(item.url);

    const duplicate = await duplicateForUrl(db, item.url);
    if (duplicate) {
      duplicateCount += 1;
      results.push({
        index,
        title: item.title,
        url: item.url,
        result: "duplicate",
        duplicateState: duplicate.inbox_at ? "inbox" : "library",
        bookmark: bookmarkFromRow(duplicate),
      });
      continue;
    }

    const row = await insertCapture(db, item);
    createdCount += 1;
    results.push({ index, title: item.title, url: item.url, result: "created", bookmark: bookmarkFromRow(row) });
  }

  return json({
    result: "batch",
    createdCount,
    duplicateCount,
    skippedCount,
    results,
  }, { status: createdCount ? 201 : 200 });
}

async function listInbox(db: CaptureInboxDbLike) {
  const result = await db.prepare(
    `${BOOKMARK_SELECT} WHERE b.inbox_at IS NOT NULL ORDER BY b.inbox_at DESC, b.created_at DESC`,
  ).all<BookmarkRow>();
  return json({ bookmarks: result.results.map(bookmarkFromRow) });
}

function inboxBookmarkId(pathname: string) {
  const match = pathname.match(/^\/api\/inbox\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function resolveInboxBookmark(request: Request, db: CaptureInboxDbLike, id: string) {
  const existing = await db.prepare(`${BOOKMARK_SELECT} WHERE b.id = ? AND b.inbox_at IS NOT NULL LIMIT 1`)
    .bind(id)
    .first<BookmarkRow>();
  if (!existing) {
    throw new CaptureInboxHttpError(404, "inbox_not_found", "This bookmark is no longer waiting in Inbox.");
  }

  const body = await readBody(request);
  let categoryId = existing.category_id;
  if (Object.prototype.hasOwnProperty.call(body, "categoryId")) {
    const value = body.categoryId;
    if (value !== null && (typeof value !== "string" || !value.trim())) {
      throw new CaptureInboxHttpError(400, "invalid_field", "categoryId must be a string or null.");
    }
    categoryId = typeof value === "string" ? value.trim() : null;
  }

  if (categoryId) {
    const category = await db.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1")
      .bind(categoryId)
      .first<{ id: string }>();
    if (!category) {
      throw new CaptureInboxHttpError(400, "invalid_category", "categoryId does not reference an existing category.");
    }
  }

  const position = categoryId === existing.category_id
    ? existing.position
    : await nextBookmarkPosition(db, categoryId);

  await db.prepare(
    `UPDATE bookmarks
        SET category_id = ?, position = ?, inbox_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND inbox_at IS NOT NULL`,
  )
    .bind(categoryId, position, id)
    .run();

  const row = await db.prepare(`${BOOKMARK_SELECT} WHERE b.id = ? LIMIT 1`)
    .bind(id)
    .first<BookmarkRow>();
  if (!row) throw new CaptureInboxHttpError(500, "write_failed", "Inbox bookmark could not be updated.");
  return json({ bookmark: bookmarkFromRow(row) });
}

export async function handleCaptureInboxApi(
  request: Request,
  db: CaptureInboxDbLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/capture/bookmark") {
    if (request.method !== "POST") {
      throw new CaptureInboxHttpError(405, "method_not_allowed", "Only POST is supported for bookmark capture.");
    }
    return captureBookmark(request, db);
  }

  if (pathname === "/api/capture/review") {
    if (request.method !== "POST") {
      throw new CaptureInboxHttpError(405, "method_not_allowed", "Only POST is supported for capture review.");
    }
    return reviewCaptureBatch(request, db);
  }

  if (pathname === "/api/capture/batch") {
    if (request.method !== "POST") {
      throw new CaptureInboxHttpError(405, "method_not_allowed", "Only POST is supported for reviewed batch capture.");
    }
    return captureBatch(request, db);
  }

  if (pathname === "/api/inbox") {
    if (request.method !== "GET") {
      throw new CaptureInboxHttpError(405, "method_not_allowed", "Only GET is supported for Inbox.");
    }
    return listInbox(db);
  }

  const id = inboxBookmarkId(pathname);
  if (id) {
    if (request.method !== "PATCH") {
      throw new CaptureInboxHttpError(405, "method_not_allowed", "Only PATCH is supported for Inbox bookmarks.");
    }
    return resolveInboxBookmark(request, db, id);
  }

  return null;
}
