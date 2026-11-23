/**
 * [INPUT]: calls GET /api/library/duplicates via fetch
 * [OUTPUT]: exports getDuplicateReview and normalized duplicate review response/member types (including bookmark tags)
 * [POS]: Web API client for DuplicateReviewPage and DuplicateCandidateCard in apps/web/src
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

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

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

function normalizeMember(member: DuplicateReviewMember): DuplicateReviewMember {
  const rawTags = (member as { tags?: unknown }).tags;
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  return { ...member, tags };
}

export async function getDuplicateReview(): Promise<DuplicateReviewResult> {
  const response = await fetch("/api/library/duplicates", {
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as DuplicateReviewResult & ErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Duplicate review failed with status ${response.status}.`);
  }
  return {
    ...payload,
    candidates: (payload.candidates ?? []).map((candidate) => ({
      ...candidate,
      left: normalizeMember(candidate.left),
      right: normalizeMember(candidate.right),
    })),
  };
}
