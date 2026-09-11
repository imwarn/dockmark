import {
  normalizeSearchKeyword,
  validateSearchTemplate,
  type SearchEngine,
} from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface SearchEngineDbLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface SearchEngineRow {
  id: string;
  name: string;
  keyword: string | null;
  search_url: string;
  is_default: number;
  position: number;
}

export class SearchEngineHttpError extends Error {
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

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new SearchEngineHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SearchEngineHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new SearchEngineHttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new SearchEngineHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function optionalPosition(body: Record<string, unknown>) {
  if (!hasOwn(body, "position")) return undefined;
  const value = body.position;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SearchEngineHttpError(400, "invalid_field", "position must be a non-negative integer.");
  }
  return value;
}

function optionalBoolean(body: Record<string, unknown>, key: string) {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  if (typeof value !== "boolean") {
    throw new SearchEngineHttpError(400, "invalid_field", `${key} must be a boolean.`);
  }
  return value;
}

function optionalKeyword(body: Record<string, unknown>) {
  if (!hasOwn(body, "keyword")) return undefined;
  const value = body.keyword;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new SearchEngineHttpError(400, "invalid_field", "keyword must be a string or null.");
  }
  try {
    return normalizeSearchKeyword(value) ?? null;
  } catch (error) {
    throw new SearchEngineHttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "Invalid search keyword.",
    );
  }
}

function parseTemplate(value: string) {
  try {
    return validateSearchTemplate(value);
  } catch (error) {
    throw new SearchEngineHttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "Invalid search URL.",
    );
  }
}

function engineFromRow(row: SearchEngineRow): SearchEngine {
  return {
    id: row.id,
    name: row.name,
    ...(row.keyword ? { keyword: row.keyword } : {}),
    searchUrl: row.search_url,
    isDefault: Boolean(row.is_default),
    position: row.position,
  };
}

async function getEngineRow(db: SearchEngineDbLike, id: string) {
  return db.prepare(
    "SELECT id, name, keyword, search_url, is_default, position FROM search_engines WHERE id = ?",
  ).bind(id).first<SearchEngineRow>();
}

async function listEngines(db: SearchEngineDbLike) {
  const result = await db.prepare(
    "SELECT id, name, keyword, search_url, is_default, position FROM search_engines ORDER BY position ASC, name COLLATE NOCASE ASC",
  ).all<SearchEngineRow>();
  return result.results.map(engineFromRow);
}

async function nextPosition(db: SearchEngineDbLike) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM search_engines",
  ).first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function assertKeywordAvailable(db: SearchEngineDbLike, keyword: string | null, excludeId?: string) {
  if (!keyword) return;
  const row = excludeId
    ? await db.prepare("SELECT id FROM search_engines WHERE keyword = ? AND id <> ? LIMIT 1")
        .bind(keyword, excludeId)
        .first<{ id: string }>()
    : await db.prepare("SELECT id FROM search_engines WHERE keyword = ? LIMIT 1")
        .bind(keyword)
        .first<{ id: string }>();
  if (row) {
    throw new SearchEngineHttpError(409, "keyword_exists", `The !${keyword} shortcut is already in use.`);
  }
}

async function createEngine(request: Request, db: SearchEngineDbLike) {
  const body = await readBody(request);
  const name = requiredString(body, "name", 80);
  const keyword = optionalKeyword(body) ?? null;
  const searchUrl = parseTemplate(requiredString(body, "searchUrl", 4096));
  const isDefault = optionalBoolean(body, "isDefault") ?? false;
  const position = optionalPosition(body) ?? await nextPosition(db);

  await assertKeywordAvailable(db, keyword);
  if (isDefault) {
    await db.prepare("UPDATE search_engines SET is_default = 0 WHERE is_default = 1").run();
  }

  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO search_engines (id, name, keyword, search_url, is_default, position) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, name, keyword, searchUrl, isDefault ? 1 : 0, position).run();

  const row = await getEngineRow(db, id);
  if (!row) throw new SearchEngineHttpError(500, "write_failed", "Search engine could not be created.");
  return json({ engine: engineFromRow(row) }, { status: 201 });
}

async function updateEngine(request: Request, db: SearchEngineDbLike, id: string) {
  const existing = await getEngineRow(db, id);
  if (!existing) throw new SearchEngineHttpError(404, "search_engine_not_found", "Search engine not found.");
  const body = await readBody(request);

  const name = hasOwn(body, "name") ? requiredString(body, "name", 80) : existing.name;
  const keywordInput = optionalKeyword(body);
  const keyword = keywordInput === undefined ? existing.keyword : keywordInput;
  const searchUrl = hasOwn(body, "searchUrl")
    ? parseTemplate(requiredString(body, "searchUrl", 4096))
    : existing.search_url;
  const isDefaultInput = optionalBoolean(body, "isDefault");
  const position = optionalPosition(body) ?? existing.position;

  if (isDefaultInput === false && existing.is_default) {
    throw new SearchEngineHttpError(
      409,
      "default_required",
      "Choose another default search engine before clearing this one.",
    );
  }

  await assertKeywordAvailable(db, keyword, id);
  const isDefault = isDefaultInput ?? Boolean(existing.is_default);
  if (isDefault && !existing.is_default) {
    await db.prepare("UPDATE search_engines SET is_default = 0 WHERE is_default = 1").run();
  }

  await db.prepare(
    "UPDATE search_engines SET name = ?, keyword = ?, search_url = ?, is_default = ?, position = ? WHERE id = ?",
  ).bind(name, keyword, searchUrl, isDefault ? 1 : 0, position, id).run();

  const row = await getEngineRow(db, id);
  if (!row) throw new SearchEngineHttpError(500, "write_failed", "Search engine could not be updated.");
  return json({ engine: engineFromRow(row) });
}

async function deleteEngine(db: SearchEngineDbLike, id: string) {
  const existing = await getEngineRow(db, id);
  if (!existing) throw new SearchEngineHttpError(404, "search_engine_not_found", "Search engine not found.");

  const count = await db.prepare("SELECT COUNT(*) AS count FROM search_engines").first<{ count: number }>();
  if ((count?.count ?? 0) <= 1) {
    throw new SearchEngineHttpError(409, "last_engine", "Dockmark must keep at least one search engine.");
  }

  if (existing.is_default) {
    await db.prepare("UPDATE search_engines SET is_default = 0 WHERE id = ?").bind(id).run();
    const replacement = await db.prepare(
      "SELECT id FROM search_engines WHERE id <> ? ORDER BY position ASC, name COLLATE NOCASE ASC LIMIT 1",
    ).bind(id).first<{ id: string }>();
    if (replacement) {
      await db.prepare("UPDATE search_engines SET is_default = 1 WHERE id = ?").bind(replacement.id).run();
    }
  }

  await db.prepare("DELETE FROM search_engines WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

function route(pathname: string) {
  if (pathname === "/api/search-engines") return { kind: "collection" as const };
  const match = pathname.match(/^\/api\/search-engines\/([^/]+)$/);
  if (match?.[1]) return { kind: "engine" as const, id: decodeURIComponent(match[1]) };
  return null;
}

export async function handleSearchEngineApi(
  request: Request,
  db: SearchEngineDbLike,
  pathname: string,
): Promise<Response | null> {
  const matched = route(pathname);
  if (!matched) return null;

  if (matched.kind === "collection") {
    if (request.method === "GET") return json({ engines: await listEngines(db) });
    if (request.method === "POST") return createEngine(request, db);
  }

  if (matched.kind === "engine") {
    if (request.method === "GET") {
      const row = await getEngineRow(db, matched.id);
      if (!row) throw new SearchEngineHttpError(404, "search_engine_not_found", "Search engine not found.");
      return json({ engine: engineFromRow(row) });
    }
    if (request.method === "PATCH") return updateEngine(request, db, matched.id);
    if (request.method === "DELETE") return deleteEngine(db, matched.id);
  }

  throw new SearchEngineHttpError(405, "method_not_allowed", "Method not allowed for search engine route.");
}
