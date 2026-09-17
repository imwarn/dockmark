type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface DuplicateReviewDatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
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

type CandidateKind = "canonical" | "resolved" | "normalized";

interface DuplicateRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  health_policy: string;
  health_status: string;
  created_at: string;
  updated_at: string;
  canonical_url: string | null;
  final_url: string | null;
  metadata_fetched_at: string | null;
}

interface DuplicateMember {
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
  createdAt: string;
  updatedAt: string;
}

interface Candidate {
  id: string;
  kind: CandidateKind;
  reason: string;
  evidenceUrl?: string;
  left: DuplicateMember;
  right: DuplicateMember;
}

const MAX_ANALYZED_BOOKMARKS = 2000;
const MAX_RETURNED_CANDIDATES = 300;
const trackingParams = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "_ga", "_gl",
]);

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function isTrackingParam(name: string) {
  const normalized = name.toLocaleLowerCase();
  return normalized.startsWith("utm_") || trackingParams.has(normalized);
}

function urlKey(raw: string | null | undefined, stripTracking: boolean) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    let hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, "");
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    let pathname = url.pathname || "/";
    pathname = pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    const params = new URLSearchParams(url.search);
    if (stripTracking) {
      for (const key of Array.from(params.keys())) {
        if (isTrackingParam(key)) params.delete(key);
      }
    }
    params.sort();
    const query = params.toString();
    return `${hostname}${url.port ? `:${url.port}` : ""}${pathname}${query ? `?${query}` : ""}`;
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

function member(row: DuplicateRow): DuplicateMember {
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
    ...(row.metadata_fetched_at ? { metadataFetchedAt: row.metadata_fetched_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pairId(left: DuplicateRow, right: DuplicateRow) {
  return [left.id, right.id].sort().join("::");
}

function orderedPair(left: DuplicateRow, right: DuplicateRow) {
  return left.id.localeCompare(right.id) <= 0 ? [left, right] as const : [right, left] as const;
}

function addCandidate(
  candidates: Map<string, Candidate>,
  leftRow: DuplicateRow,
  rightRow: DuplicateRow,
  kind: CandidateKind,
  reason: string,
  evidenceUrl?: string,
) {
  if (leftRow.id === rightRow.id) return;
  const [left, right] = orderedPair(leftRow, rightRow);
  const id = pairId(left, right);
  const rank: Record<CandidateKind, number> = { canonical: 3, resolved: 2, normalized: 1 };
  const current = candidates.get(id);
  if (current && rank[current.kind] >= rank[kind]) return;
  candidates.set(id, {
    id,
    kind,
    reason,
    ...(evidenceUrl ? { evidenceUrl } : {}),
    left: member(left),
    right: member(right),
  });
}

function addMetadataEvidencePairs(
  candidates: Map<string, Candidate>,
  rows: DuplicateRow[],
  kind: "canonical" | "resolved",
) {
  const groups = new Map<string, Map<string, { row: DuplicateRow; evidence: boolean; raw?: string }>>();
  for (const row of rows) {
    const currentKey = urlKey(row.url, false);
    if (currentKey) {
      const group = groups.get(currentKey) ?? new Map();
      group.set(row.id, { row, evidence: false });
      groups.set(currentKey, group);
    }
    const raw = kind === "canonical" ? row.canonical_url : row.final_url;
    const evidenceKey = urlKey(raw, false);
    if (evidenceKey) {
      const group = groups.get(evidenceKey) ?? new Map();
      const prior = group.get(row.id);
      group.set(row.id, { row, evidence: true, raw: raw ?? prior?.raw });
      groups.set(evidenceKey, group);
    }
  }

  for (const group of groups.values()) {
    const entries = Array.from(group.values());
    if (entries.length < 2 || !entries.some((entry) => entry.evidence)) continue;
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        if (!left.evidence && !right.evidence) continue;
        const rawEvidence = left.evidence ? left.raw : right.raw;
        addCandidate(
          candidates,
          left.row,
          right.row,
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

function addNormalizedPairs(candidates: Map<string, Candidate>, rows: DuplicateRow[]) {
  const groups = new Map<string, DuplicateRow[]>();
  for (const row of rows) {
    const key = urlKey(row.url, true);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        addCandidate(
          candidates,
          group[leftIndex],
          group[rightIndex],
          "normalized",
          "The URLs become equivalent after ignoring protocol/www, fragments, trailing slashes and known tracking parameters.",
        );
      }
    }
  }
}

async function analyze(db: DuplicateReviewDatabaseLike) {
  const [countRow, result] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM bookmarks").first<{ count: number }>(),
    db.prepare(
      `SELECT
        b.id, b.title, b.url, b.description, b.category_id,
        c.name AS category_name,
        b.health_policy, b.health_status, b.created_at, b.updated_at,
        m.canonical_url, m.final_url, m.fetched_at AS metadata_fetched_at
      FROM bookmarks b
      LEFT JOIN categories c ON c.id = b.category_id
      LEFT JOIN bookmark_metadata m ON m.bookmark_id = b.id
      ORDER BY b.updated_at DESC, b.id ASC
      LIMIT ?`,
    ).bind(MAX_ANALYZED_BOOKMARKS).all<DuplicateRow>(),
  ]);

  const rows = result.results;
  const candidates = new Map<string, Candidate>();
  addMetadataEvidencePairs(candidates, rows, "canonical");
  addMetadataEvidencePairs(candidates, rows, "resolved");
  addNormalizedPairs(candidates, rows);

  const rank: Record<CandidateKind, number> = { canonical: 3, resolved: 2, normalized: 1 };
  const allCandidates = Array.from(candidates.values()).sort((left, right) => {
    const byKind = rank[right.kind] - rank[left.kind];
    if (byKind) return byKind;
    return left.left.title.localeCompare(right.left.title);
  });
  const returned = allCandidates.slice(0, MAX_RETURNED_CANDIDATES);
  const kindCounts = allCandidates.reduce(
    (counts, candidate) => ({ ...counts, [candidate.kind]: counts[candidate.kind] + 1 }),
    { canonical: 0, resolved: 0, normalized: 0 } as Record<CandidateKind, number>,
  );
  const totalBookmarks = Number(countRow?.count ?? rows.length);
  const metadataBookmarks = rows.filter((row) => Boolean(row.metadata_fetched_at)).length;

  return {
    candidates: returned,
    stats: {
      totalBookmarks,
      analyzedBookmarks: rows.length,
      metadataBookmarks,
      totalCandidates: allCandidates.length,
      canonicalCandidates: kindCounts.canonical,
      resolvedCandidates: kindCounts.resolved,
      normalizedCandidates: kindCounts.normalized,
      bookmarkAnalysisTruncated: totalBookmarks > rows.length,
      candidateListTruncated: allCandidates.length > returned.length,
    },
  };
}

export async function handleDuplicateReviewApi(
  request: Request,
  db: DuplicateReviewDatabaseLike,
  pathname: string,
) {
  if (pathname !== "/api/library/duplicates") return null;
  if (request.method.toUpperCase() !== "GET") {
    throw new DuplicateReviewHttpError(405, "method_not_allowed", "Duplicate review is read-only.");
  }
  return json(await analyze(db));
}
