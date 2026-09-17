type BindValue = string | number | null;

export interface JournalPreparedStatementLike {
  bind(...values: BindValue[]): JournalPreparedStatementLike;
  all<T = unknown>(): Promise<{ results: T[] }>;
}

export interface ChangeJournalDatabaseLike {
  prepare(query: string): JournalPreparedStatementLike;
}

interface SnapshotRow {
  id: string;
  category_id: string | null;
  category_name: string | null;
  title: string;
  url: string;
  description: string | null;
  icon_url: string | null;
  health_policy: string;
  health_status: string;
  position: number;
  inbox_at: string | null;
  archived_at: string | null;
  published: number;
}

interface TagRow {
  bookmark_id: string;
  name: string;
}

interface JournalRow {
  id: string;
  operation: string;
  item_count: number;
  summary: string;
  items_json: string;
  created_at: string;
}

export interface BookmarkJournalSnapshot {
  id: string;
  title: string;
  url: string;
  description?: string;
  iconUrl?: string;
  categoryId: string | null;
  categoryName?: string;
  healthPolicy: string;
  healthStatus: string;
  position: number;
  inbox: boolean;
  archived: boolean;
  published: boolean;
  tags: string[];
}

export interface BookmarkJournalItem {
  bookmarkId: string;
  title: string;
  url: string;
  before: BookmarkJournalSnapshot | null;
  after: BookmarkJournalSnapshot | null;
}

export class ChangeJournalHttpError extends Error {
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

export async function loadBookmarkJournalSnapshots(
  db: ChangeJournalDatabaseLike,
  bookmarkIds: string[],
) {
  if (!bookmarkIds.length) return new Map<string, BookmarkJournalSnapshot>();
  const placeholders = bookmarkIds.map(() => "?").join(", ");
  const rows = await db.prepare(
    `SELECT b.id, b.category_id, c.name AS category_name,
            b.title, b.url, b.description, b.icon_url,
            b.health_policy, b.health_status, b.position,
            b.inbox_at, b.archived_at,
            CASE WHEN p.bookmark_id IS NULL THEN 0 ELSE 1 END AS published
       FROM bookmarks b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN public_bookmarks p ON p.bookmark_id = b.id
      WHERE b.id IN (${placeholders})`,
  ).bind(...bookmarkIds).all<SnapshotRow>();

  const tags = await db.prepare(
    `SELECT bt.bookmark_id, t.name
       FROM bookmark_tags bt
       JOIN tags t ON t.id = bt.tag_id
      WHERE bt.bookmark_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE`,
  ).bind(...bookmarkIds).all<TagRow>();
  const tagsByBookmark = new Map<string, string[]>();
  for (const id of bookmarkIds) tagsByBookmark.set(id, []);
  for (const row of tags.results) tagsByBookmark.get(row.bookmark_id)?.push(row.name);

  const snapshots = new Map<string, BookmarkJournalSnapshot>();
  for (const row of rows.results) {
    snapshots.set(row.id, {
      id: row.id,
      title: row.title,
      url: row.url,
      ...(row.description ? { description: row.description } : {}),
      ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
      categoryId: row.category_id,
      ...(row.category_name ? { categoryName: row.category_name } : {}),
      healthPolicy: row.health_policy,
      healthStatus: row.health_status,
      position: row.position,
      inbox: Boolean(row.inbox_at),
      archived: Boolean(row.archived_at),
      published: Boolean(row.published),
      tags: tagsByBookmark.get(row.id) ?? [],
    });
  }
  return snapshots;
}

export function createJournalItems(
  bookmarkIds: string[],
  before: Map<string, BookmarkJournalSnapshot>,
  afterFor: (snapshot: BookmarkJournalSnapshot) => BookmarkJournalSnapshot | null,
) {
  return bookmarkIds.map((bookmarkId) => {
    const snapshot = before.get(bookmarkId);
    if (!snapshot) {
      throw new ChangeJournalHttpError(
        409,
        "journal_snapshot_stale",
        "A selected bookmark changed before its journal snapshot could be recorded. Refresh and review again.",
      );
    }
    return {
      bookmarkId,
      title: snapshot.title,
      url: snapshot.url,
      before: snapshot,
      after: afterFor(snapshot),
    } satisfies BookmarkJournalItem;
  });
}

export function journalInsertStatement(
  db: ChangeJournalDatabaseLike,
  operation: string,
  summary: string,
  items: BookmarkJournalItem[],
) {
  return db.prepare(
    `INSERT INTO change_journal (id, operation, item_count, summary, items_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), operation, items.length, summary, JSON.stringify(items));
}

function parseLimit(request: Request) {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return 30;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ChangeJournalHttpError(400, "invalid_limit", "limit must be an integer between 1 and 100.");
  }
  return value;
}

async function listJournal(request: Request, db: ChangeJournalDatabaseLike) {
  const limit = parseLimit(request);
  const result = await db.prepare(
    `SELECT id, operation, item_count, summary, items_json, created_at
       FROM change_journal
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?`,
  ).bind(limit).all<JournalRow>();

  const entries = result.results.map((row) => {
    let items: BookmarkJournalItem[] = [];
    try {
      const parsed = JSON.parse(row.items_json) as unknown;
      if (Array.isArray(parsed)) items = parsed as BookmarkJournalItem[];
    } catch {
      items = [];
    }
    return {
      id: row.id,
      operation: row.operation,
      itemCount: row.item_count,
      summary: row.summary,
      items,
      createdAt: row.created_at,
    };
  });
  return json({ entries });
}

export async function handleChangeJournalApi(
  request: Request,
  db: ChangeJournalDatabaseLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/library/change-journal") return null;
  if (request.method !== "GET") {
    throw new ChangeJournalHttpError(405, "method_not_allowed", "Change journal only supports GET.");
  }
  return listJournal(request, db);
}
