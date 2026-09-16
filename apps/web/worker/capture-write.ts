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
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
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

interface PendingCapture extends CaptureInput {
  index: number;
  id: string;
  healthPolicy: HealthPolicy;
  healthStatus: HealthStatus;
  position: number;
}

export class CaptureWriteHttpError extends Error {
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
    throw new CaptureWriteHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CaptureWriteHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new CaptureWriteHttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new CaptureWriteHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function parseUrl(raw: string) {
  try {
    return normalizeBookmarkUrl(raw);
  } catch (error) {
    throw new CaptureWriteHttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "url must be a valid HTTP or HTTPS URL.",
    );
  }
}

function parseItem(value: unknown, index?: number): CaptureInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CaptureWriteHttpError(
      400,
      "invalid_field",
      index === undefined ? "Capture input must be an object." : `items[${index}] must be an object.`,
    );
  }
  const row = value as Record<string, unknown>;
  return {
    title: requiredString(row, "title", 200),
    url: parseUrl(requiredString(row, "url", 4096)),
  };
}

function parseItems(body: Record<string, unknown>) {
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw new CaptureWriteHttpError(400, "invalid_field", "items must be a non-empty array.");
  }
  if (rawItems.length > 100) {
    throw new CaptureWriteHttpError(400, "invalid_field", "A reviewed capture can contain at most 100 tabs.");
  }
  return rawItems.map((item, index) => parseItem(item, index));
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

async function duplicateForUrl(db: D1DatabaseLike, url: string) {
  return db.prepare(`${BOOKMARK_SELECT} WHERE b.url = ? LIMIT 1`)
    .bind(url)
    .first<BookmarkRow>();
}

async function nextInboxPosition(db: D1DatabaseLike) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM bookmarks WHERE category_id IS NULL",
  ).first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

function isBookmarkUrlUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLocaleLowerCase();
  return normalized.includes("unique") && normalized.includes("bookmarks.url");
}

function insertStatement(db: D1DatabaseLike, item: PendingCapture) {
  return db.prepare(
    `INSERT INTO bookmarks
      (id, category_id, title, url, description, icon_url, health_policy, health_status, position, inbox_at)
     VALUES (?, NULL, ?, ?, NULL, NULL, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).bind(item.id, item.title, item.url, item.healthPolicy, item.healthStatus, item.position);
}

async function rowsForIds(db: D1DatabaseLike, ids: string[]) {
  if (!ids.length) return new Map<string, BookmarkRow>();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db.prepare(`${BOOKMARK_SELECT} WHERE b.id IN (${placeholders})`)
    .bind(...ids)
    .all<BookmarkRow>();
  return new Map(rows.results.map((row) => [row.id, row]));
}

async function captureOne(request: Request, db: D1DatabaseLike) {
  const input = parseItem(await readBody(request));
  const duplicate = await duplicateForUrl(db, input.url);
  if (duplicate) {
    return json({
      result: "duplicate",
      bookmark: bookmarkFromRow(duplicate),
      duplicateState: duplicate.inbox_at ? "inbox" : "library",
    });
  }

  const position = await nextInboxPosition(db);
  const healthPolicy = inferHealthPolicy(input.url);
  const pending: PendingCapture = {
    ...input,
    index: 0,
    id: crypto.randomUUID(),
    healthPolicy,
    healthStatus: statusForPolicy(healthPolicy),
    position,
  };

  try {
    await db.batch([insertStatement(db, pending)]);
  } catch (error) {
    if (isBookmarkUrlUniqueViolation(error)) {
      const racedDuplicate = await duplicateForUrl(db, input.url);
      if (racedDuplicate) {
        return json({
          result: "duplicate",
          bookmark: bookmarkFromRow(racedDuplicate),
          duplicateState: racedDuplicate.inbox_at ? "inbox" : "library",
        });
      }
      throw new CaptureWriteHttpError(409, "capture_conflict", "This URL was captured concurrently. Refresh and review again.");
    }
    throw error;
  }

  const row = (await rowsForIds(db, [pending.id])).get(pending.id);
  if (!row) throw new CaptureWriteHttpError(500, "write_failed", "Captured bookmark could not be created.");
  return json({ result: "created", bookmark: bookmarkFromRow(row) }, { status: 201 });
}

async function existingByUrls(db: D1DatabaseLike, urls: string[]) {
  if (!urls.length) return new Map<string, BookmarkRow>();
  const placeholders = urls.map(() => "?").join(", ");
  const rows = await db.prepare(`${BOOKMARK_SELECT} WHERE b.url IN (${placeholders})`)
    .bind(...urls)
    .all<BookmarkRow>();
  return new Map(rows.results.map((row) => [row.url, row]));
}

async function preparePending(
  db: D1DatabaseLike,
  items: CaptureInput[],
  results: Array<Record<string, unknown> | undefined>,
  seen: Set<string>,
) {
  const uniqueCandidates: Array<{ index: number; item: CaptureInput }> = [];
  for (const [index, item] of items.entries()) {
    if (seen.has(item.url)) {
      results[index] = { index, title: item.title, url: item.url, result: "selection-duplicate" };
      continue;
    }
    seen.add(item.url);
    uniqueCandidates.push({ index, item });
  }

  const existing = await existingByUrls(db, uniqueCandidates.map(({ item }) => item.url));
  const startPosition = await nextInboxPosition(db);
  let createdOffset = 0;
  const pending: PendingCapture[] = [];

  for (const { index, item } of uniqueCandidates) {
    const duplicate = existing.get(item.url);
    if (duplicate) {
      results[index] = {
        index,
        title: item.title,
        url: item.url,
        result: "duplicate",
        duplicateState: duplicate.inbox_at ? "inbox" : "library",
        bookmark: bookmarkFromRow(duplicate),
      };
      continue;
    }
    const healthPolicy = inferHealthPolicy(item.url);
    pending.push({
      ...item,
      index,
      id: crypto.randomUUID(),
      healthPolicy,
      healthStatus: statusForPolicy(healthPolicy),
      position: startPosition + createdOffset,
    });
    createdOffset += 1;
  }
  return pending;
}

async function commitPending(db: D1DatabaseLike, pending: PendingCapture[]) {
  if (!pending.length) return pending;
  await db.batch(pending.map((item) => insertStatement(db, item)));
  return pending;
}

async function captureBatch(request: Request, db: D1DatabaseLike) {
  const items = parseItems(await readBody(request));
  const results: Array<Record<string, unknown> | undefined> = new Array(items.length);
  const seen = new Set<string>();
  let pending = await preparePending(db, items, results, seen);

  if (pending.length) {
    try {
      await commitPending(db, pending);
    } catch (error) {
      if (!isBookmarkUrlUniqueViolation(error)) throw error;

      // D1 batch is transactional, so a uniqueness race rolls the whole insert batch back.
      // Re-read the raced URLs once, classify the newly-existing rows as duplicates, then
      // retry only the still-new items in one fresh batch.
      const raced = await existingByUrls(db, pending.map((item) => item.url));
      const retry: PendingCapture[] = [];
      let nextPosition = await nextInboxPosition(db);
      for (const item of pending) {
        const duplicate = raced.get(item.url);
        if (duplicate) {
          results[item.index] = {
            index: item.index,
            title: item.title,
            url: item.url,
            result: "duplicate",
            duplicateState: duplicate.inbox_at ? "inbox" : "library",
            bookmark: bookmarkFromRow(duplicate),
          };
        } else {
          retry.push({ ...item, position: nextPosition++ });
        }
      }
      pending = retry;
      if (pending.length) {
        try {
          await commitPending(db, pending);
        } catch (retryError) {
          if (isBookmarkUrlUniqueViolation(retryError)) {
            throw new CaptureWriteHttpError(
              409,
              "capture_conflict",
              "One or more tabs were captured concurrently. No partial batch was committed; review the selection again.",
            );
          }
          throw retryError;
        }
      }
    }
  }

  const createdRows = await rowsForIds(db, pending.map((item) => item.id));
  for (const item of pending) {
    const row = createdRows.get(item.id);
    if (!row) throw new CaptureWriteHttpError(500, "write_failed", "A reviewed capture could not be loaded after the batch commit.");
    results[item.index] = {
      index: item.index,
      title: item.title,
      url: item.url,
      result: "created",
      bookmark: bookmarkFromRow(row),
    };
  }

  const finalResults = results.map((result, index) => result ?? {
    index,
    title: items[index]?.title ?? "",
    url: items[index]?.url ?? "",
    result: "skipped",
  });
  const createdCount = finalResults.filter((result) => result.result === "created").length;
  const duplicateCount = finalResults.filter((result) => result.result === "duplicate").length;
  const skippedCount = finalResults.filter((result) => result.result === "selection-duplicate" || result.result === "skipped").length;

  return json({
    result: "batch",
    createdCount,
    duplicateCount,
    skippedCount,
    results: finalResults,
  }, { status: createdCount ? 201 : 200 });
}

export async function handleCaptureWriteApi(
  request: Request,
  db: D1DatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/capture/bookmark") {
    if (request.method !== "POST") {
      throw new CaptureWriteHttpError(405, "method_not_allowed", "Only POST is supported for bookmark capture.");
    }
    return captureOne(request, db);
  }
  if (pathname === "/api/capture/batch") {
    if (request.method !== "POST") {
      throw new CaptureWriteHttpError(405, "method_not_allowed", "Only POST is supported for reviewed batch capture.");
    }
    return captureBatch(request, db);
  }
  return null;
}
