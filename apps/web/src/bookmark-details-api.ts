import type { Bookmark, CreateBookmarkInput, HealthPolicy } from "@dockmark/core";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export const MAX_BOOKMARK_TAGS = 12;
export const MAX_BOOKMARK_TAG_LENGTH = 40;

export interface BookmarkDetailsInput {
  title: string;
  url: string;
  description: string | null;
  categoryId: string | null;
  healthPolicy?: HealthPolicy;
  tags: string[];
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Request failed with status ${response.status}.`);
  }
  return payload;
}

export function parseBookmarkTags(value: string) {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const raw of value.split(/[;,\n]/)) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > MAX_BOOKMARK_TAG_LENGTH) {
      throw new Error(`Tag “${tag.slice(0, 24)}${tag.length > 24 ? "…" : ""}” is ${tag.length} characters. Tags must be ${MAX_BOOKMARK_TAG_LENGTH} characters or fewer.`);
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  if (tags.length > MAX_BOOKMARK_TAGS) {
    throw new Error(`This bookmark has ${tags.length} unique tags. A bookmark can have at most ${MAX_BOOKMARK_TAGS}.`);
  }
  return tags;
}

export async function createBookmarkWithTags(input: CreateBookmarkInput, tags: string[]) {
  const response = await request<{ bookmark: Bookmark; tags: string[] }>("/api/bookmarks/with-tags", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      url: input.url,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      ...(input.healthPolicy ? { healthPolicy: input.healthPolicy } : {}),
      tags,
    }),
  });
  return response;
}

export async function updateBookmarkWithTags(id: string, input: BookmarkDetailsInput) {
  const response = await request<{ bookmark: Bookmark; tags: string[] }>(
    `/api/bookmarks/${encodeURIComponent(id)}/with-tags`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return response;
}
