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

export class ReorderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ReorderHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReorderHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function parseIds(body: Record<string, unknown>) {
  if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new ReorderHttpError(400, "invalid_field", "ids must be an array of non-empty strings.");
  }
  const ids = body.ids.map((id) => (id as string).trim());
  if (new Set(ids).size !== ids.length) {
    throw new ReorderHttpError(400, "invalid_field", "ids must not contain duplicates.");
  }
  return ids;
}

function parseCategoryId(body: Record<string, unknown>) {
  if (!("categoryId" in body)) {
    throw new ReorderHttpError(400, "invalid_field", "categoryId is required.");
  }
  const value = body.categoryId;
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new ReorderHttpError(400, "invalid_field", "categoryId must be a non-empty string or null.");
  }
  return value.trim();
}

function sameMembers(actual: string[], requested: string[]) {
  if (actual.length !== requested.length) return false;
  const actualSet = new Set(actual);
  return requested.every((id) => actualSet.has(id));
}

async function applyPositions(db: D1DatabaseLike, table: "categories" | "bookmarks", ids: string[]) {
  if (!ids.length) return;
  const cases = ids.map(() => "WHEN ? THEN ?").join(" ");
  const placeholders = ids.map(() => "?").join(", ");
  const bindings: BindValue[] = [];
  ids.forEach((id, position) => bindings.push(id, position));
  bindings.push(...ids);
  await db.prepare(
    `UPDATE ${table} SET position = CASE id ${cases} END, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
  ).bind(...bindings).run();
}

async function reorderCategories(request: Request, db: D1DatabaseLike) {
  const body = await readBody(request);
  const ids = parseIds(body);
  const current = await db.prepare("SELECT id FROM categories ORDER BY position ASC, name COLLATE NOCASE ASC").all<{ id: string }>();
  const actualIds = current.results.map((row) => row.id);
  if (!sameMembers(actualIds, ids)) {
    throw new ReorderHttpError(409, "reorder_stale", "Categories changed while reordering. Refresh and try again.");
  }
  await applyPositions(db, "categories", ids);
  return new Response(null, { status: 204 });
}

async function reorderBookmarks(request: Request, db: D1DatabaseLike) {
  const body = await readBody(request);
  const ids = parseIds(body);
  const categoryId = parseCategoryId(body);

  if (categoryId) {
    const category = await db.prepare("SELECT id FROM categories WHERE id = ? LIMIT 1").bind(categoryId).first<{ id: string }>();
    if (!category) throw new ReorderHttpError(400, "invalid_category", "categoryId does not reference an existing category.");
  }

  const current = await db.prepare(
    "SELECT id FROM bookmarks WHERE category_id IS ? AND archived_at IS NULL ORDER BY position ASC, title COLLATE NOCASE ASC",
  ).bind(categoryId).all<{ id: string }>();
  const actualIds = current.results.map((row) => row.id);
  if (!sameMembers(actualIds, ids)) {
    throw new ReorderHttpError(409, "reorder_stale", "Bookmarks changed while reordering. Refresh and try again.");
  }

  await applyPositions(db, "bookmarks", ids);
  return new Response(null, { status: 204 });
}

export async function handleReorderApi(request: Request, db: D1DatabaseLike, pathname: string) {
  if (pathname === "/api/categories/reorder") {
    if (request.method !== "PUT") throw new ReorderHttpError(405, "method_not_allowed", "Use PUT to reorder categories.");
    return reorderCategories(request, db);
  }
  if (pathname === "/api/bookmarks/reorder") {
    if (request.method !== "PUT") throw new ReorderHttpError(405, "method_not_allowed", "Use PUT to reorder bookmarks.");
    return reorderBookmarks(request, db);
  }
  return null;
}
