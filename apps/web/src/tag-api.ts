interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return payload;
}

export async function listBookmarkTags() {
  const response = await request<{ bookmarkTags: Record<string, string[]> }>("/api/bookmark-tags");
  return response.bookmarkTags;
}

export async function replaceBookmarkTags(bookmarkId: string, tags: string[]) {
  const response = await request<{ bookmarkId: string; tags: string[] }>(
    `/api/bookmarks/${encodeURIComponent(bookmarkId)}/tags`,
    {
      method: "PUT",
      body: JSON.stringify({ tags }),
    },
  );
  return response.tags;
}
