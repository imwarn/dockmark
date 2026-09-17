import type { HealthPolicy } from "@dockmark/core";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

export const MAX_LIBRARY_MAINTENANCE_BATCH = 50;
export type LibraryMaintenanceAction = "set-health-policy" | "archive" | "restore" | "delete";

export class LibraryMaintenanceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "LibraryMaintenanceApiError";
  }
}

export interface LibraryMaintenanceInput {
  bookmarkIds: string[];
  action: LibraryMaintenanceAction;
  healthPolicy?: HealthPolicy;
  confirmation?: string;
}

export async function maintainLibraryBatch(input: LibraryMaintenanceInput) {
  const bookmarkIds = Array.from(new Set(input.bookmarkIds.filter(Boolean)));
  if (!bookmarkIds.length) throw new Error("Select at least one bookmark to maintain.");
  if (bookmarkIds.length > MAX_LIBRARY_MAINTENANCE_BATCH) {
    throw new Error(`Select at most ${MAX_LIBRARY_MAINTENANCE_BATCH} bookmarks per review.`);
  }
  if (input.action === "set-health-policy" && !input.healthPolicy) {
    throw new Error("Choose a HealthPolicy before review.");
  }
  if (input.action === "delete" && input.confirmation !== "DELETE") {
    throw new Error("Type DELETE exactly before permanently deleting archived bookmarks.");
  }

  const response = await fetch("/api/bookmarks/batch-maintenance", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      bookmarkIds,
      action: input.action,
      ...(input.healthPolicy ? { healthPolicy: input.healthPolicy } : {}),
      ...(input.confirmation ? { confirmation: input.confirmation } : {}),
    }),
  });
  const body = await response.json().catch(() => ({})) as ErrorEnvelope & {
    applied?: number;
    bookmarkIds?: string[];
  };
  if (!response.ok) {
    throw new LibraryMaintenanceApiError(
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
