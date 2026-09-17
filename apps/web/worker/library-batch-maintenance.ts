import type { HealthPolicy } from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface D1BatchDatabaseLike extends D1DatabaseLike {
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

interface BookmarkRow {
  id: string;
  archived_at: string | null;
}

export class LibraryBatchMaintenanceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BOOKMARKS = 50;
const HEALTH_POLICIES = new Set<HealthPolicy>(["normal", "ignore", "local-only", "manual"]);
const ACTIONS = new Set(["set-health-policy", "archive", "restore", "delete"]);
const ALLOWED_FIELDS = new Set(["bookmarkIds", "action", "healthPolicy", "confirmation"]);

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
    throw new LibraryBatchMaintenanceHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryBatchMaintenanceHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function normalizeBookmarkIds(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    throw new LibraryBatchMaintenanceHttpError(400, "invalid_bookmarks", "Select at least one bookmark to maintain.");
  }
  if (value.length > MAX_BOOKMARKS) {
    throw new LibraryBatchMaintenanceHttpError(400, "too_many_bookmarks", `Bulk maintenance is limited to ${MAX_BOOKMARKS} bookmarks per review.`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new LibraryBatchMaintenanceHttpError(400, "invalid_bookmarks", "bookmarkIds must contain only non-empty strings.");
    }
    const id = entry.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function healthStatusForPolicy(policy: HealthPolicy) {
  if (policy === "ignore") return "ignored";
  if (policy === "local-only") return "local-only";
  return "unknown";
}

async function applyBatch(request: Request, db: D1DatabaseLike) {
  const body = await readBody(request);
  for (const field of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new LibraryBatchMaintenanceHttpError(400, "unsupported_field", `Unsupported bulk maintenance field “${field}”.`);
    }
  }

  const bookmarkIds = normalizeBookmarkIds(body.bookmarkIds);
  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    throw new LibraryBatchMaintenanceHttpError(400, "invalid_action", "action must be set-health-policy, archive, restore, or delete.");
  }

  let healthPolicy: HealthPolicy | undefined;
  if (action === "set-health-policy") {
    if (typeof body.healthPolicy !== "string" || !HEALTH_POLICIES.has(body.healthPolicy as HealthPolicy)) {
      throw new LibraryBatchMaintenanceHttpError(400, "invalid_health_policy", "healthPolicy must be normal, ignore, local-only, or manual.");
    }
    healthPolicy = body.healthPolicy as HealthPolicy;
  } else if (Object.prototype.hasOwnProperty.call(body, "healthPolicy")) {
    throw new LibraryBatchMaintenanceHttpError(400, "unsupported_field", "healthPolicy is only valid for set-health-policy.");
  }

  if (action === "delete" && body.confirmation !== "DELETE") {
    throw new LibraryBatchMaintenanceHttpError(400, "delete_confirmation_required", "Permanent delete requires the exact confirmation word DELETE.");
  }

  const placeholders = bookmarkIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT id, archived_at FROM bookmarks WHERE id IN (${placeholders})`,
  ).bind(...bookmarkIds).all<BookmarkRow>();
  const rowById = new Map(rows.results.map((row) => [row.id, row]));
  if (rowById.size !== bookmarkIds.length) {
    throw new LibraryBatchMaintenanceHttpError(409, "bookmark_changed", "One or more selected bookmarks no longer exist. Refresh and review again.");
  }

  const archived = bookmarkIds.filter((id) => Boolean(rowById.get(id)?.archived_at));
  if ((action === "set-health-policy" || action === "archive") && archived.length) {
    throw new LibraryBatchMaintenanceHttpError(409, "bookmark_state_changed", "Archived bookmarks cannot be changed from the active maintenance flow. Refresh and review again.");
  }
  if ((action === "restore" || action === "delete") && archived.length !== bookmarkIds.length) {
    throw new LibraryBatchMaintenanceHttpError(409, "bookmark_state_changed", "Restore and permanent delete apply only to archived bookmarks. Refresh and review again.");
  }

  const statements: D1PreparedStatementLike[] = [];
  if (action === "set-health-policy" && healthPolicy) {
    const status = healthStatusForPolicy(healthPolicy);
    for (const id of bookmarkIds) {
      statements.push(
        db.prepare("UPDATE bookmarks SET health_policy = ?, health_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL")
          .bind(healthPolicy, status, id),
      );
    }
  } else if (action === "archive") {
    for (const id of bookmarkIds) {
      statements.push(db.prepare("DELETE FROM public_bookmarks WHERE bookmark_id = ?").bind(id));
      statements.push(
        db.prepare("UPDATE bookmarks SET archived_at = CURRENT_TIMESTAMP, inbox_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL")
          .bind(id),
      );
    }
  } else if (action === "restore") {
    for (const id of bookmarkIds) {
      statements.push(
        db.prepare("UPDATE bookmarks SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NOT NULL")
          .bind(id),
      );
    }
  } else if (action === "delete") {
    for (const id of bookmarkIds) {
      statements.push(db.prepare("DELETE FROM bookmarks WHERE id = ? AND archived_at IS NOT NULL").bind(id));
    }
    statements.push(db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)"));
  }

  const batchDb = db as D1BatchDatabaseLike;
  if (typeof batchDb.batch !== "function") {
    throw new LibraryBatchMaintenanceHttpError(500, "batch_unavailable", "D1 batch execution is unavailable in this runtime.");
  }
  await batchDb.batch(statements);

  return json({ applied: bookmarkIds.length, bookmarkIds, action, ...(healthPolicy ? { healthPolicy } : {}) });
}

export async function handleLibraryBatchMaintenanceApi(
  request: Request,
  db: D1DatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/bookmarks/batch-maintenance") return null;
  if (request.method !== "POST") {
    throw new LibraryBatchMaintenanceHttpError(405, "method_not_allowed", "Method not allowed for reviewed Library batch maintenance.");
  }
  return applyBatch(request, db);
}
