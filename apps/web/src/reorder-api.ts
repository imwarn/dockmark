interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

async function request(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => ({}))) as ErrorEnvelope;
  throw new Error(payload.error?.message ?? `Request failed with status ${response.status}.`);
}

export function reorderCategories(ids: string[]) {
  return request("/api/categories/reorder", { ids });
}

export function reorderBookmarks(categoryId: string | null, ids: string[]) {
  return request("/api/bookmarks/reorder", { categoryId, ids });
}
