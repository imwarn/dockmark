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

interface BookmarkTagRow {
  bookmark_id: string;
  name: string;
}

export class TagHttpError extends Error {
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

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new TagHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TagHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function normalizeTags(value: unknown) {
  if (!Array.isArray(value)) {
    throw new TagHttpError(400, "invalid_tags", "tags must be an array of strings.");
  }
  if (value.length > 12) {
    throw new TagHttpError(400, "invalid_tags", "A bookmark can have at most 12 tags.");
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new TagHttpError(400, "invalid_tags", "tags must contain only strings.");
    }
    const tag = entry.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > 40) {
      throw new TagHttpError(400, "invalid_tags", "Each tag must be 40 characters or fewer.");
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

async function listBookmarkTags(db: D1DatabaseLike) {
  const result = await db.prepare(
    `SELECT bt.bookmark_id, t.name
       FROM bookmark_tags bt
       JOIN tags t ON t.id = bt.tag_id
      ORDER BY bt.bookmark_id ASC, t.name COLLATE NOCASE ASC`,
  ).all<BookmarkTagRow>();

  const bookmarkTags: Record<string, string[]> = {};
  for (const row of result.results) {
    (bookmarkTags[row.bookmark_id] ??= []).push(row.name);
  }
  return bookmarkTags;
}

async function replaceBookmarkTags(request: Request, db: D1DatabaseLike, bookmarkId: string) {
  const bookmark = await db.prepare("SELECT id FROM bookmarks WHERE id = ? LIMIT 1")
    .bind(bookmarkId)
    .first<{ id: string }>();
  if (!bookmark) throw new TagHttpError(404, "bookmark_not_found", "Bookmark not found.");

  const body = await readBody(request);
  const tags = normalizeTags(body.tags);

  await db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(bookmarkId).run();

  for (const name of tags) {
    let tag = await db.prepare("SELECT id, name FROM tags WHERE lower(name) = lower(?) LIMIT 1")
      .bind(name)
      .first<{ id: string; name: string }>();
    if (!tag) {
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").bind(id, name).run();
      tag = { id, name };
    }
    await db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)")
      .bind(bookmarkId, tag.id)
      .run();
  }

  await db.prepare("DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)").run();

  const stored = await db.prepare(
    `SELECT t.name
       FROM bookmark_tags bt
       JOIN tags t ON t.id = bt.tag_id
      WHERE bt.bookmark_id = ?
      ORDER BY t.name COLLATE NOCASE ASC`,
  )
    .bind(bookmarkId)
    .all<{ name: string }>();

  return json({ bookmarkId, tags: stored.results.map((row) => row.name) });
}

export async function handleTagApi(
  request: Request,
  db: D1DatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/bookmark-tags") {
    if (request.method !== "GET") {
      throw new TagHttpError(405, "method_not_allowed", "Method not allowed for bookmark tags.");
    }
    return json({ bookmarkTags: await listBookmarkTags(db) });
  }

  const match = pathname.match(/^\/api\/bookmarks\/([^/]+)\/tags$/);
  if (!match?.[1]) return null;
  if (request.method !== "PUT") {
    throw new TagHttpError(405, "method_not_allowed", "Method not allowed for bookmark tags.");
  }
  return replaceBookmarkTags(request, db, decodeURIComponent(match[1]));
}
