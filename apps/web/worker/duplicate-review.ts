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
  category_name: string | null;
  health_status: string;
  health_policy: string;
  canonical_url: string | null;
  final_url: string | null;
  fetched_at: string | null;
}

export type DuplicateCandidateKind = "canonical" | "resolved" | "normalized";

export interface DuplicateReviewMember {
  id: string;
  title: string;
  url: string;
  description?: string;
  categoryId: string | null;
  categoryName?: string;
  healthPolicy: string;
  healthStatus: string;
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
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
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

function reviewFingerprint(raw: string | null) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    let hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, "");
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    let pathname = url.pathname || "/";
    pathname = pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");

    const params = Array.from(url.searchParams.entries())
      .filter(([key]) => {
        const normalized = key.toLocaleLowerCase();
        return !normalized.startsWith("utm_") && !TRACKING_KEYS.has(normalized);
      })
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    const query = new URLSearchParams(params).toString();
    const port = url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))
      ? `:${url.port}`
      : "";
    return `${hostname}${port}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function displayEvidenceUrl(raw: string | null | undefined) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function member(row: DuplicateRow): DuplicateReviewMember {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    ...(row.description ? { description: row.description } : {}),
    categoryId: row.category_id,
    ...(row.category_name ? { categoryName: row.category_name } : {}),
    healthPolicy: row.health_policy,
    healthStatus: row.health_status,
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
    left: member(left),
    right: member(right),
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
      for (let right = left + 1; right < group.length; right += 1) {
        const leftHasEvidence = evidenceRows.some((row) => row.id === group[left].id);
        const rightHasEvidence = evidenceRows.some((row) => row.id === group[right].id);
        if (!leftHasEvidence && !rightHasEvidence) continue;
        const rawEvidence = kind === "canonical"
          ? (group[left].canonical_url ?? group[right].canonical_url)
          : (group[left].final_url ?? group[right].final_url);
        addCandidate(
          candidates,
          group[left],
          group[right],
          kind,
          kind === "canonical"
            ? "Saved page metadata points these bookmarks at the same canonical target."
            : "Saved metadata shows these bookmarks resolving to the same final target.",
          displayEvidenceUrl(rawEvidence),
        );
      }
    }
  }
}

function addNormalizedPairs(candidates: Map<string, DuplicateReviewCandidate>, rows: DuplicateRow[]) {
  const groups = new Map<string, DuplicateRow[]>();
  for (const row of rows) pushBucket(groups, reviewFingerprint(row.url), row);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        addCandidate(
          candidates,
          group[left],
          group[right],
          "normalized",
          "The URLs become equivalent after ignoring protocol/www, fragments, trailing slashes and known tracking parameters.",
        );
      }
    }
  }
}

async function duplicateReview(db: DuplicateReviewDatabase) {
  const result = await db.prepare(
    `SELECT b.id,
            b.title,
            b.url,
            b.description,
            b.category_id,
            c.name AS category_name,
            b.health_status,
            b.health_policy,
            m.canonical_url,
            m.final_url,
            m.fetched_at
       FROM bookmarks b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN bookmark_metadata m ON m.bookmark_id = b.id
      ORDER BY b.updated_at DESC, b.id ASC`,
  ).all<DuplicateRow>();
  const rows = result.results ?? [];
  const candidates = new Map<string, DuplicateReviewCandidate>();
  addMetadataPairs(candidates, rows, "canonical");
  addMetadataPairs(candidates, rows, "resolved");
  addNormalizedPairs(candidates, rows);

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
