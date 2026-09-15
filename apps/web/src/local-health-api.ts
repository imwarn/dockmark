import type { HealthCheck, HealthStatus } from "@dockmark/core";

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export interface LocalHealthResultInput {
  status: Exclude<HealthStatus, "unknown" | "local-only" | "ignored">;
  httpStatus?: number;
  finalUrl?: string;
  responseMs?: number;
  errorCode?: string;
}

export async function recordLocalBookmarkHealthResult(bookmarkId: string, input: LocalHealthResultInput) {
  const response = await fetch(`/api/bookmarks/${encodeURIComponent(bookmarkId)}/health/local-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({})) as { check?: HealthCheck } & ErrorEnvelope;
  if (!response.ok || !payload.check) {
    throw new Error(payload.error?.message ?? `Could not save local health result (${response.status}).`);
  }
  return payload.check;
}
