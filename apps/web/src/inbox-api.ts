import type { HealthPolicy, HealthStatus } from "@dockmark/core";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface InboxBookmark {
  id: string;
  categoryId?: string;
  categoryName?: string;
  title: string;
  url: string;
  description?: string;
  iconUrl?: string;
  healthPolicy: HealthPolicy;
  healthStatus: HealthStatus;
  position: number;
  inboxAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InboxReviewPatch {
  bookmarkId: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  tags: string[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return payload;
}

export async function listInbox() {
  const response = await request<{ bookmarks: InboxBookmark[] }>("/api/inbox");
  return response.bookmarks;
}

export async function resolveInboxBookmark(id: string, categoryId?: string | null) {
  const response = await request<{ bookmark: Omit<InboxBookmark, "inboxAt"> }>(
    `/api/inbox/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(categoryId === undefined ? {} : { categoryId }),
    },
  );
  return response.bookmark;
}

export async function reviewInboxBatch(patches: InboxReviewPatch[]) {
  if (!patches.length) throw new Error("Select at least one reviewed Inbox suggestion to file.");
  if (patches.length > 20) throw new Error("Reviewed Inbox filing is limited to 20 bookmarks per request.");
  return request<{ applied: number; bookmarkIds: string[] }>("/api/inbox/review-batch", {
    method: "POST",
    body: JSON.stringify({ patches }),
  });
}
