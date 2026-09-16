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
  health_policy: string;
}

interface CategoryRow {
  id: string;
}

interface TagRow {
  id: string;
  name: string;
}

interface AiPatch {
  bookmarkId: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  tags: string[];
}

export class AiBatchApplyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_PATCHES = 20;
const MAX_TAGS = 12;
const ALLOWED_PATCH_FIELDS = new Set(["bookmarkId", "title", "description", "categoryId", "tags"]);

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
    throw new AiBatchApplyHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiBatchApplyHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function normalizeTags(value: unknown, index: number) {
  if (!Array.isArray(value)) {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].tags must be an array of strings.`);
  }
  if (value.length > MAX_TAGS) {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}] can have at most ${MAX_TAGS} tags.`);
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].tags must contain only strings.`);
    }
    const tag = entry.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) {
      throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}] contains a tag longer than 40 characters.`);
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function normalizePatch(value: unknown, index: number): AiPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}] must be an object.`);
  }
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) {
      throw new AiBatchApplyHttpError(
        400,
        "invalid_patch_field",
        `patches[${index}] contains unsupported field “${key}”. AI apply only accepts title, description, categoryId and tags.`,
      );
    }
  }

  if (typeof row.bookmarkId !== "string" || !row.bookmarkId.trim()) {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].bookmarkId is required.`);
  }
  const bookmarkId = row.bookmarkId.trim();

  if (typeof row.title !== "string" || !row.title.trim()) {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].title must be a non-empty string.`);
  }
  const title = row.title.trim();
  if (title.length > 200) {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].title must be 200 characters or fewer.`);
  }

  let description: string | null;
  if (row.description === null) {
    description = null;
  } else if (typeof row.description === "string") {
    const trimmed = row.description.trim();
    if (trimmed.length > 2000) {
      throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].description must be 2000 characters or fewer.`);
    }
    description = trimmed || null;
  } else {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].description must be a string or null.`);
  }

  let categoryId: string | null;
  if (row.categoryId === null) {
    categoryId = null;
  } else if (typeof row.categoryId === "string" && row.categoryId.trim()) {
    categoryId = row.categoryId.trim();
  } else {
    throw new AiBatchApplyHttpError(400, "invalid_patch", `patches[${index}].categoryId must be a string or null.`);
  }

  return {
    bookmarkId,
    title,
    description,
    categoryId,
    tags: normalizeTags(row.tags, index),
  };
}

function normalizePatches(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    throw new AiBatchApplyHttpError(400, "invalid_patches", "Select at least one reviewed AI patch to apply.");
  }
  if (value.length > MAX_PATCHES) {
    throw new AiBatchApplyHttpError(400, "too_many_patches", `AI apply is limited to ${MAX_PATCHES} bookmarks per request.`);
  }

  const patches = value.map(normalizePatch);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (seen.has(patch.bookmarkId)) {
      throw new AiBatchApplyHttpError(400, "duplicate_patch", "Each bookmark can appear only once in an AI apply request.");
    }
    seen.add(patch.bookmarkId);
  }
  return patches;
}

async function validateTargets(db: D1DatabaseLike, patches: AiPatch[]) {
  const ids = patches.map((patch) => patch.bookmarkId);
  const placeholders = ids.map(() => "?").join(", ");
  const bookmarks = await db.prepare(
    `SELECT id, health_policy FROM bookmarks WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<BookmarkRow>();
  const bookmarkById = new Map(bookmarks.results.map((row) => [row.id, row]));

  for (const patch of patches) {
    const bookmark = bookmarkById.get(patch.bookmarkId);
    if (!bookmark) {
      throw new AiBatchApplyHttpError(404, "bookmark_not_found", "One or more reviewed bookmarks no longer exist. Refresh and regenerate before applying.");
    }
    if (bookmark.health_policy !== "normal") {
      throw new AiBatchApplyHttpError(
        409,
        "protected_health_policy",
        "One or more reviewed bookmarks are no longer AI-eligible. No patches were applied.",
      );
    }
  }

  const categoryIds = Array.from(new Set(patches.flatMap((patch) => patch.categoryId ? [patch.categoryId] : [])));
  if (!categoryIds.length) return;
  const categoryPlaceholders = categoryIds.map(() => "?").join(", ");
  const categories = await db.prepare(
    `SELECT id FROM categories WHERE id IN (${categoryPlaceholders})`,
  )
    .bind(...categoryIds)
    .all<CategoryRow>();
  const found = new Set(categories.results.map((row) => row.id));
  const missing = categoryIds.find((id) => !found.has(id));
  if (missing) {
    throw new AiBatchApplyHttpError(
      409,
      "category_changed",
      "A suggested category no longer exists. No patches were applied; refresh and regenerate before applying.",
    );
  }
}

async function applyPatches(request: Request, db: D1DatabaseLike) {
  const body = await readBody(request);
  const patches = normalizePatches(body.patches);
  await validateTargets(db, patches);

  const existingTags = await db.prepare("SELECT id, name FROM tags").all<TagRow>();
  const tagIdByName = new Map(existingTags.results.map((row) => [row.name.toLocaleLowerCase(), row.id]));
  const statements: D1PreparedStatementLike[] = [];

  for (const patch of patches) {
    statements.push(
      db.prepare(
        `UPDATE bookmarks
            SET title = ?, description = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      ).bind(patch.title, patch.description, patch.categoryId, patch.bookmarkId),
    );
    statements.push(
      db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(patch.bookmarkId),
    );

    for (const name of patch.tags) {
      const key = name.toLocaleLowerCase();
      let tagId = tagIdByName.get(key);
      if (!tagId) {
        tagId = crypto.randomUUID();
        tagIdByName.set(key, tagId);
        statements.push(
          db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").bind(tagId, name),
        );
      }
      statements.push(
        db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)")
          .bind(patch.bookmarkId, tagId),
      );
    }
  }

  statements.push(db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)"));
  await db.batch(statements);

  return json({
    applied: patches.length,
    bookmarkIds: patches.map((patch) => patch.bookmarkId),
  });
}

export async function handleAiBatchApplyApi(
  request: Request,
  db: D1DatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/ai/apply") return null;
  if (request.method !== "POST") {
    throw new AiBatchApplyHttpError(405, "method_not_allowed", "Method not allowed for AI batch apply.");
  }
  return applyPatches(request, db);
}
