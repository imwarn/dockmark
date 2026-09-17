import type { Bookmark, Category } from "@dockmark/core";
import { getBookmarkMetadata, listBookmarks, listCategories, type BookmarkMetadata } from "./api";

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
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateReviewCandidate {
  id: string;
  kind: DuplicateCandidateKind;
  reason: string;
  evidenceUrl?: string;
  left: DuplicateReviewMember;
  right: DuplicateReviewMember;
}

export interface DuplicateReviewStats {
  totalBookmarks: number;
  analyzedBookmarks: number;
  metadataBookmarks: number;
  totalCandidates: number;
  canonicalCandidates: number;
  resolvedCandidates: number;
  normalizedCandidates: number;
  bookmarkAnalysisTruncated: boolean;
  candidateListTruncated: boolean;
}

export interface DuplicateReviewResult {
  candidates: DuplicateReviewCandidate[];
  stats: DuplicateReviewStats;
}

interface EvidenceRow {
  bookmark: Bookmark;
  categoryName?: string;
  metadata: BookmarkMetadata | null;
}

const MAX_ANALYZED_BOOKMARKS = 1000;
const MAX_RETURNED_CANDIDATES = 300;
const METADATA_CONCURRENCY = 12;
const trackingParams = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "_ga", "_gl"]);

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

function member(row: EvidenceRow): DuplicateReviewMember {
  const { bookmark, metadata } = row;
  return {
    id: bookmark.id,
    title: bookmark.title,
    url: bookmark.url,
    ...(bookmark.description ? { description: bookmark.description } : {}),
    categoryId: bookmark.categoryId,
    ...(row.categoryName ? { categoryName: row.categoryName } : {}),
    healthPolicy: bookmark.healthPolicy,
    healthStatus: bookmark.healthStatus,
    ...(metadata?.canonicalUrl ? { canonicalUrl: metadata.canonicalUrl } : {}),
    ...(metadata?.finalUrl ? { finalUrl: metadata.finalUrl } : {}),
    ...(metadata?.fetchedAt ? { metadataFetchedAt: metadata.fetchedAt } : {}),
    createdAt: bookmark.createdAt,
    updatedAt: bookmark.updatedAt,
  };
}

function orderedPair(left: EvidenceRow, right: EvidenceRow) {
  return left.bookmark.id.localeCompare(right.bookmark.id) <= 0 ? [left, right] as const : [right, left] as const;
}

function pairId(left: EvidenceRow, right: EvidenceRow) {
  return [left.bookmark.id, right.bookmark.id].sort().join("::");
}

function addCandidate(
  candidates: Map<string, DuplicateReviewCandidate>,
  leftRow: EvidenceRow,
  rightRow: EvidenceRow,
  kind: DuplicateCandidateKind,
  reason: string,
  evidenceUrl?: string,
) {
  if (leftRow.bookmark.id === rightRow.bookmark.id) return;
  const [left, right] = orderedPair(leftRow, rightRow);
  const id = pairId(left, right);
  const rank: Record<DuplicateCandidateKind, number> = { canonical: 3, resolved: 2, normalized: 1 };
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
  candidates: Map<string, DuplicateReviewCandidate>,
  rows: EvidenceRow[],
  kind: "canonical" | "resolved",
) {
  const groups = new Map<string, Map<string, { row: EvidenceRow; evidence: boolean; raw?: string }>>();
  for (const row of rows) {
    const currentKey = urlKey(row.bookmark.url, false);
    if (currentKey) {
      const group = groups.get(currentKey) ?? new Map();
      group.set(row.bookmark.id, { row, evidence: false });
      groups.set(currentKey, group);
    }
    const raw = kind === "canonical" ? row.metadata?.canonicalUrl : row.metadata?.finalUrl;
    const evidenceKey = urlKey(raw, false);
    if (evidenceKey) {
      const group = groups.get(evidenceKey) ?? new Map();
      group.set(row.bookmark.id, { row, evidence: true, raw });
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
        addCandidate(
          candidates,
          left.row,
          right.row,
          kind,
          kind === "canonical"
            ? "Saved page metadata points these bookmarks at the same canonical target."
            : "Saved metadata shows these bookmarks resolving to the same final target.",
          displayEvidenceUrl(left.evidence ? left.raw : right.raw),
        );
      }
    }
  }
}

function addNormalizedPairs(candidates: Map<string, DuplicateReviewCandidate>, rows: EvidenceRow[]) {
  const groups = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const key = urlKey(row.bookmark.url, true);
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

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

export async function getDuplicateReview(): Promise<DuplicateReviewResult> {
  const [bookmarks, categories] = await Promise.all([listBookmarks(), listCategories()]);
  const categoryById = new Map(categories.map((category: Category) => [category.id, category.name]));
  const analyzed = [...bookmarks]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_ANALYZED_BOOKMARKS);
  const metadata = await mapWithConcurrency(analyzed, METADATA_CONCURRENCY, async (bookmark) => {
    try {
      return await getBookmarkMetadata(bookmark.id);
    } catch {
      return null;
    }
  });
  const rows: EvidenceRow[] = analyzed.map((bookmark, index) => ({
    bookmark,
    ...(bookmark.categoryId && categoryById.get(bookmark.categoryId) ? { categoryName: categoryById.get(bookmark.categoryId) } : {}),
    metadata: metadata[index],
  }));

  const candidates = new Map<string, DuplicateReviewCandidate>();
  addMetadataEvidencePairs(candidates, rows, "canonical");
  addMetadataEvidencePairs(candidates, rows, "resolved");
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
      totalBookmarks: bookmarks.length,
      analyzedBookmarks: analyzed.length,
      metadataBookmarks: metadata.filter(Boolean).length,
      totalCandidates: allCandidates.length,
      canonicalCandidates: counts.canonical,
      resolvedCandidates: counts.resolved,
      normalizedCandidates: counts.normalized,
      bookmarkAnalysisTruncated: bookmarks.length > analyzed.length,
      candidateListTruncated: allCandidates.length > returned.length,
    },
  };
}
