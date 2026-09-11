export type Id = string;

export type HealthPolicy = "normal" | "ignore" | "local-only" | "manual";

export type HealthStatus =
  | "unknown"
  | "healthy"
  | "redirected"
  | "auth-required"
  | "forbidden"
  | "rate-limited"
  | "timeout"
  | "dns-error"
  | "tls-error"
  | "unavailable"
  | "local-only"
  | "ignored";

export interface HealthCheck {
  id: Id;
  bookmarkId: Id;
  status: HealthStatus;
  httpStatus?: number;
  finalUrl?: string;
  responseMs?: number;
  errorCode?: string;
  checkedAt: string;
}

export interface Category {
  id: Id;
  name: string;
  icon?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryInput {
  name: string;
  icon?: string;
  position?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string | null;
  position?: number;
}

export interface Bookmark {
  id: Id;
  categoryId?: Id;
  title: string;
  url: string;
  description?: string;
  iconUrl?: string;
  healthPolicy: HealthPolicy;
  healthStatus: HealthStatus;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookmarkInput {
  categoryId?: Id | null;
  title: string;
  url: string;
  description?: string;
  iconUrl?: string;
  healthPolicy?: HealthPolicy;
  position?: number;
}

export interface UpdateBookmarkInput {
  categoryId?: Id | null;
  title?: string;
  url?: string;
  description?: string | null;
  iconUrl?: string | null;
  healthPolicy?: HealthPolicy;
  position?: number;
}

export type WorkspaceOpenMode = "reuse" | "new-tab" | "pinned";

export interface Workspace {
  id: Id;
  name: string;
  description?: string;
  icon?: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceItem {
  id: Id;
  workspaceId: Id;
  bookmarkId?: Id;
  title: string;
  url: string;
  openMode: WorkspaceOpenMode;
  healthPolicy: HealthPolicy;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: Id;
  name: string;
  sourceDevice?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionItem {
  id: Id;
  sessionId: Id;
  title: string;
  url: string;
  pinned: boolean;
  position: number;
}

export interface SearchEngine {
  id: Id;
  name: string;
  keyword?: string;
  searchUrl: string;
  isDefault: boolean;
  position: number;
}

export type CommandSource = "tab" | "workspace" | "bookmark" | "navigation" | "search";

export interface CommandResult {
  id: string;
  source: CommandSource;
  title: string;
  subtitle?: string;
  url?: string;
  score: number;
}
