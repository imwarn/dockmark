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

interface BookmarkTargetRow {
  id: string;
  category_id: string | null;
  position: number;
  health_policy: string;
  inbox_at: string | null;
}

interface CategoryRow {
  id: string;
}

interface TagRow {
  id: string;
  name: string;
}

interface CategoryPositionRow {
  category_id: string | null;
  max_position: number;
}

interface InboxReviewPatch {
  bookmarkId: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  tags: string[];
}

export class InboxReviewBatchHttpError extends Error {
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
    throw new InboxReviewBatchHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InboxReviewBatchHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function normalizeTags(value: unknown, index: number) {
  if (!Array.isArray(value)) {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].tags must be an array of strings.`);
  }
  if (value.length > MAX_TAGS) {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}] can have at most ${MAX_TAGS} tags.`);
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].tags must contain only strings.`);
    }
    const tag = entry.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) {
      throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}] contains a tag longer than 40 characters.`);
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function normalizePatch(value: unknown, index: number): InboxReviewPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}] must be an object.`);
  }
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) {
      throw new InboxReviewBatchHttpError(
        400,
        "invalid_patch_field",
        `patches[${index}] contains unsupported field “${key}”. Inbox batch review accepts only title, description, categoryId and tags.`,
      );
    }
  }

  if (typeof row.bookmarkId !== "string" || !row.bookmarkId.trim()) {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].bookmarkId is required.`);
  }
  const bookmarkId = row.bookmarkId.trim();

  if (typeof row.title !== "string" || !row.title.trim()) {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].title must be a non-empty string.`);
  }
  const title = row.title.trim();
  if (title.length > 200) {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].title must be 200 characters or fewer.`);
  }

  let description: string | null;
  if (row.description === null) {
    description = null;
  } else if (typeof row.description === "string") {
    const trimmed = row.description.trim();
    if (trimmed.length > 2000) {
      throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].description must be 2000 characters or fewer.`);
    }
    description = trimmed || null;
  } else {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].description must be a string or null.`);
  }

  let categoryId: string | null;
  if (row.categoryId === null) {
    categoryId = null;
  } else if (typeof row.categoryId === "string" && row.categoryId.trim()) {
    categoryId = row.categoryId.trim();
  } else {
    throw new InboxReviewBatchHttpError(400, "invalid_patch", `patches[${index}].categoryId must be a string or null.`);
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
    throw new InboxReviewBatchHttpError(400, "invalid_patches", "Select at least one reviewed Inbox suggestion to file.");
  }
  if (value.length > MAX_PATCHES) {
    throw new InboxReviewBatchHttpError(400, "too_many_patches", `Inbox batch review is limited to ${MAX_PATCHES} bookmarks per request.`);
  }

  const patches = value.map(normalizePatch);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (seen.has(patch.bookmarkId)) {
      throw new InboxReviewBatchHttpError(400, "duplicate_patch", "Each Inbox bookmark can appear only once in a reviewed batch.");
    }
    seen.add(patch.bookmarkId);
  }
  return patches;
}

async function validateTargets(db: D1DatabaseLike, patches: InboxReviewPatch[]) {
  const ids = patches.map((patch) => patch.bookmarkId);
  const placeholders = ids.map(() => "?").join(", ");
  const bookmarks = await db.prepare(
    `SELECT id, category_id, position, health_policy, inbox_at
       FROM bookmarks
      WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<BookmarkTargetRow>();
  const bookmarkById = new Map(bookmarks.results.map((row) => [row.id, row]));

  for (const patch of patches) {
    const bookmark = bookmarkById.get(patch.bookmarkId);
    if (!bookmark || !bookmark.inbox_at) {
      throw new InboxReviewBatchHttpError(
        409,
        "inbox_changed",
        "One or more reviewed bookmarks are no longer waiting in Inbox. Nothing was filed.",
      );
    }
    if (bookmark.health_policy !== "normal") {
      throw new InboxReviewBatchHttpError(
        409,
        "protected_health_policy",
        "One or more reviewed bookmarks are no longer AI-eligible. Nothing was filed.",
      );
    }
  }

  const categoryIds = Array.from(new Set(patches.flatMap((patch) => patch.categoryId ? [patch.categoryId] : [])));
  if (categoryIds.length) {
    const categoryPlaceholders = categoryIds.map(() => "?").join(", ");
    const categories = await db.prepare(
      `SELECT id FROM categories WHERE id IN (${categoryPlaceholders})`,
    )
      .bind(...categoryIds)
      .all<CategoryRow>();
    const found = new Set(categories.results.map((row) => row.id));
    if (categoryIds.some((id) => !found.has(id))) {
      throw new InboxReviewBatchHttpError(
        409,
        "category_changed",
        "A reviewed category no longer exists. Nothing was filed; refresh and regenerate before applying.",
      );
    }
  }

  return bookmarkById;
}

function categoryKey(categoryId: string | null) {
  return categoryId ?? "__uncategorized__";
}

async function applyReviewedBatch(request: Request, db: D1DatabaseLike) {
  const body = await readBody(request);
  const patches = normalizePatches(body.patches);
  const bookmarkById = await validateTargets(db, patches);

  const [existingTags, categoryPositions] = await Promise.all([
    db.prepare("SELECT id, name FROM tags").all<TagRow>(),
    db.prepare(
      `SELECT category_id, COALESCE(MAX(position), -1) AS max_position
         FROM bookmarks
        GROUP BY category_id`,
    ).all<CategoryPositionRow>(),
  ]);
  const tagIdByName = new Map(existingTags.results.map((row) => [row.name.toLocaleLowerCase(), row.id]));
  const maxPositionByCategory = new Map(
    categoryPositions.results.map((row) => [categoryKey(row.category_id), row.max_position]),
  );
  const statements: D1PreparedStatementLike[] = [];

  for (const patch of patches) {
    const current = bookmarkById.get(patch.bookmarkId)!;
    let position = current.position;
    if (current.category_id !== patch.categoryId) {
      const key = categoryKey(patch.categoryId);
      position = (maxPositionByCategory.get(key) ?? -1) + 1;
      maxPositionByCategory.set(key, position);
    }

    statements.push(
      db.prepare(
        `UPDATE bookmarks
            SET title = ?, description = ?, category_id = ?, position = ?, inbox_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND inbox_at IS NOT NULL`,
      ).bind(patch.title, patch.description, patch.categoryId, position, patch.bookmarkId),
    );
    statements.push(db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(patch.bookmarkId));

    for (const name of patch.tags) {
      const key = name.toLocaleLowerCase();
      let tagId = tagIdByName.get(key);
      if (!tagId) {
        tagId = crypto.randomUUID();
        tagIdByName.set(key, tagId);
        statements.push(db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").bind(tagId, name));
      }
      statements.push(
        db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)")
          .bind(patch.bookmarkId, tagId),
      );
    }
  }

  statements.push(db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)"));
  const batchDb = db as D1BatchDatabaseLike;
  if (typeof batchDb.batch !== "function") {
    throw new InboxReviewBatchHttpError(500, "batch_unavailable", "D1 batch execution is unavailable in this runtime.");
  }
  await batchDb.batch(statements);

  return json({
    applied: patches.length,
    bookmarkIds: patches.map((patch) => patch.bookmarkId),
  });
}

export async function handleInboxReviewBatchApi(
  request: Request,
  db: D1DatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/inbox/review-batch") return null;
  if (request.method !== "POST") {
    throw new InboxReviewBatchHttpError(405, "method_not_allowed", "Only POST is supported for reviewed Inbox batch filing.");
  }
  return applyReviewedBatch(request, db);
}
