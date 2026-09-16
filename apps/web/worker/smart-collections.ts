type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface SmartCollectionDatabase {
  prepare(query: string): D1PreparedStatementLike;
}

interface SmartCollectionRow {
  id: string;
  name: string;
  filters_json: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface SmartCollectionFilters {
  categoryId?: string | null;
  tags?: string[];
  domain?: string;
  healthStatus?: string;
  inbox?: "inbox" | "library";
}

export class SmartCollectionHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const HEALTH_STATUSES = new Set([
  "unknown", "healthy", "redirected", "auth-required", "forbidden", "rate-limited",
  "timeout", "dns-error", "tls-error", "unavailable", "local-only", "ignored",
]);

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(request: Request) {
  let value: unknown;
  try { value = await request.json(); } catch {
    throw new SmartCollectionHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SmartCollectionHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function collectionFromRow(row: SmartCollectionRow) {
  let filters: SmartCollectionFilters = {};
  try { filters = JSON.parse(row.filters_json) as SmartCollectionFilters; } catch { filters = {}; }
  return {
    id: row.id,
    name: row.name,
    filters,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function categoryExists(db: SmartCollectionDatabase, id: string) {
  return Boolean(await db.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1").bind(id).first<{ id: string }>());
}

function normalizedDomain(value: string) {
  const trimmed = value.trim().toLocaleLowerCase().replace(/^\.+|\.+$/g, "");
  if (!trimmed) return "";
  try {
    const host = new URL(`https://${trimmed}`).hostname.toLocaleLowerCase();
    if (host !== trimmed) throw new Error("mismatch");
    return host;
  } catch {
    throw new SmartCollectionHttpError(400, "invalid_filters", "domain must be a hostname such as github.com.");
  }
}

async function parseFilters(db: SmartCollectionDatabase, value: unknown): Promise<SmartCollectionFilters> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SmartCollectionHttpError(400, "invalid_filters", "filters must be an object.");
  }
  const source = value as Record<string, unknown>;
  const filters: SmartCollectionFilters = {};

  if (Object.prototype.hasOwnProperty.call(source, "categoryId")) {
    const categoryId = source.categoryId;
    if (categoryId !== null && (typeof categoryId !== "string" || !categoryId.trim())) {
      throw new SmartCollectionHttpError(400, "invalid_filters", "categoryId must be a category id or null.");
    }
    if (typeof categoryId === "string") {
      const id = categoryId.trim();
      if (!(await categoryExists(db, id))) {
        throw new SmartCollectionHttpError(400, "invalid_filters", "categoryId does not reference an existing category.");
      }
      filters.categoryId = id;
    } else {
      filters.categoryId = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, "tags")) {
    if (!Array.isArray(source.tags)) throw new SmartCollectionHttpError(400, "invalid_filters", "tags must be an array.");
    if (source.tags.length > 8) throw new SmartCollectionHttpError(400, "invalid_filters", "A Smart Collection can require at most 8 tags.");
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const raw of source.tags) {
      if (typeof raw !== "string") throw new SmartCollectionHttpError(400, "invalid_filters", "tags must contain only strings.");
      const tag = raw.trim().replace(/\s+/g, " ");
      if (!tag) continue;
      if (tag.length > 40) throw new SmartCollectionHttpError(400, "invalid_filters", "Each tag must be 40 characters or fewer.");
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    if (tags.length) filters.tags = tags;
  }

  if (typeof source.domain === "string" && source.domain.trim()) filters.domain = normalizedDomain(source.domain);
  if (source.healthStatus !== undefined) {
    if (typeof source.healthStatus !== "string" || !HEALTH_STATUSES.has(source.healthStatus)) {
      throw new SmartCollectionHttpError(400, "invalid_filters", "healthStatus is invalid.");
    }
    filters.healthStatus = source.healthStatus;
  }
  if (source.inbox !== undefined) {
    if (source.inbox !== "inbox" && source.inbox !== "library") {
      throw new SmartCollectionHttpError(400, "invalid_filters", "inbox must be inbox or library.");
    }
    filters.inbox = source.inbox;
  }
  return filters;
}

async function nextPosition(db: SmartCollectionDatabase) {
  const row = await db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM smart_collections").first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function getRow(db: SmartCollectionDatabase, id: string) {
  return db.prepare("SELECT id, name, filters_json, position, created_at, updated_at FROM smart_collections WHERE id = ?")
    .bind(id).first<SmartCollectionRow>();
}

async function list(db: SmartCollectionDatabase) {
  const result = await db.prepare("SELECT id, name, filters_json, position, created_at, updated_at FROM smart_collections ORDER BY position ASC, name COLLATE NOCASE ASC").all<SmartCollectionRow>();
  return json({ collections: result.results.map(collectionFromRow) });
}

async function create(request: Request, db: SmartCollectionDatabase) {
  const body = await readBody(request);
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) {
    throw new SmartCollectionHttpError(400, "invalid_name", "name must be 1-80 characters.");
  }
  const name = body.name.trim();
  const filters = await parseFilters(db, body.filters ?? {});
  const duplicate = await db.prepare("SELECT id FROM smart_collections WHERE lower(name) = lower(?) LIMIT 1").bind(name).first<{ id: string }>();
  if (duplicate) throw new SmartCollectionHttpError(409, "collection_exists", "A Smart Collection with this name already exists.");
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO smart_collections (id, name, filters_json, position) VALUES (?, ?, ?, ?)")
    .bind(id, name, JSON.stringify(filters), await nextPosition(db)).run();
  const row = await getRow(db, id);
  if (!row) throw new SmartCollectionHttpError(500, "write_failed", "Smart Collection could not be created.");
  return json({ collection: collectionFromRow(row) }, { status: 201 });
}

async function update(request: Request, db: SmartCollectionDatabase, id: string) {
  const existing = await getRow(db, id);
  if (!existing) throw new SmartCollectionHttpError(404, "collection_not_found", "Smart Collection not found.");
  const body = await readBody(request);
  const name = body.name === undefined ? existing.name : typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) throw new SmartCollectionHttpError(400, "invalid_name", "name must be 1-80 characters.");
  const filters = body.filters === undefined ? collectionFromRow(existing).filters : await parseFilters(db, body.filters);
  const duplicate = await db.prepare("SELECT id FROM smart_collections WHERE lower(name) = lower(?) AND id <> ? LIMIT 1").bind(name, id).first<{ id: string }>();
  if (duplicate) throw new SmartCollectionHttpError(409, "collection_exists", "A Smart Collection with this name already exists.");
  await db.prepare("UPDATE smart_collections SET name = ?, filters_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(name, JSON.stringify(filters), id).run();
  const row = await getRow(db, id);
  if (!row) throw new SmartCollectionHttpError(500, "write_failed", "Smart Collection could not be updated.");
  return json({ collection: collectionFromRow(row) });
}

export async function handleSmartCollectionApi(request: Request, db: SmartCollectionDatabase, pathname: string): Promise<Response | null> {
  if (pathname === "/api/smart-collections") {
    if (request.method === "GET") return list(db);
    if (request.method === "POST") return create(request, db);
    throw new SmartCollectionHttpError(405, "method_not_allowed", "Only GET and POST are supported for Smart Collections.");
  }
  const match = pathname.match(/^\/api\/smart-collections\/([^/]+)$/);
  if (!match?.[1]) return null;
  const id = decodeURIComponent(match[1]);
  if (request.method === "PATCH") return update(request, db, id);
  if (request.method === "DELETE") {
    const existing = await getRow(db, id);
    if (!existing) throw new SmartCollectionHttpError(404, "collection_not_found", "Smart Collection not found.");
    await db.prepare("DELETE FROM smart_collections WHERE id = ?").bind(id).run();
    return new Response(null, { status: 204 });
  }
  throw new SmartCollectionHttpError(405, "method_not_allowed", "Method not allowed for Smart Collection.");
}
