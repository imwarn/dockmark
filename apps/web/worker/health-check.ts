import {
  inferHealthPolicy,
  normalizeBookmarkUrl,
  type HealthCheck,
  type HealthPolicy,
  type HealthStatus,
} from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface HealthDatabase {
  prepare(query: string): D1PreparedStatementLike;
}

interface BookmarkHealthRow {
  id: string;
  url: string;
  health_policy: HealthPolicy;
}

interface HealthCheckRow {
  id: string;
  bookmark_id: string;
  status: HealthStatus;
  http_status: number | null;
  final_url: string | null;
  response_ms: number | null;
  error_code: string | null;
  checked_at: string;
}

interface ProbeResult {
  status: HealthStatus;
  httpStatus?: number;
  finalUrl?: string;
  responseMs: number;
  errorCode?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const CHECK_TIMEOUT_MS = 10_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function healthFromRow(row: HealthCheckRow): HealthCheck {
  return {
    id: row.id,
    bookmarkId: row.bookmark_id,
    status: row.status,
    ...(row.http_status == null ? {} : { httpStatus: row.http_status }),
    ...(row.final_url ? { finalUrl: row.final_url } : {}),
    ...(row.response_ms == null ? {} : { responseMs: row.response_ms }),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    checkedAt: row.checked_at,
  };
}

function classifyHttpStatus(status: number, redirected: boolean): HealthStatus {
  if (status >= 200 && status < 300) return redirected ? "redirected" : "healthy";
  if (status === 401) return "auth-required";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate-limited";
  return "unavailable";
}

function assertPublicTarget(rawUrl: string) {
  const normalized = normalizeBookmarkUrl(rawUrl);
  const parsed = new URL(normalized);
  if (inferHealthPolicy(normalized) === "local-only") {
    throw new Error("unsafe_target");
  }
  return parsed;
}

async function fetchProbe(url: string, signal: AbortSignal) {
  let response = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    signal,
    headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });

  if (response.status === 405 || response.status === 501) {
    await response.body?.cancel().catch(() => undefined);
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        range: "bytes=0-0",
      },
    });
  }

  return response;
}

async function probeUrl(rawUrl: string): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  let current: URL;

  try {
    current = assertPublicTarget(rawUrl);
  } catch {
    clearTimeout(timeout);
    return { status: "unavailable", responseMs: Date.now() - started, errorCode: "unsafe_target" };
  }

  let redirected = false;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetchProbe(current.toString(), controller.signal);
      const httpStatus = response.status;

      if (REDIRECT_STATUSES.has(httpStatus)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          return {
            status: "unavailable",
            httpStatus,
            finalUrl: current.toString(),
            responseMs: Date.now() - started,
            errorCode: "redirect_without_location",
          };
        }
        if (redirectCount === MAX_REDIRECTS) {
          return {
            status: "unavailable",
            httpStatus,
            finalUrl: current.toString(),
            responseMs: Date.now() - started,
            errorCode: "too_many_redirects",
          };
        }

        const next = new URL(location, current);
        try {
          current = assertPublicTarget(next.toString());
        } catch {
          return {
            status: "unavailable",
            httpStatus,
            finalUrl: next.toString(),
            responseMs: Date.now() - started,
            errorCode: "unsafe_redirect",
          };
        }
        redirected = true;
        continue;
      }

      await response.body?.cancel().catch(() => undefined);
      return {
        status: classifyHttpStatus(httpStatus, redirected),
        httpStatus,
        finalUrl: current.toString(),
        responseMs: Date.now() - started,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const status: HealthStatus = controller.signal.aborted
      ? "timeout"
      : message.includes("dns") || message.includes("resolve")
        ? "dns-error"
        : message.includes("tls") || message.includes("ssl") || message.includes("certificate")
          ? "tls-error"
          : "unavailable";
    return {
      status,
      finalUrl: current.toString(),
      responseMs: Date.now() - started,
      errorCode: controller.signal.aborted ? "timeout" : status,
    };
  } finally {
    clearTimeout(timeout);
  }

  return { status: "unavailable", responseMs: Date.now() - started, errorCode: "unknown" };
}

async function insertResult(db: HealthDatabase, bookmarkId: string, result: ProbeResult) {
  const id = crypto.randomUUID();
  const checkedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO health_checks
      (id, bookmark_id, status, http_status, final_url, response_ms, error_code, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      bookmarkId,
      result.status,
      result.httpStatus ?? null,
      result.finalUrl ?? null,
      result.responseMs,
      result.errorCode ?? null,
      checkedAt,
    )
    .run();

  await db.prepare("UPDATE bookmarks SET health_status = ? WHERE id = ?")
    .bind(result.status, bookmarkId)
    .run();

  const check: HealthCheck = {
    id,
    bookmarkId,
    status: result.status,
    ...(result.httpStatus == null ? {} : { httpStatus: result.httpStatus }),
    ...(result.finalUrl ? { finalUrl: result.finalUrl } : {}),
    responseMs: result.responseMs,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    checkedAt,
  };
  return check;
}

export async function checkBookmarkHealth(db: HealthDatabase, bookmarkId: string) {
  const bookmark = await db.prepare(
    "SELECT id, url, health_policy FROM bookmarks WHERE id = ? LIMIT 1",
  )
    .bind(bookmarkId)
    .first<BookmarkHealthRow>();

  if (!bookmark) return json({ error: { code: "bookmark_not_found", message: "Bookmark not found." } }, 404);
  if (bookmark.health_policy === "ignore" || bookmark.health_policy === "local-only") {
    return json({
      error: {
        code: "health_check_skipped",
        message: `Bookmarks with ${bookmark.health_policy} policy are not checked by the server.`,
      },
    }, 409);
  }

  const result = await probeUrl(bookmark.url);
  const check = await insertResult(db, bookmark.id, result);
  return json({ check });
}

export async function listBookmarkHealthChecks(db: HealthDatabase, bookmarkId: string) {
  const result = await db.prepare(
    `SELECT id, bookmark_id, status, http_status, final_url, response_ms, error_code, checked_at
       FROM health_checks
      WHERE bookmark_id = ?
      ORDER BY checked_at DESC
      LIMIT 20`,
  )
    .bind(bookmarkId)
    .all<HealthCheckRow>();

  return json({ checks: result.results.map(healthFromRow) });
}
