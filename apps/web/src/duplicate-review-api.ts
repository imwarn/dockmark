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

export async function getDuplicateReview(): Promise<DuplicateReviewResult> {
  const response = await fetch("/api/library/duplicates", {
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as DuplicateReviewResult & ErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Duplicate review failed with status ${response.status}.`);
  }
  return payload;
}
