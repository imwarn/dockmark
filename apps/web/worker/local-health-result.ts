import type { HealthCheck, HealthStatus } from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface LocalHealthDatabase {
  prepare(query: string): D1PreparedStatementLike;
}

interface BookmarkPolicyRow {
  id: string;
  health_policy: string;
}

export class LocalHealthHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ALLOWED_STATUSES = new Set<HealthStatus>([
  "healthy",
  "redirected",
  "auth-required",
  "forbidden",
  "rate-limited",
  "timeout",
  "dns-error",
  "tls-error",
  "unavailable",
]);

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new LocalHealthHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalHealthHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function optionalInteger(body: Record<string, unknown>, key: string, min: number, max: number) {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new LocalHealthHttpError(400, "invalid_field", `${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new LocalHealthHttpError(400, "invalid_field", `${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new LocalHealthHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed || null;
}

function optionalHttpUrl(body: Record<string, unknown>, key: string) {
  const value = optionalString(body, key, 4096);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
    return parsed.toString();
  } catch {
    throw new LocalHealthHttpError(400, "invalid_field", `${key} must be an HTTP or HTTPS URL.`);
  }
}

export async function handleLocalHealthResultApi(
  request: Request,
  db: LocalHealthDatabase,
  pathname: string,
): Promise<Response | null> {
  const match = pathname.match(/^\/api\/bookmarks\/([^/]+)\/health\/local-result$/);
  if (!match?.[1]) return null;
  if (request.method !== "POST") {
    throw new LocalHealthHttpError(405, "method_not_allowed", "Only POST is supported for local health results.");
  }

  const bookmarkId = decodeURIComponent(match[1]);
  const bookmark = await db.prepare("SELECT id, health_policy FROM bookmarks WHERE id = ? LIMIT 1")
    .bind(bookmarkId)
    .first<BookmarkPolicyRow>();
  if (!bookmark) throw new LocalHealthHttpError(404, "bookmark_not_found", "Bookmark not found.");
  if (bookmark.health_policy !== "local-only") {
    throw new LocalHealthHttpError(409, "local_health_policy_required", "Extension local health results are accepted only for local-only bookmarks.");
  }

  const body = await readBody(request);
  const statusValue = body.status;
  if (typeof statusValue !== "string" || !ALLOWED_STATUSES.has(statusValue as HealthStatus)) {
    throw new LocalHealthHttpError(400, "invalid_field", "status is not a supported extension health result.");
  }
  const status = statusValue as HealthStatus;
  const httpStatus = optionalInteger(body, "httpStatus", 100, 599);
  const responseMs = optionalInteger(body, "responseMs", 0, 120_000);
  const finalUrl = optionalHttpUrl(body, "finalUrl");
  const errorCode = optionalString(body, "errorCode", 120);
  const id = crypto.randomUUID();
  const checkedAt = new Date().toISOString();

  await db.prepare(
    `INSERT INTO health_checks
      (id, bookmark_id, status, http_status, final_url, response_ms, error_code, source, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'extension', ?)`,
  )
    .bind(id, bookmarkId, status, httpStatus, finalUrl, responseMs, errorCode, checkedAt)
    .run();

  await db.prepare("UPDATE bookmarks SET health_status = ? WHERE id = ?")
    .bind(status, bookmarkId)
    .run();

  const check: HealthCheck = {
    id,
    bookmarkId,
    status,
    ...(httpStatus == null ? {} : { httpStatus }),
    ...(finalUrl ? { finalUrl } : {}),
    ...(responseMs == null ? {} : { responseMs }),
    ...(errorCode ? { errorCode } : {}),
    source: "extension",
    checkedAt,
  };
  return json({ check });
}
