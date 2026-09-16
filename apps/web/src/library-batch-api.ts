import { MAX_BOOKMARK_TAG_LENGTH, MAX_BOOKMARK_TAGS } from "./bookmark-details-api";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export const MAX_LIBRARY_BATCH = 50;

export interface LibraryBatchInput {
  bookmarkIds: string[];
  categoryId?: string | null;
  addTags?: string[];
  removeTags?: string[];
}

export class LibraryBatchApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "LibraryBatchApiError";
  }
}

function normalizeTags(tags: string[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    if (tag.length > MAX_BOOKMARK_TAG_LENGTH) {
      throw new Error(`Tag “${tag.slice(0, 24)}${tag.length > 24 ? "…" : ""}” is ${tag.length} characters. Tags must be ${MAX_BOOKMARK_TAG_LENGTH} characters or fewer.`);
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  if (normalized.length > MAX_BOOKMARK_TAGS) {
    throw new Error(`A bulk tag change can include at most ${MAX_BOOKMARK_TAGS} unique tags.`);
  }
  return normalized;
}

export async function organizeLibraryBatch(input: LibraryBatchInput) {
  const bookmarkIds = Array.from(new Set(input.bookmarkIds.filter(Boolean)));
  if (!bookmarkIds.length) throw new Error("Select at least one bookmark to organize.");
  if (bookmarkIds.length > MAX_LIBRARY_BATCH) throw new Error(`Select at most ${MAX_LIBRARY_BATCH} bookmarks per review.`);

  const addTags = normalizeTags(input.addTags ?? []);
  const removeTags = normalizeTags(input.removeTags ?? []);
  const removeKeys = new Set(removeTags.map((tag) => tag.toLocaleLowerCase()));
  const overlap = addTags.find((tag) => removeKeys.has(tag.toLocaleLowerCase()));
  if (overlap) throw new Error(`Tag “${overlap}” cannot be added and removed in the same review.`);

  const payload: LibraryBatchInput = {
    bookmarkIds,
    ...(Object.prototype.hasOwnProperty.call(input, "categoryId") ? { categoryId: input.categoryId ?? null } : {}),
    ...(addTags.length ? { addTags } : {}),
    ...(removeTags.length ? { removeTags } : {}),
  };

  const response = await fetch("/api/bookmarks/batch-organize", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({})) as ErrorEnvelope & {
    applied?: number;
    bookmarkIds?: string[];
  };
  if (!response.ok) {
    throw new LibraryBatchApiError(
      response.status,
      body.error?.code,
      body.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return {
    applied: body.applied ?? bookmarkIds.length,
    bookmarkIds: body.bookmarkIds ?? bookmarkIds,
  };
}
