import {
  createJournalItems,
  journalInsertStatement,
  loadBookmarkJournalSnapshots,
} from "./change-journal";

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

interface D1BatchDatabaseLike extends D1DatabaseLike {
  batch(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
}

interface BookmarkRow {
  id: string;
  category_id: string | null;
  position: number;
}

interface BookmarkTagRow {
  bookmark_id: string;
  name: string;
}

interface TagRow {
  id: string;
  name: string;
}

export class LibraryBatchOrganizeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_BOOKMARKS = 50;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;
const ALLOWED_FIELDS = new Set(["bookmarkIds", "categoryId", "addTags", "removeTags"]);

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
    throw new LibraryBatchOrganizeHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryBatchOrganizeHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function normalizeBookmarkIds(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    throw new LibraryBatchOrganizeHttpError(400, "invalid_bookmarks", "Select at least one bookmark to organize.");
  }
  if (value.length > MAX_BOOKMARKS) {
    throw new LibraryBatchOrganizeHttpError(400, "too_many_bookmarks", `Bulk organization is limited to ${MAX_BOOKMARKS} bookmarks per review.`);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new LibraryBatchOrganizeHttpError(400, "invalid_bookmarks", "bookmarkIds must contain only non-empty strings.");
    }
    const id = entry.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) {
    throw new LibraryBatchOrganizeHttpError(400, "invalid_bookmarks", "Select at least one bookmark to organize.");
  }
  return ids;
}

function normalizeTags(value: unknown, field: "addTags" | "removeTags") {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new LibraryBatchOrganizeHttpError(400, "invalid_tags", `${field} must be an array of strings.`);
  }
  if (value.length > MAX_TAGS) {
    throw new LibraryBatchOrganizeHttpError(400, "invalid_tags", `${field} can contain at most ${MAX_TAGS} tags.`);
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new LibraryBatchOrganizeHttpError(400, "invalid_tags", `${field} must contain only strings.`);
    }
    const tag = entry.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new LibraryBatchOrganizeHttpError(400, "invalid_tags", `${field} contains a tag longer than ${MAX_TAG_LENGTH} characters.`);
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

async function applyBatch(request: Request, db: D1DatabaseLike) {
  const body = await readBody(request);
  for (const field of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new LibraryBatchOrganizeHttpError(400, "unsupported_field", `Unsupported bulk organization field “${field}”.`);
    }
  }

  const bookmarkIds = normalizeBookmarkIds(body.bookmarkIds);
  const categorySpecified = Object.prototype.hasOwnProperty.call(body, "categoryId");
  let categoryId: string | null = null;
  if (categorySpecified) {
    if (body.categoryId === null) categoryId = null;
    else if (typeof body.categoryId === "string" && body.categoryId.trim()) categoryId = body.categoryId.trim();
    else throw new LibraryBatchOrganizeHttpError(400, "invalid_category", "categoryId must be a non-empty string or null when supplied.");
  }
  const addTags = normalizeTags(body.addTags, "addTags");
  const removeTags = normalizeTags(body.removeTags, "removeTags");

  const removeKeys = new Set(removeTags.map((tag) => tag.toLocaleLowerCase()));
  const overlap = addTags.find((tag) => removeKeys.has(tag.toLocaleLowerCase()));
  if (overlap) {
    throw new LibraryBatchOrganizeHttpError(400, "tag_overlap", `Tag “${overlap}” cannot be added and removed in the same review.`);
  }
  if (!categorySpecified && !addTags.length && !removeTags.length) {
    throw new LibraryBatchOrganizeHttpError(400, "no_changes", "Choose a category or tag change before reviewing this batch.");
  }

  const placeholders = bookmarkIds.map(() => "?").join(", ");
  const bookmarkRows = await db.prepare(
    `SELECT id, category_id, position FROM bookmarks WHERE id IN (${placeholders}) AND archived_at IS NULL`,
  ).bind(...bookmarkIds).all<BookmarkRow>();
  const bookmarkById = new Map(bookmarkRows.results.map((row) => [row.id, row]));
  if (bookmarkById.size !== bookmarkIds.length) {
    throw new LibraryBatchOrganizeHttpError(409, "bookmark_changed", "One or more selected bookmarks no longer exist in the active Library. Refresh and review again.");
  }

  let destinationCategoryName: string | undefined;
  if (categorySpecified && categoryId) {
    const category = await db.prepare("SELECT id, name FROM categories WHERE id = ? LIMIT 1").bind(categoryId).first<{ id: string; name: string }>();
    if (!category) {
      throw new LibraryBatchOrganizeHttpError(409, "category_changed", "The reviewed category no longer exists. Refresh the Library and review again.");
    }
    destinationCategoryName = category.name;
  }

  const tagRows = await db.prepare(
    `SELECT bt.bookmark_id, t.name
       FROM bookmark_tags bt
       JOIN tags t ON t.id = bt.tag_id
      WHERE bt.bookmark_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE`,
  ).bind(...bookmarkIds).all<BookmarkTagRow>();
  const currentTags = new Map<string, string[]>();
  for (const id of bookmarkIds) currentTags.set(id, []);
  for (const row of tagRows.results) currentTags.get(row.bookmark_id)?.push(row.name);

  const finalTags = new Map<string, string[]>();
  for (const id of bookmarkIds) {
    const names = new Map<string, string>();
    for (const tag of currentTags.get(id) ?? []) names.set(tag.toLocaleLowerCase(), tag);
    for (const key of removeKeys) names.delete(key);
    for (const tag of addTags) names.set(tag.toLocaleLowerCase(), tag);
    const next = Array.from(names.values());
    if (next.length > MAX_TAGS) {
      const bookmark = bookmarkById.get(id);
      throw new LibraryBatchOrganizeHttpError(
        409,
        "tag_limit_exceeded",
        `A selected bookmark would have ${next.length} tags after this review. The limit is ${MAX_TAGS}; no bookmarks were changed.${bookmark ? ` Bookmark: ${bookmark.id}.` : ""}`,
      );
    }
    finalTags.set(id, next);
  }

  const before = await loadBookmarkJournalSnapshots(db, bookmarkIds);
  const existingTags = await db.prepare("SELECT id, name FROM tags").all<TagRow>();
  const tagIdByName = new Map(existingTags.results.map((row) => [row.name.toLocaleLowerCase(), row.id]));
  const statements: D1PreparedStatementLike[] = [];
  const finalPositions = new Map<string, number>();

  let nextPosition = 0;
  if (categorySpecified) {
    const maxPosition = categoryId
      ? await db.prepare("SELECT COALESCE(MAX(position), -1) AS value FROM bookmarks WHERE category_id = ? AND archived_at IS NULL").bind(categoryId).first<{ value: number }>()
      : await db.prepare("SELECT COALESCE(MAX(position), -1) AS value FROM bookmarks WHERE category_id IS NULL AND archived_at IS NULL").first<{ value: number }>();
    nextPosition = Number(maxPosition?.value ?? -1) + 1;
  }

  const tagsChanged = addTags.length > 0 || removeTags.length > 0;
  for (const id of bookmarkIds) {
    if (categorySpecified) {
      finalPositions.set(id, nextPosition);
      statements.push(
        db.prepare("UPDATE bookmarks SET category_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL")
          .bind(categoryId, nextPosition, id),
      );
      nextPosition += 1;
    } else if (tagsChanged) {
      statements.push(db.prepare("UPDATE bookmarks SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL").bind(id));
    }

    if (!tagsChanged) continue;
    statements.push(db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(id));
    for (const name of finalTags.get(id) ?? []) {
      const key = name.toLocaleLowerCase();
      let tagId = tagIdByName.get(key);
      if (!tagId) {
        tagId = crypto.randomUUID();
        tagIdByName.set(key, tagId);
        statements.push(db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").bind(tagId, name));
      }
      statements.push(
        db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(id, tagId),
      );
    }
  }
  if (tagsChanged) statements.push(db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)"));

  const journalItems = createJournalItems(bookmarkIds, before, (snapshot) => {
    const after = { ...snapshot };
    if (categorySpecified) {
      after.categoryId = categoryId;
      after.position = finalPositions.get(snapshot.id) ?? snapshot.position;
      if (destinationCategoryName) after.categoryName = destinationCategoryName;
      else delete after.categoryName;
    }
    if (tagsChanged) after.tags = finalTags.get(snapshot.id) ?? snapshot.tags;
    return after;
  });
  const changeParts = [
    categorySpecified ? (categoryId ? `category → ${destinationCategoryName ?? categoryId}` : "category → Uncategorized") : null,
    addTags.length ? `add ${addTags.map((tag) => `#${tag}`).join(" ")}` : null,
    removeTags.length ? `remove ${removeTags.map((tag) => `#${tag}`).join(" ")}` : null,
  ].filter(Boolean).join("; ");
  statements.push(journalInsertStatement(
    db,
    "bulk-organize",
    `Organized ${bookmarkIds.length} bookmark${bookmarkIds.length === 1 ? "" : "s"}: ${changeParts}`,
    journalItems,
  ) as D1PreparedStatementLike);

  const batchDb = db as D1BatchDatabaseLike;
  if (typeof batchDb.batch !== "function") {
    throw new LibraryBatchOrganizeHttpError(500, "batch_unavailable", "D1 batch execution is unavailable in this runtime.");
  }
  await batchDb.batch(statements);

  return json({
    applied: bookmarkIds.length,
    bookmarkIds,
    categoryChanged: categorySpecified,
    categoryId: categorySpecified ? categoryId : undefined,
    addTags,
    removeTags,
  });
}

export async function handleLibraryBatchOrganizeApi(
  request: Request,
  db: D1DatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/bookmarks/batch-organize") return null;
  if (request.method !== "POST") {
    throw new LibraryBatchOrganizeHttpError(405, "method_not_allowed", "Method not allowed for reviewed Library batch organization.");
  }
  return applyBatch(request, db);
}
