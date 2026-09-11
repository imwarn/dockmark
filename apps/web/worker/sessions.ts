import {
  normalizeBookmarkUrl,
  type Session,
  type SessionItem,
  type SessionWithItems,
} from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface SessionDbLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface SessionRow {
  id: string;
  name: string;
  source_device: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionItemRow {
  id: string;
  session_id: string;
  title: string;
  url: string;
  pinned: number;
  position: number;
}

interface ParsedSessionItem {
  title: string;
  url: string;
  pinned: boolean;
  position?: number;
}

export class SessionHttpError extends Error {
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
    throw new SessionHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new SessionHttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new SessionHttpError(400, "invalid_field", `${key} is too long.`);
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
    throw new SessionHttpError(400, "invalid_field", `${key} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new SessionHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed || null;
}

function optionalPosition(body: Record<string, unknown>): number | undefined {
  if (!hasOwn(body, "position")) return undefined;
  const value = body.position;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SessionHttpError(400, "invalid_field", "position must be a non-negative integer.");
  }
  return value;
}

function optionalPinned(body: Record<string, unknown>): boolean | undefined {
  if (!hasOwn(body, "pinned")) return undefined;
  if (typeof body.pinned !== "boolean") {
    throw new SessionHttpError(400, "invalid_field", "pinned must be a boolean.");
  }
  return body.pinned;
}

function parseUrl(raw: string) {
  try {
    return normalizeBookmarkUrl(raw);
  } catch (error) {
    throw new SessionHttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "url must be a valid HTTP or HTTPS URL.",
    );
  }
}

function sessionFromRow(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    ...(row.source_device ? { sourceDevice: row.source_device } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: SessionItemRow): SessionItem {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    url: row.url,
    pinned: Boolean(row.pinned),
    position: row.position,
  };
}

async function getSessionRow(db: SessionDbLike, id: string) {
  return db.prepare(
    `SELECT id, name, source_device, created_at, updated_at
       FROM sessions WHERE id = ?`,
  ).bind(id).first<SessionRow>();
}

async function getItemRow(db: SessionDbLike, sessionId: string, itemId: string) {
  return db.prepare(
    `SELECT id, session_id, title, url, pinned, position
       FROM session_items
      WHERE session_id = ? AND id = ?`,
  ).bind(sessionId, itemId).first<SessionItemRow>();
}

async function listItems(db: SessionDbLike, sessionId: string) {
  const result = await db.prepare(
    `SELECT id, session_id, title, url, pinned, position
       FROM session_items
      WHERE session_id = ?
      ORDER BY position ASC, rowid ASC`,
  ).bind(sessionId).all<SessionItemRow>();
  return result.results.map(itemFromRow);
}

async function sessionDetail(db: SessionDbLike, id: string): Promise<SessionWithItems> {
  const row = await getSessionRow(db, id);
  if (!row) throw new SessionHttpError(404, "session_not_found", "Session not found.");
  return { ...sessionFromRow(row), items: await listItems(db, id) };
}

async function listSessions(db: SessionDbLike) {
  const sessionRows = await db.prepare(
    `SELECT id, name, source_device, created_at, updated_at
       FROM sessions
      ORDER BY created_at DESC, id DESC`,
  ).all<SessionRow>();

  const itemRows = await db.prepare(
    `SELECT id, session_id, title, url, pinned, position
       FROM session_items
      ORDER BY session_id ASC, position ASC, rowid ASC`,
  ).all<SessionItemRow>();

  const itemsBySession = new Map<string, SessionItem[]>();
  for (const row of itemRows.results) {
    const list = itemsBySession.get(row.session_id) ?? [];
    list.push(itemFromRow(row));
    itemsBySession.set(row.session_id, list);
  }

  return sessionRows.results.map((row): SessionWithItems => ({
    ...sessionFromRow(row),
    items: itemsBySession.get(row.id) ?? [],
  }));
}

function parseSessionItem(value: unknown, index: number): ParsedSessionItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionHttpError(400, "invalid_item", `items[${index}] must be an object.`);
  }
  const body = value as Record<string, unknown>;
  const title = requiredString(body, "title", 200);
  const url = parseUrl(requiredString(body, "url", 4096));
  const pinned = optionalPinned(body) ?? false;
  const position = optionalPosition(body);
  return { title, url, pinned, ...(position !== undefined ? { position } : {}) };
}

function parseBulkItems(body: Record<string, unknown>) {
  if (!hasOwn(body, "items")) return [] as ParsedSessionItem[];
  if (!Array.isArray(body.items)) {
    throw new SessionHttpError(400, "invalid_field", "items must be an array.");
  }
  if (body.items.length > 300) {
    throw new SessionHttpError(400, "too_many_items", "A session can contain at most 300 tabs.");
  }
  return body.items.map(parseSessionItem);
}

async function createItemRow(
  db: SessionDbLike,
  sessionId: string,
  item: ParsedSessionItem,
  fallbackPosition: number,
) {
  const id = crypto.randomUUID();
  const position = item.position ?? fallbackPosition;
  await db.prepare(
    `INSERT INTO session_items (id, session_id, title, url, pinned, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, sessionId, item.title, item.url, item.pinned ? 1 : 0, position).run();
  return id;
}

async function createSession(request: Request, db: SessionDbLike) {
  const body = await readBody(request);
  const name = requiredString(body, "name", 120);
  const sourceDevice = nullableString(body, "sourceDevice", 160) ?? null;
  const items = parseBulkItems(body);
  const id = crypto.randomUUID();

  await db.prepare(
    "INSERT INTO sessions (id, name, source_device) VALUES (?, ?, ?)",
  ).bind(id, name, sourceDevice).run();

  try {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item) await createItemRow(db, id, item, index);
    }
  } catch (error) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    throw error;
  }

  return json({ session: await sessionDetail(db, id) }, { status: 201 });
}

async function updateSession(request: Request, db: SessionDbLike, id: string) {
  const existing = await getSessionRow(db, id);
  if (!existing) throw new SessionHttpError(404, "session_not_found", "Session not found.");
  const body = await readBody(request);
  const name = hasOwn(body, "name") ? requiredString(body, "name", 120) : existing.name;
  const sourceInput = nullableString(body, "sourceDevice", 160);
  const sourceDevice = sourceInput === undefined ? existing.source_device : sourceInput;

  await db.prepare(
    `UPDATE sessions
        SET name = ?, source_device = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  ).bind(name, sourceDevice, id).run();

  return json({ session: await sessionDetail(db, id) });
}

async function deleteSession(db: SessionDbLike, id: string) {
  const existing = await getSessionRow(db, id);
  if (!existing) throw new SessionHttpError(404, "session_not_found", "Session not found.");
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

async function nextItemPosition(db: SessionDbLike, sessionId: string) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM session_items WHERE session_id = ?",
  ).bind(sessionId).first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function createSessionItem(request: Request, db: SessionDbLike, sessionId: string) {
  if (!(await getSessionRow(db, sessionId))) {
    throw new SessionHttpError(404, "session_not_found", "Session not found.");
  }
  const body = await readBody(request);
  const item = parseSessionItem(body, 0);
  const id = await createItemRow(db, sessionId, item, await nextItemPosition(db, sessionId));
  const row = await getItemRow(db, sessionId, id);
  if (!row) throw new SessionHttpError(500, "write_failed", "Session item could not be created.");
  return json({ item: itemFromRow(row) }, { status: 201 });
}

async function updateSessionItem(
  request: Request,
  db: SessionDbLike,
  sessionId: string,
  itemId: string,
) {
  const existing = await getItemRow(db, sessionId, itemId);
  if (!existing) throw new SessionHttpError(404, "session_item_not_found", "Session item not found.");
  const body = await readBody(request);
  const title = hasOwn(body, "title") ? requiredString(body, "title", 200) : existing.title;
  const url = hasOwn(body, "url") ? parseUrl(requiredString(body, "url", 4096)) : existing.url;
  const pinned = optionalPinned(body) ?? Boolean(existing.pinned);
  const position = optionalPosition(body) ?? existing.position;

  await db.prepare(
    `UPDATE session_items
        SET title = ?, url = ?, pinned = ?, position = ?
      WHERE session_id = ? AND id = ?`,
  ).bind(title, url, pinned ? 1 : 0, position, sessionId, itemId).run();

  const row = await getItemRow(db, sessionId, itemId);
  if (!row) throw new SessionHttpError(500, "write_failed", "Session item could not be updated.");
  return json({ item: itemFromRow(row) });
}

async function deleteSessionItem(db: SessionDbLike, sessionId: string, itemId: string) {
  const existing = await getItemRow(db, sessionId, itemId);
  if (!existing) throw new SessionHttpError(404, "session_item_not_found", "Session item not found.");
  await db.prepare("DELETE FROM session_items WHERE session_id = ? AND id = ?")
    .bind(sessionId, itemId)
    .run();
  return new Response(null, { status: 204 });
}

function sessionRoute(pathname: string) {
  const itemMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/items\/([^/]+)$/);
  if (itemMatch?.[1] && itemMatch[2]) {
    return {
      kind: "item" as const,
      sessionId: decodeURIComponent(itemMatch[1]),
      itemId: decodeURIComponent(itemMatch[2]),
    };
  }

  const itemsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/items$/);
  if (itemsMatch?.[1]) {
    return { kind: "items" as const, sessionId: decodeURIComponent(itemsMatch[1]) };
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch?.[1]) {
    return { kind: "session" as const, sessionId: decodeURIComponent(sessionMatch[1]) };
  }

  if (pathname === "/api/sessions") return { kind: "collection" as const };
  return null;
}

export async function handleSessionApi(
  request: Request,
  db: SessionDbLike,
  pathname: string,
): Promise<Response | null> {
  const route = sessionRoute(pathname);
  if (!route) return null;

  if (route.kind === "collection") {
    if (request.method === "GET") return json({ sessions: await listSessions(db) });
    if (request.method === "POST") return createSession(request, db);
  }

  if (route.kind === "session") {
    if (request.method === "GET") return json({ session: await sessionDetail(db, route.sessionId) });
    if (request.method === "PATCH") return updateSession(request, db, route.sessionId);
    if (request.method === "DELETE") return deleteSession(db, route.sessionId);
  }

  if (route.kind === "items") {
    if (request.method === "GET") return json({ items: await listItems(db, route.sessionId) });
    if (request.method === "POST") return createSessionItem(request, db, route.sessionId);
  }

  if (route.kind === "item") {
    if (request.method === "PATCH") {
      return updateSessionItem(request, db, route.sessionId, route.itemId);
    }
    if (request.method === "DELETE") {
      return deleteSessionItem(db, route.sessionId, route.itemId);
    }
  }

  throw new SessionHttpError(405, "method_not_allowed", "Method not allowed for session route.");
}
