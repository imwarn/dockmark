import type {
  Bookmark,
  Category,
  CreateBookmarkInput,
  CreateCategoryInput,
  CreateSearchEngineInput,
  CreateSessionInput,
  CreateSessionItemInput,
  CreateWorkspaceInput,
  CreateWorkspaceItemInput,
  HealthCheck,
  SearchEngine,
  SessionItem,
  SessionWithItems,
  UpdateBookmarkInput,
  UpdateCategoryInput,
  UpdateSearchEngineInput,
  UpdateSessionInput,
  UpdateSessionItemInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceItemInput,
  WorkspaceItem,
  WorkspaceWithItems,
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

export interface BookmarkMetadata {
  bookmarkId: string;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  iconUrl?: string;
  imageUrl?: string;
  finalUrl?: string;
  fetchedAt: string;
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

export async function getBookmarkMetadata(id: string) {
  const response = await request<{ metadata: BookmarkMetadata | null }>(
    `/api/bookmarks/${encodeURIComponent(id)}/metadata`,
  );
  return response.metadata;
}

export async function refreshBookmarkMetadata(id: string) {
  const response = await request<{ metadata: BookmarkMetadata }>(
    `/api/bookmarks/${encodeURIComponent(id)}/metadata`,
    { method: "POST" },
  );
  return response.metadata;
}

export async function listWorkspaces() {
  const response = await request<{ workspaces: WorkspaceWithItems[] }>("/api/workspaces");
  return response.workspaces;
}

export async function createWorkspace(input: CreateWorkspaceInput) {
  const response = await request<{ workspace: WorkspaceWithItems }>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.workspace;
}

export async function updateWorkspace(id: string, input: UpdateWorkspaceInput) {
  const response = await request<{ workspace: WorkspaceWithItems }>(
    `/api/workspaces/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return response.workspace;
}

export async function deleteWorkspace(id: string) {
  await request<void>(`/api/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createWorkspaceItem(workspaceId: string, input: CreateWorkspaceItemInput) {
  const response = await request<{ item: WorkspaceItem }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/items`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return response.item;
}

export async function updateWorkspaceItem(
  workspaceId: string,
  itemId: string,
  input: UpdateWorkspaceItemInput,
) {
  const response = await request<{ item: WorkspaceItem }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(itemId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return response.item;
}

export async function deleteWorkspaceItem(workspaceId: string, itemId: string) {
  await request<void>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
  );
}

export async function listSessions() {
  const response = await request<{ sessions: SessionWithItems[] }>("/api/sessions");
  return response.sessions;
}

export async function createSession(input: CreateSessionInput) {
  const response = await request<{ session: SessionWithItems }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.session;
}

export async function updateSession(id: string, input: UpdateSessionInput) {
  const response = await request<{ session: SessionWithItems }>(
    `/api/sessions/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return response.session;
}

export async function deleteSession(id: string) {
  await request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createSessionItem(sessionId: string, input: CreateSessionItemInput) {
  const response = await request<{ item: SessionItem }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/items`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return response.item;
}

export async function updateSessionItem(
  sessionId: string,
  itemId: string,
  input: UpdateSessionItemInput,
) {
  const response = await request<{ item: SessionItem }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return response.item;
}

export async function deleteSessionItem(sessionId: string, itemId: string) {
  await request<void>(
    `/api/sessions/${encodeURIComponent(sessionId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
  );
}

export async function listSearchEngines() {
  const response = await request<{ engines: SearchEngine[] }>("/api/search-engines");
  return response.engines;
}

export async function createSearchEngine(input: CreateSearchEngineInput) {
  const response = await request<{ engine: SearchEngine }>("/api/search-engines", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.engine;
}

export async function updateSearchEngine(id: string, input: UpdateSearchEngineInput) {
  const response = await request<{ engine: SearchEngine }>(
    `/api/search-engines/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return response.engine;
}

export async function deleteSearchEngine(id: string) {
  await request<void>(`/api/search-engines/${encodeURIComponent(id)}`, { method: "DELETE" });
}
