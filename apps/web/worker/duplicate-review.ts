type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  all<T = unknown>(): Promise<{ results?: T[] }>;
}

export interface DuplicateReviewDatabase {
  prepare(query: string): D1PreparedStatementLike;
}

interface DuplicateRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  category_id: string | null;
  health_status: string;
  health_policy: string;
  canonical_url: string | null;
  final_url: string | null;
  fetched_at: string | null;
}

export type DuplicateEvidenceKind = "canonical" | "resolved" | "near-url";

export interface DuplicateReviewBookmark {
  id: string;
  title: string;
  url: string;
  description?: string;
  categoryId?: string;
  healthStatus: string;
  healthPolicy: string;
  canonicalUrl?: string;
  finalUrl?: string;
  metadataFetchedAt?: string;
}

export interface DuplicateSuggestion {
  id: string;
  kind: DuplicateEvidenceKind;
  evidenceUrl: string;
  left: DuplicateReviewBookmark;
  right: DuplicateReviewBookmark;
}

export class DuplicateReviewHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_SUGGESTIONS = 250;
const TRACKING_KEYS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function reviewFingerprint(raw: string | null) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase();
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");

    const params = Array.from(url.searchParams.entries())
      .filter(([key]) => !key.toLocaleLowerCase().startsWith("utm_") && !TRACKING_KEYS.has(key.toLocaleLowerCase()))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = "";
    for (const [key, value] of params) url.searchParams.append(key, value);
    return url.toString();
  } catch {
    return null;
  }
}

function bookmarkFromRow(row: DuplicateRow): DuplicateReviewBookmark {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    ...(row.description ? { description: row.description } : {}),
    ...(row.category_id ? { categoryId: row.category_id } : {}),
    healthStatus: row.health_status,
    healthPolicy: row.health_policy,
    ...(row.canonical_url ? { canonicalUrl: row.canonical_url } : {}),
    ...(row.final_url ? { finalUrl: row.final_url } : {}),
    ...(row.fetched_at ? { metadataFetchedAt: row.fetched_at } : {}),
  };
}

function pairId(kind: DuplicateEvidenceKind, leftId: string, rightId: string) {
  const [first, second] = [leftId, rightId].sort();
  return `${kind}:${first}:${second}`;
}

function addPair(
  output: Map<string, DuplicateSuggestion>,
  kind: DuplicateEvidenceKind,
  evidenceUrl: string,
  left: DuplicateRow,
  right: DuplicateRow,
) {
  if (left.id === right.id) return;
  const ids = [left.id, right.id].sort();
  const stableKey = `${ids[0]}:${ids[1]}`;
  const priority: Record<DuplicateEvidenceKind, number> = { canonical: 3, resolved: 2, "near-url": 1 };
  const existing = output.get(stableKey);
  if (existing && priority[existing.kind] >= priority[kind]) return;

  const ordered = left.id === ids[0] ? [left, right] : [right, left];
  output.set(stableKey, {
    id: pairId(kind, ordered[0].id, ordered[1].id),
    kind,
    evidenceUrl,
    left: bookmarkFromRow(ordered[0]),
    right: bookmarkFromRow(ordered[1]),
  });
}

function addBucketPairs(
  output: Map<string, DuplicateSuggestion>,
  kind: DuplicateEvidenceKind,
  buckets: Map<string, DuplicateRow[]>,
) {
  for (const [evidenceUrl, rows] of buckets) {
    const limited = rows.slice(0, 25);
    for (let left = 0; left < limited.length; left += 1) {
      for (let right = left + 1; right < limited.length; right += 1) {
        addPair(output, kind, evidenceUrl, limited[left], limited[right]);
      }
    }
  }
}

function pushBucket(map: Map<string, DuplicateRow[]>, key: string | null, row: DuplicateRow) {
  if (!key) return;
  const current = map.get(key) ?? [];
  current.push(row);
  map.set(key, current);
}

async function duplicateSuggestions(db: DuplicateReviewDatabase) {
  const result = await db.prepare(
    `SELECT b.id,
            b.title,
            b.url,
            b.description,
            b.category_id,
            b.health_status,
            b.health_policy,
            m.canonical_url,
            m.final_url,
            m.fetched_at
       FROM bookmarks b
       LEFT JOIN bookmark_metadata m ON m.bookmark_id = b.id
      ORDER BY b.id ASC`,
  ).all<DuplicateRow>();
  const rows = result.results ?? [];
  const byOriginal = new Map<string, DuplicateRow[]>();
  const byCanonical = new Map<string, DuplicateRow[]>();
  const byFinal = new Map<string, DuplicateRow[]>();

  for (const row of rows) {
    pushBucket(byOriginal, reviewFingerprint(row.url), row);
    pushBucket(byCanonical, reviewFingerprint(row.canonical_url), row);
    pushBucket(byFinal, reviewFingerprint(row.final_url), row);
  }

  const suggestions = new Map<string, DuplicateSuggestion>();
  addBucketPairs(suggestions, "canonical", byCanonical);

  for (const [target, canonicalRows] of byCanonical) {
    for (const canonicalRow of canonicalRows) {
      for (const originalRow of byOriginal.get(target) ?? []) addPair(suggestions, "canonical", target, canonicalRow, originalRow);
    }
  }

  addBucketPairs(suggestions, "resolved", byFinal);
  for (const [target, finalRows] of byFinal) {
    for (const finalRow of finalRows) {
      for (const originalRow of byOriginal.get(target) ?? []) addPair(suggestions, "resolved", target, finalRow, originalRow);
    }
  }

  addBucketPairs(suggestions, "near-url", byOriginal);

  const priority: Record<DuplicateEvidenceKind, number> = { canonical: 3, resolved: 2, "near-url": 1 };
  const ordered = Array.from(suggestions.values())
    .sort((left, right) => priority[right.kind] - priority[left.kind] || left.evidenceUrl.localeCompare(right.evidenceUrl))
    .slice(0, MAX_SUGGESTIONS);

  return {
    scanned: rows.length,
    metadataBacked: rows.filter((row) => Boolean(row.canonical_url || row.final_url)).length,
    suggestions: ordered,
    truncated: suggestions.size > MAX_SUGGESTIONS,
  };
}

export async function handleDuplicateReviewApi(
  request: Request,
  db: DuplicateReviewDatabase,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/library/duplicates") return null;
  if (request.method !== "GET") {
    throw new DuplicateReviewHttpError(405, "method_not_allowed", "Duplicate review only supports GET.");
  }
  return json(await duplicateSuggestions(db));
}
