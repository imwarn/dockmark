/**
 * [INPUT]: depends on D1 bookmarks, categories, bookmark_metadata, bookmark_tags, and tags tables via DuplicateReviewDatabase
 * [OUTPUT]: exports handleDuplicateReviewApi, reviewFingerprint, DuplicateReviewHttpError, and DuplicateReview types
 * [POS]: Worker handler for GET /api/library/duplicates; detects canonical, resolved, and normalized URL duplicates with active bookmark tags while preserving SPA hash routes
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

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
  icon_url: string | null;
  category_id: string | null;
  category_name: string | null;
  health_status: string;
  health_policy: string;
  created_at: string;
  updated_at: string;
  canonical_url: string | null;
  final_url: string | null;
  fetched_at: string | null;
}

interface BookmarkTagRow {
  bookmark_id: string;
  name: string;
}

export type DuplicateCandidateKind = "canonical" | "resolved" | "normalized";

export interface DuplicateReviewMember {
  id: string;
  title: string;
  url: string;
  description?: string;
  iconUrl?: string;
  categoryId: string | null;
  categoryName?: string;
  healthPolicy: string;
  healthStatus: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  canonicalUrl?: string;
  finalUrl?: string;
  metadataFetchedAt?: string;
}

export interface DuplicateReviewCandidate {
  id: string;
  kind: DuplicateCandidateKind;
  reason: string;
  evidenceUrl?: string;
  left: DuplicateReviewMember;
  right: DuplicateReviewMember;
}

export class DuplicateReviewHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_RETURNED_CANDIDATES = 300;
const MAX_BUCKET_MEMBERS = 25;
const TRACKING_KEYS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "_ga", "_gl"]);

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function normalizeQueryParams(params: URLSearchParams): string {
  const entries = Array.from(params.entries())
    .filter(([key]) => {
      const normalized = key.toLocaleLowerCase();
      return !normalized.startsWith("utm_") && !TRACKING_KEYS.has(normalized);
    })
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return new URLSearchParams(entries).toString();
}

function normalizeSpaHashRoute(hash: string): string {
  if (!hash.startsWith("#/") && !hash.startsWith("#!/")) return "";
  const stripped = hash.startsWith("#!/") ? hash.slice(2) : hash.slice(1);
  const queryStart = stripped.indexOf("?");
  const rawPath = queryStart >= 0 ? stripped.slice(0, queryStart) : stripped;
  const rawQuery = queryStart >= 0 ? stripped.slice(queryStart + 1) : "";
  let hashPath = rawPath.replace(/\/{2,}/g, "/");
  if (!hashPath.startsWith("/")) hashPath = `/${hashPath}`;
  if (hashPath.length > 1) hashPath = hashPath.replace(/\/+$/, "");
  const hashQuery = rawQuery ? normalizeQueryParams(new URLSearchParams(rawQuery)) : "";
  return `#${hashPath}${hashQuery ? `?${hashQuery}` : ""}`;
}

export function reviewFingerprint(raw: string | null) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    let hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, "");
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    let pathname = url.pathname || "/";
    pathname = pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");

    const query = normalizeQueryParams(url.searchParams);
    const port = url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))
      ? `:${url.port}`
      : "";
    const hashRoute = normalizeSpaHashRoute(url.hash);
    return `${hostname}${port}${pathname}${query ? `?${query}` : ""}${hashRoute}`;
  } catch {
    return null;
  }
}

function displayEvidenceUrl(raw: string | null | undefined) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.hash.startsWith("#/") && !url.hash.startsWith("#!/")) {
      url.hash = "";
    }
    return url.toString();
  } catch {
    return raw;
  }
}

function member(row: DuplicateRow, tagsByBookmarkId: Map<string, string[]>): DuplicateReviewMember {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    ...(row.description ? { description: row.description } : {}),
    ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
    categoryId: row.category_id,
    ...(row.category_name ? { categoryName: row.category_name } : {}),
    healthPolicy: row.health_policy,
    healthStatus: row.health_status,
    tags: tagsByBookmarkId.get(row.id) ?? [],
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    ...(row.canonical_url ? { canonicalUrl: row.canonical_url } : {}),
    ...(row.final_url ? { finalUrl: row.final_url } : {}),
    ...(row.fetched_at ? { metadataFetchedAt: row.fetched_at } : {}),
  };
}

function stablePairKey(left: DuplicateRow, right: DuplicateRow) {
  return [left.id, right.id].sort().join("::");
}

function addCandidate(
  candidates: Map<string, DuplicateReviewCandidate>,
  leftRow: DuplicateRow,
  rightRow: DuplicateRow,
  kind: DuplicateCandidateKind,
  reason: string,
  tagsByBookmarkId: Map<string, string[]>,
  evidenceUrl?: string,
) {
  if (leftRow.id === rightRow.id) return;
  const rank: Record<DuplicateCandidateKind, number> = { canonical: 3, resolved: 2, normalized: 1 };
  const key = stablePairKey(leftRow, rightRow);
  const current = candidates.get(key);
  if (current && rank[current.kind] >= rank[kind]) return;
  const [left, right] = leftRow.id.localeCompare(rightRow.id) <= 0 ? [leftRow, rightRow] : [rightRow, leftRow];
  candidates.set(key, {
    id: key,
    kind,
    reason,
    ...(evidenceUrl ? { evidenceUrl } : {}),
    left: member(left, tagsByBookmarkId),
    right: member(right, tagsByBookmarkId),
  });
}

function pushBucket(map: Map<string, DuplicateRow[]>, key: string | null, row: DuplicateRow) {
  if (!key) return;
  const current = map.get(key) ?? [];
  if (current.length < MAX_BUCKET_MEMBERS) current.push(row);
  map.set(key, current);
}

function addMetadataPairs(
  candidates: Map<string, DuplicateReviewCandidate>,
  rows: DuplicateRow[],
  kind: "canonical" | "resolved",
  tagsByBookmarkId: Map<string, string[]>,
) {
  const originals = new Map<string, DuplicateRow[]>();
  const evidence = new Map<string, DuplicateRow[]>();
  for (const row of rows) {
    pushBucket(originals, reviewFingerprint(row.url), row);
    pushBucket(evidence, reviewFingerprint(kind === "canonical" ? row.canonical_url : row.final_url), row);
  }

  for (const [target, evidenceRows] of evidence) {
    const combined = new Map<string, DuplicateRow>();
    for (const row of evidenceRows) combined.set(row.id, row);
    for (const row of originals.get(target) ?? []) combined.set(row.id, row);
    const group = Array.from(combined.values()).slice(0, MAX_BUCKET_MEMBERS);
    if (group.length < 2) continue;
    for (let left = 0; left < group.length; left += 1) {
      const leftRow = group[left];
      if (!leftRow) continue;
      for (let right = left + 1; right < group.length; right += 1) {
        const rightRow = group[right];
        if (!rightRow) continue;
        const leftHasEvidence = evidenceRows.some((row) => row.id === leftRow.id);
        const rightHasEvidence = evidenceRows.some((row) => row.id === rightRow.id);
        if (!leftHasEvidence && !rightHasEvidence) continue;
        const rawEvidence = kind === "canonical"
          ? (leftRow.canonical_url ?? rightRow.canonical_url)
          : (leftRow.final_url ?? rightRow.final_url);
        addCandidate(
          candidates,
          leftRow,
          rightRow,
          kind,
          kind === "canonical"
            ? "Saved page metadata points these bookmarks at the same canonical target."
            : "Saved metadata shows these bookmarks resolving to the same final target.",
          tagsByBookmarkId,
          displayEvidenceUrl(rawEvidence),
        );
      }
    }
  }
}

function addNormalizedPairs(
  candidates: Map<string, DuplicateReviewCandidate>,
  rows: DuplicateRow[],
  tagsByBookmarkId: Map<string, string[]>,
) {
  const groups = new Map<string, DuplicateRow[]>();
  for (const row of rows) pushBucket(groups, reviewFingerprint(row.url), row);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let left = 0; left < group.length; left += 1) {
      const leftRow = group[left];
      if (!leftRow) continue;
      for (let right = left + 1; right < group.length; right += 1) {
        const rightRow = group[right];
        if (!rightRow) continue;
        addCandidate(
          candidates,
          leftRow,
          rightRow,
          "normalized",
          "The URLs become equivalent after ignoring protocol/www, fragments, trailing slashes and known tracking parameters.",
          tagsByBookmarkId,
        );
      }
    }
  }
}

async function duplicateReview(db: DuplicateReviewDatabase) {
  const [result, tagResult] = await Promise.all([
    db.prepare(
      `SELECT b.id,
              b.title,
              b.url,
              b.description,
              b.icon_url,
              b.category_id,
              c.name AS category_name,
              b.health_status,
              b.health_policy,
              b.created_at,
              b.updated_at,
              m.canonical_url,
              m.final_url,
              m.fetched_at
         FROM bookmarks b
         LEFT JOIN categories c ON c.id = b.category_id
         LEFT JOIN bookmark_metadata m ON m.bookmark_id = b.id
        WHERE b.archived_at IS NULL
        ORDER BY b.updated_at DESC, b.id ASC`,
    ).all<DuplicateRow>(),
    db.prepare(
      `SELECT bt.bookmark_id, t.name
         FROM bookmark_tags bt
         JOIN bookmarks b ON b.id = bt.bookmark_id
         JOIN tags t ON t.id = bt.tag_id
        WHERE b.archived_at IS NULL
        ORDER BY bt.bookmark_id ASC, t.name COLLATE NOCASE ASC`,
    ).all<BookmarkTagRow>(),
  ]);

  const rows = result?.results ?? [];
  const tagsByBookmarkId = new Map<string, string[]>();
  for (const tagRow of tagResult?.results ?? []) {
    if (typeof tagRow?.bookmark_id !== "string" || typeof tagRow?.name !== "string") continue;
    const trimmed = tagRow.name.trim();
    if (!trimmed) continue;
    const list = tagsByBookmarkId.get(tagRow.bookmark_id);
    if (list) list.push(trimmed);
    else tagsByBookmarkId.set(tagRow.bookmark_id, [trimmed]);
  }

  const candidates = new Map<string, DuplicateReviewCandidate>();
  addMetadataPairs(candidates, rows, "canonical", tagsByBookmarkId);
  addMetadataPairs(candidates, rows, "resolved", tagsByBookmarkId);
  addNormalizedPairs(candidates, rows, tagsByBookmarkId);

  const rank: Record<DuplicateCandidateKind, number> = { canonical: 3, resolved: 2, normalized: 1 };
  const allCandidates = Array.from(candidates.values()).sort((left, right) => {
    const byKind = rank[right.kind] - rank[left.kind];
    if (byKind) return byKind;
    return left.left.title.localeCompare(right.left.title);
  });
  const returned = allCandidates.slice(0, MAX_RETURNED_CANDIDATES);
  const counts = allCandidates.reduce(
    (current, candidate) => ({ ...current, [candidate.kind]: current[candidate.kind] + 1 }),
    { canonical: 0, resolved: 0, normalized: 0 } as Record<DuplicateCandidateKind, number>,
  );

  return {
    candidates: returned,
    stats: {
      totalBookmarks: rows.length,
      analyzedBookmarks: rows.length,
      metadataBookmarks: rows.filter((row) => Boolean(row.fetched_at)).length,
      totalCandidates: allCandidates.length,
      canonicalCandidates: counts.canonical,
      resolvedCandidates: counts.resolved,
      normalizedCandidates: counts.normalized,
      bookmarkAnalysisTruncated: false,
      candidateListTruncated: allCandidates.length > returned.length,
    },
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
  return json(await duplicateReview(db));
}
