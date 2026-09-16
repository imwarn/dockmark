import type { HealthStatus } from "@dockmark/core";

interface ErrorEnvelope { error?: { message?: string } }

export interface SmartCollectionFilters {
  categoryId?: string | null;
  tags?: string[];
  domain?: string;
  healthStatus?: HealthStatus;
  inbox?: "inbox" | "library";
}

export interface SmartCollection {
  id: string;
  name: string;
  filters: SmartCollectionFilters;
  position: number;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) throw new Error(payload.error?.message ?? `Request failed with status ${response.status}.`);
  return payload;
}

export async function listSmartCollections() {
  return (await request<{ collections: SmartCollection[] }>("/api/smart-collections")).collections;
}

export async function createSmartCollection(name: string, filters: SmartCollectionFilters) {
  return (await request<{ collection: SmartCollection }>("/api/smart-collections", {
    method: "POST", body: JSON.stringify({ name, filters }),
  })).collection;
}

export async function updateSmartCollection(id: string, name: string, filters: SmartCollectionFilters) {
  return (await request<{ collection: SmartCollection }>(`/api/smart-collections/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ name, filters }),
  })).collection;
}

export async function deleteSmartCollection(id: string) {
  await request<void>(`/api/smart-collections/${encodeURIComponent(id)}`, { method: "DELETE" });
}
