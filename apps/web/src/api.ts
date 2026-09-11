import type {
  Bookmark,
  Category,
  CreateBookmarkInput,
  CreateCategoryInput,
  HealthCheck,
  UpdateBookmarkInput,
  UpdateCategoryInput,
} from "@dockmark/core";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");

  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? "request_failed",
      payload.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }

  return payload;
}

export async function listCategories() {
  const response = await request<{ categories: Category[] }>("/api/categories");
  return response.categories;
}

export async function createCategory(input: CreateCategoryInput) {
  const response = await request<{ category: Category }>("/api/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.category;
}

export async function updateCategory(id: string, input: UpdateCategoryInput) {
  const response = await request<{ category: Category }>(`/api/categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return response.category;
}

export async function deleteCategory(id: string) {
  await request<void>(`/api/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listBookmarks() {
  const response = await request<{ bookmarks: Bookmark[] }>("/api/bookmarks");
  return response.bookmarks;
}

export async function createBookmark(input: CreateBookmarkInput) {
  const response = await request<{ bookmark: Bookmark }>("/api/bookmarks", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.bookmark;
}

export async function updateBookmark(id: string, input: UpdateBookmarkInput) {
  const response = await request<{ bookmark: Bookmark }>(`/api/bookmarks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return response.bookmark;
}

export async function deleteBookmark(id: string) {
  await request<void>(`/api/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function checkBookmarkHealth(id: string) {
  const response = await request<{ check: HealthCheck }>(
    `/api/bookmarks/${encodeURIComponent(id)}/check`,
    { method: "POST" },
  );
  return response.check;
}

export async function listBookmarkHealthChecks(id: string) {
  const response = await request<{ checks: HealthCheck[] }>(
    `/api/bookmarks/${encodeURIComponent(id)}/health`,
  );
  return response.checks;
}
