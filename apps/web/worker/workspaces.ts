import {
  inferHealthPolicy,
  normalizeBookmarkUrl,
  type HealthPolicy,
  type Workspace,
  type WorkspaceItem,
  type WorkspaceOpenMode,
  type WorkspaceWithItems,
} from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface WorkspaceDbLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface WorkspaceItemRow {
  id: string;
  workspace_id: string;
  bookmark_id: string | null;
  title: string;
  url: string;
  open_mode: WorkspaceOpenMode;
  health_policy: HealthPolicy;
  position: number;
  created_at: string;
  updated_at: string;
}

interface BookmarkSourceRow {
  id: string;
  title: string;
  url: string;
  health_policy: HealthPolicy;
}

export class WorkspaceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const OPEN_MODES = new Set<WorkspaceOpenMode>(["reuse", "new-tab", "pinned"]);
const HEALTH_POLICIES = new Set<HealthPolicy>(["normal", "ignore", "local-only", "manual"]);

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
    throw new WorkspaceHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceHttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new WorkspaceHttpError(400, "invalid_field", `${key} is too long.`);
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
    throw new WorkspaceHttpError(400, "invalid_field", `${key} must be a string or null.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new WorkspaceHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed || null;
}

function optionalPosition(body: Record<string, unknown>): number | undefined {
  if (!hasOwn(body, "position")) return undefined;
  const value = body.position;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new WorkspaceHttpError(400, "invalid_field", "position must be a non-negative integer.");
  }
  return value;
}

function optionalOpenMode(body: Record<string, unknown>): WorkspaceOpenMode | undefined {
  if (!hasOwn(body, "openMode")) return undefined;
  const value = body.openMode;
  if (typeof value !== "string" || !OPEN_MODES.has(value as WorkspaceOpenMode)) {
    throw new WorkspaceHttpError(400, "invalid_field", "openMode must be reuse, new-tab, or pinned.");
  }
  return value as WorkspaceOpenMode;
}

function optionalHealthPolicy(body: Record<string, unknown>): HealthPolicy | undefined {
  if (!hasOwn(body, "healthPolicy")) return undefined;
  const value = body.healthPolicy;
  if (typeof value !== "string" || !HEALTH_POLICIES.has(value as HealthPolicy)) {
    throw new WorkspaceHttpError(
      400,
      "invalid_field",
      "healthPolicy must be normal, ignore, local-only, or manual.",
    );
  }
  return value as HealthPolicy;
}

function parseUrl(raw: string) {
  try {
    return normalizeBookmarkUrl(raw);
  } catch (error) {
    throw new WorkspaceHttpError(
      400,
      "invalid_field",
      error instanceof Error ? error.message : "url must be a valid HTTP or HTTPS URL.",
    );
  }
}

function workspaceFromRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    ...(row.icon ? { icon: row.icon } : {}),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: WorkspaceItemRow): WorkspaceItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ...(row.bookmark_id ? { bookmarkId: row.bookmark_id } : {}),
    title: row.title,
    url: row.url,
    openMode: row.open_mode,
    healthPolicy: row.health_policy,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getWorkspaceRow(db: WorkspaceDbLike, id: string) {
  return db.prepare(
    `SELECT id, name, description, icon, position, created_at, updated_at
       FROM workspaces WHERE id = ?`,
  ).bind(id).first<WorkspaceRow>();
}

async function getItemRow(db: WorkspaceDbLike, workspaceId: string, itemId: string) {
  return db.prepare(
    `SELECT id, workspace_id, bookmark_id, title, url, open_mode, health_policy,
            position, created_at, updated_at
       FROM workspace_items
      WHERE workspace_id = ? AND id = ?`,
  ).bind(workspaceId, itemId).first<WorkspaceItemRow>();
}

async function listItems(db: WorkspaceDbLike, workspaceId: string) {
  const result = await db.prepare(
    `SELECT id, workspace_id, bookmark_id, title, url, open_mode, health_policy,
            position, created_at, updated_at
       FROM workspace_items
      WHERE workspace_id = ?
      ORDER BY position ASC, created_at ASC`,
  ).bind(workspaceId).all<WorkspaceItemRow>();
  return result.results.map(itemFromRow);
}

async function workspaceDetail(db: WorkspaceDbLike, id: string): Promise<WorkspaceWithItems> {
  const row = await getWorkspaceRow(db, id);
  if (!row) throw new WorkspaceHttpError(404, "workspace_not_found", "Workspace not found.");
  return { ...workspaceFromRow(row), items: await listItems(db, id) };
}

async function listWorkspaces(db: WorkspaceDbLike) {
  const workspaceRows = await db.prepare(
    `SELECT id, name, description, icon, position, created_at, updated_at
       FROM workspaces
      ORDER BY position ASC, name COLLATE NOCASE ASC`,
  ).all<WorkspaceRow>();

  const itemRows = await db.prepare(
    `SELECT id, workspace_id, bookmark_id, title, url, open_mode, health_policy,
            position, created_at, updated_at
       FROM workspace_items
      ORDER BY workspace_id ASC, position ASC, created_at ASC`,
  ).all<WorkspaceItemRow>();

  const itemsByWorkspace = new Map<string, WorkspaceItem[]>();
  for (const row of itemRows.results) {
    const list = itemsByWorkspace.get(row.workspace_id) ?? [];
    list.push(itemFromRow(row));
    itemsByWorkspace.set(row.workspace_id, list);
  }

  return workspaceRows.results.map((row): WorkspaceWithItems => ({
    ...workspaceFromRow(row),
    items: itemsByWorkspace.get(row.id) ?? [],
  }));
}

async function nextWorkspacePosition(db: WorkspaceDbLike) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM workspaces",
  ).first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function nextItemPosition(db: WorkspaceDbLike, workspaceId: string) {
  const row = await db.prepare(
    "SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM workspace_items WHERE workspace_id = ?",
  ).bind(workspaceId).first<{ next_position: number }>();
  return row?.next_position ?? 0;
}

async function createWorkspace(request: Request, db: WorkspaceDbLike) {
  const body = await readBody(request);
  const name = requiredString(body, "name", 100);
  const description = nullableString(body, "description", 1000) ?? null;
  const icon = nullableString(body, "icon", 64) ?? null;
  const position = optionalPosition(body) ?? await nextWorkspacePosition(db);
  const id = crypto.randomUUID();

  await db.prepare(
    "INSERT INTO workspaces (id, name, description, icon, position) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, name, description, icon, position).run();

  return json({ workspace: await workspaceDetail(db, id) }, { status: 201 });
}

async function updateWorkspace(request: Request, db: WorkspaceDbLike, id: string) {
  const existing = await getWorkspaceRow(db, id);
  if (!existing) throw new WorkspaceHttpError(404, "workspace_not_found", "Workspace not found.");
  const body = await readBody(request);
  const name = hasOwn(body, "name") ? requiredString(body, "name", 100) : existing.name;
  const descriptionInput = nullableString(body, "description", 1000);
  const iconInput = nullableString(body, "icon", 64);
  const description = descriptionInput === undefined ? existing.description : descriptionInput;
  const icon = iconInput === undefined ? existing.icon : iconInput;
  const position = optionalPosition(body) ?? existing.position;

  await db.prepare(
    `UPDATE workspaces
        SET name = ?, description = ?, icon = ?, position = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  ).bind(name, description, icon, position, id).run();

  return json({ workspace: await workspaceDetail(db, id) });
}

async function deleteWorkspace(db: WorkspaceDbLike, id: string) {
  const existing = await getWorkspaceRow(db, id);
  if (!existing) throw new WorkspaceHttpError(404, "workspace_not_found", "Workspace not found.");
  await db.prepare("DELETE FROM workspaces WHERE id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

async function bookmarkSource(db: WorkspaceDbLike, id: string) {
  return db.prepare(
    "SELECT id, title, url, health_policy FROM bookmarks WHERE id = ?",
  ).bind(id).first<BookmarkSourceRow>();
}

function bookmarkIdFromBody(body: Record<string, unknown>): string | null | undefined {
  if (!hasOwn(body, "bookmarkId")) return undefined;
  const value = body.bookmarkId;
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceHttpError(400, "invalid_field", "bookmarkId must be a string or null.");
  }
  return value.trim();
}

async function createWorkspaceItem(
  request: Request,
  db: WorkspaceDbLike,
  workspaceId: string,
) {
  if (!(await getWorkspaceRow(db, workspaceId))) {
    throw new WorkspaceHttpError(404, "workspace_not_found", "Workspace not found.");
  }

  const body = await readBody(request);
  const bookmarkId = bookmarkIdFromBody(body) ?? null;
  const bookmark = bookmarkId ? await bookmarkSource(db, bookmarkId) : null;
  if (bookmarkId && !bookmark) {
    throw new WorkspaceHttpError(400, "invalid_bookmark", "bookmarkId does not reference an existing bookmark.");
  }

  const title = hasOwn(body, "title")
    ? requiredString(body, "title", 200)
    : bookmark?.title;
  const rawUrl = hasOwn(body, "url")
    ? requiredString(body, "url", 4096)
    : bookmark?.url;
  if (!title || !rawUrl) {
    throw new WorkspaceHttpError(
      400,
      "invalid_field",
      "Custom workspace items require both title and url.",
    );
  }

  const url = parseUrl(rawUrl);
  const openMode = optionalOpenMode(body) ?? "reuse";
  const healthPolicy = optionalHealthPolicy(body) ?? bookmark?.health_policy ?? inferHealthPolicy(url);
  const position = optionalPosition(body) ?? await nextItemPosition(db, workspaceId);
  const id = crypto.randomUUID();

  await db.prepare(
    `INSERT INTO workspace_items
      (id, workspace_id, bookmark_id, title, url, open_mode, health_policy, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, workspaceId, bookmarkId, title, url, openMode, healthPolicy, position).run();

  const row = await getItemRow(db, workspaceId, id);
  if (!row) throw new WorkspaceHttpError(500, "write_failed", "Workspace item could not be created.");
  return json({ item: itemFromRow(row) }, { status: 201 });
}

async function updateWorkspaceItem(
  request: Request,
  db: WorkspaceDbLike,
  workspaceId: string,
  itemId: string,
) {
  const existing = await getItemRow(db, workspaceId, itemId);
  if (!existing) throw new WorkspaceHttpError(404, "workspace_item_not_found", "Workspace item not found.");
  const body = await readBody(request);

  const requestedBookmarkId = bookmarkIdFromBody(body);
  const bookmarkId = requestedBookmarkId === undefined ? existing.bookmark_id : requestedBookmarkId;
  if (bookmarkId && !(await bookmarkSource(db, bookmarkId))) {
    throw new WorkspaceHttpError(400, "invalid_bookmark", "bookmarkId does not reference an existing bookmark.");
  }

  const title = hasOwn(body, "title") ? requiredString(body, "title", 200) : existing.title;
  const urlChanged = hasOwn(body, "url");
  const url = urlChanged ? parseUrl(requiredString(body, "url", 4096)) : existing.url;
  const openMode = optionalOpenMode(body) ?? existing.open_mode;
  const explicitPolicy = optionalHealthPolicy(body);
  const healthPolicy = explicitPolicy ?? (
    urlChanged && (existing.health_policy === "normal" || existing.health_policy === "local-only")
      ? inferHealthPolicy(url)
      : existing.health_policy
  );
  const position = optionalPosition(body) ?? existing.position;

  await db.prepare(
    `UPDATE workspace_items
        SET bookmark_id = ?, title = ?, url = ?, open_mode = ?, health_policy = ?,
            position = ?, updated_at = CURRENT_TIMESTAMP
      WHERE workspace_id = ? AND id = ?`,
  ).bind(
    bookmarkId,
    title,
    url,
    openMode,
    healthPolicy,
    position,
    workspaceId,
    itemId,
  ).run();

  const row = await getItemRow(db, workspaceId, itemId);
  if (!row) throw new WorkspaceHttpError(500, "write_failed", "Workspace item could not be updated.");
  return json({ item: itemFromRow(row) });
}

async function deleteWorkspaceItem(db: WorkspaceDbLike, workspaceId: string, itemId: string) {
  const existing = await getItemRow(db, workspaceId, itemId);
  if (!existing) throw new WorkspaceHttpError(404, "workspace_item_not_found", "Workspace item not found.");
  await db.prepare("DELETE FROM workspace_items WHERE workspace_id = ? AND id = ?")
    .bind(workspaceId, itemId)
    .run();
  return new Response(null, { status: 204 });
}

function workspaceRoute(pathname: string) {
  const itemMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/items\/([^/]+)$/);
  if (itemMatch?.[1] && itemMatch[2]) {
    return {
      kind: "item" as const,
      workspaceId: decodeURIComponent(itemMatch[1]),
      itemId: decodeURIComponent(itemMatch[2]),
    };
  }

  const itemsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/items$/);
  if (itemsMatch?.[1]) {
    return { kind: "items" as const, workspaceId: decodeURIComponent(itemsMatch[1]) };
  }

  const workspaceMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/);
  if (workspaceMatch?.[1]) {
    return { kind: "workspace" as const, workspaceId: decodeURIComponent(workspaceMatch[1]) };
  }

  if (pathname === "/api/workspaces") return { kind: "collection" as const };
  return null;
}

export async function handleWorkspaceApi(
  request: Request,
  db: WorkspaceDbLike,
  pathname: string,
): Promise<Response | null> {
  const route = workspaceRoute(pathname);
  if (!route) return null;

  if (route.kind === "collection") {
    if (request.method === "GET") return json({ workspaces: await listWorkspaces(db) });
    if (request.method === "POST") return createWorkspace(request, db);
  }

  if (route.kind === "workspace") {
    if (request.method === "GET") return json({ workspace: await workspaceDetail(db, route.workspaceId) });
    if (request.method === "PATCH") return updateWorkspace(request, db, route.workspaceId);
    if (request.method === "DELETE") return deleteWorkspace(db, route.workspaceId);
  }

  if (route.kind === "items") {
    if (request.method === "GET") return json({ items: await listItems(db, route.workspaceId) });
    if (request.method === "POST") return createWorkspaceItem(request, db, route.workspaceId);
  }

  if (route.kind === "item") {
    if (request.method === "PATCH") {
      return updateWorkspaceItem(request, db, route.workspaceId, route.itemId);
    }
    if (request.method === "DELETE") {
      return deleteWorkspaceItem(db, route.workspaceId, route.itemId);
    }
  }

  throw new WorkspaceHttpError(405, "method_not_allowed", "Method not allowed for workspace route.");
}
