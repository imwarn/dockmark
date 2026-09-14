type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface PublicBookmarkDatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export class PublicBookmarkHttpError extends Error {
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

type PublicBookmarkRow = {
  id: string;
  title: string;
  url: string;
  description: string | null;
  icon_url: string | null;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  position: number;
  published_at: string;
};

export async function listPublicBookmarks(db: PublicBookmarkDatabaseLike) {
  const result = await db.prepare(
    `SELECT b.id, b.title, b.url, b.description, b.icon_url,
            b.category_id, c.name AS category_name, c.icon AS category_icon,
            b.position, p.published_at
       FROM public_bookmarks p
       JOIN bookmarks b ON b.id = p.bookmark_id
       LEFT JOIN categories c ON c.id = b.category_id
      ORDER BY COALESCE(c.position, 2147483647) ASC, c.name COLLATE NOCASE ASC,
               b.position ASC, b.title COLLATE NOCASE ASC`,
  ).all<PublicBookmarkRow>();

  return result.results.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    ...(row.description ? { description: row.description } : {}),
    ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
    category: row.category_id
      ? { id: row.category_id, name: row.category_name ?? "Uncategorized", ...(row.category_icon ? { icon: row.category_icon } : {}) }
      : null,
    position: row.position,
    publishedAt: row.published_at,
  }));
}

export async function listPublicSelection(db: PublicBookmarkDatabaseLike) {
  const result = await db.prepare(
    "SELECT bookmark_id FROM public_bookmarks ORDER BY published_at ASC",
  ).all<{ bookmark_id: string }>();
  return result.results.map((row) => row.bookmark_id);
}

async function publishBookmark(db: PublicBookmarkDatabaseLike, id: string) {
  const bookmark = await db.prepare("SELECT id FROM bookmarks WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string }>();
  if (!bookmark) throw new PublicBookmarkHttpError(404, "bookmark_not_found", "Bookmark not found.");
  await db.prepare(
    "INSERT INTO public_bookmarks (bookmark_id, published_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(bookmark_id) DO NOTHING",
  )
    .bind(id)
    .run();
  return json({ published: true, bookmarkId: id });
}

async function unpublishBookmark(db: PublicBookmarkDatabaseLike, id: string) {
  await db.prepare("DELETE FROM public_bookmarks WHERE bookmark_id = ?").bind(id).run();
  return new Response(null, { status: 204 });
}

export async function handlePublicBookmarkApi(
  request: Request,
  db: PublicBookmarkDatabaseLike,
  pathname: string,
  authenticated: boolean,
): Promise<Response | null> {
  if (pathname === "/api/public/bookmarks") {
    if (request.method !== "GET") throw new PublicBookmarkHttpError(405, "method_not_allowed", "Public bookmarks are read-only.");
    return json({ bookmarks: await listPublicBookmarks(db) });
  }

  if (pathname === "/api/public/bookmarks/selection") {
    if (!authenticated) throw new PublicBookmarkHttpError(401, "authentication_required", "Sign in to manage the public page.");
    if (request.method !== "GET") throw new PublicBookmarkHttpError(405, "method_not_allowed", "Method not allowed.");
    return json({ bookmarkIds: await listPublicSelection(db) });
  }

  const match = pathname.match(/^\/api\/public\/bookmarks\/([^/]+)$/);
  if (!match?.[1]) return null;
  if (!authenticated) throw new PublicBookmarkHttpError(401, "authentication_required", "Sign in to manage the public page.");
  const id = decodeURIComponent(match[1]);
  if (request.method === "PUT") return publishBookmark(db, id);
  if (request.method === "DELETE") return unpublishBookmark(db, id);
  throw new PublicBookmarkHttpError(405, "method_not_allowed", "Method not allowed.");
}
