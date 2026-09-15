import { inferHealthPolicy, normalizeBookmarkUrl } from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface MetadataDatabase {
  prepare(query: string): D1PreparedStatementLike;
}

interface BookmarkRow {
  id: string;
  url: string;
}

interface MetadataRow {
  bookmark_id: string;
  title: string | null;
  description: string | null;
  canonical_url: string | null;
  icon_url: string | null;
  image_url: string | null;
  final_url: string | null;
  fetched_at: string;
}

export interface BookmarkMetadata {
  bookmarkId: string;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  iconUrl?: string;
  imageUrl?: string;
  finalUrl?: string;
  fetchedAt: string;
}

interface FetchedMetadata {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
  iconUrl: string | null;
  imageUrl: string | null;
  finalUrl: string;
}

export class MetadataHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 512 * 1024;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function metadataFromRow(row: MetadataRow): BookmarkMetadata {
  return {
    bookmarkId: row.bookmark_id,
    ...(row.title ? { title: row.title } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.canonical_url ? { canonicalUrl: row.canonical_url } : {}),
    ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    ...(row.final_url ? { finalUrl: row.final_url } : {}),
    fetchedAt: row.fetched_at,
  };
}

function assertPublicTarget(rawUrl: string) {
  const normalized = normalizeBookmarkUrl(rawUrl);
  if (inferHealthPolicy(normalized) === "local-only") {
    throw new MetadataHttpError(409, "metadata_local_only", "Local/private bookmarks are not fetched by the server.");
  }
  return new URL(normalized);
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function cleanText(value: string | null | undefined, maxLength: number) {
  if (!value) return null;
  const text = decodeHtml(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function attributes(tag: string) {
  const output = new Map<string, string>();
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag))) {
    const key = match[1]?.toLowerCase();
    if (!key) continue;
    output.set(key, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return output;
}

function absoluteUrl(value: string | null | undefined, base: URL) {
  if (!value) return null;
  try {
    const resolved = new URL(decodeHtml(value.trim()), base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString().slice(0, 4096);
  } catch {
    return null;
  }
}

function extractMetadata(html: string, finalUrl: URL): FetchedMetadata {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  let title = cleanText(titleMatch?.[1], 300);
  let description: string | null = null;
  let canonicalUrl: string | null = null;
  let iconUrl: string | null = null;
  let imageUrl: string | null = null;

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content") ?? "";
    if (key === "og:title") title = cleanText(content, 300) ?? title;
    if (key === "og:description" && !description) description = cleanText(content, 2000);
    if (key === "description" && !description) description = cleanText(content, 2000);
    if (key === "og:image" && !imageUrl) imageUrl = absoluteUrl(content, finalUrl);
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = attrs.get("href");
    if (rel.includes("canonical") && !canonicalUrl) canonicalUrl = absoluteUrl(href, finalUrl);
    if (rel.some((value) => value === "icon" || value === "shortcut" || value === "apple-touch-icon") && !iconUrl) {
      iconUrl = absoluteUrl(href, finalUrl);
    }
  }

  iconUrl ??= new URL("/favicon.ico", finalUrl).toString();

  return {
    title,
    description,
    canonicalUrl,
    iconUrl,
    imageUrl,
    finalUrl: finalUrl.toString(),
  };
}

async function readLimitedText(response: Response) {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_HTML_BYTES - received;
      if (remaining <= 0) break;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      received += chunk.byteLength;
      output += decoder.decode(chunk, { stream: true });
      if (received >= MAX_HTML_BYTES) break;
    }
    output += decoder.decode();
    return output;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function fetchRemoteMetadata(rawUrl: string): Promise<FetchedMetadata> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let current = assertPublicTarget(rawUrl);

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "user-agent": "Dockmark-Metadata/0.9 (+https://github.com/imwarn/dockmark)",
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new MetadataHttpError(502, "metadata_redirect_invalid", "Metadata target redirected without a Location header.");
        if (redirectCount === MAX_REDIRECTS) throw new MetadataHttpError(502, "metadata_redirect_limit", "Metadata target redirected too many times.");
        const next = new URL(location, current);
        current = assertPublicTarget(next.toString());
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new MetadataHttpError(502, "metadata_http_error", `Metadata target returned HTTP ${response.status}.`);
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        await response.body?.cancel().catch(() => undefined);
        throw new MetadataHttpError(415, "metadata_not_html", "Metadata can only be fetched from HTML pages.");
      }

      return extractMetadata(await readLimitedText(response), current);
    }
  } catch (error) {
    if (error instanceof MetadataHttpError) throw error;
    if (controller.signal.aborted) {
      throw new MetadataHttpError(504, "metadata_timeout", "Metadata request timed out.");
    }
    throw new MetadataHttpError(502, "metadata_fetch_failed", error instanceof Error ? error.message : "Metadata fetch failed.");
  } finally {
    clearTimeout(timeout);
  }

  throw new MetadataHttpError(502, "metadata_fetch_failed", "Metadata fetch failed.");
}

async function bookmarkRow(db: MetadataDatabase, bookmarkId: string) {
  return db.prepare("SELECT id, url FROM bookmarks WHERE id = ? LIMIT 1")
    .bind(bookmarkId)
    .first<BookmarkRow>();
}

async function metadataRow(db: MetadataDatabase, bookmarkId: string) {
  return db.prepare(
    `SELECT bookmark_id, title, description, canonical_url, icon_url, image_url, final_url, fetched_at
       FROM bookmark_metadata
      WHERE bookmark_id = ?`,
  )
    .bind(bookmarkId)
    .first<MetadataRow>();
}

async function refreshMetadata(db: MetadataDatabase, bookmark: BookmarkRow) {
  const fetched = await fetchRemoteMetadata(bookmark.url);
  const fetchedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO bookmark_metadata
      (bookmark_id, title, description, canonical_url, icon_url, image_url, final_url, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(bookmark_id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       canonical_url = excluded.canonical_url,
       icon_url = excluded.icon_url,
       image_url = excluded.image_url,
       final_url = excluded.final_url,
       fetched_at = excluded.fetched_at`,
  )
    .bind(
      bookmark.id,
      fetched.title,
      fetched.description,
      fetched.canonicalUrl,
      fetched.iconUrl,
      fetched.imageUrl,
      fetched.finalUrl,
      fetchedAt,
    )
    .run();

  const row = await metadataRow(db, bookmark.id);
  if (!row) throw new MetadataHttpError(500, "metadata_write_failed", "Metadata could not be saved.");
  return metadataFromRow(row);
}

export async function handleMetadataApi(
  request: Request,
  db: MetadataDatabase,
  pathname: string,
): Promise<Response | null> {
  const match = pathname.match(/^\/api\/bookmarks\/([^/]+)\/metadata$/);
  if (!match?.[1]) return null;
  const bookmarkId = decodeURIComponent(match[1]);
  const bookmark = await bookmarkRow(db, bookmarkId);
  if (!bookmark) throw new MetadataHttpError(404, "bookmark_not_found", "Bookmark not found.");

  if (request.method === "GET") {
    const row = await metadataRow(db, bookmarkId);
    return json({ metadata: row ? metadataFromRow(row) : null });
  }

  if (request.method === "POST") {
    const metadata = await refreshMetadata(db, bookmark);
    return json({ metadata });
  }

  throw new MetadataHttpError(405, "method_not_allowed", "Only GET and POST are supported for bookmark metadata.");
}
