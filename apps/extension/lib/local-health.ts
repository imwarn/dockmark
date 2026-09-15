import { inferHealthPolicy, type HealthStatus } from "@dockmark/core";
import { browser } from "wxt/browser";

export const LOCAL_HEALTH_PENDING_KEY = "dockmarkPendingLocalHealthPermissionV1";

export interface PendingLocalHealthPermission {
  url: string;
  origin: string;
  pattern: string;
  requestedAt: string;
}

export interface LocalHealthPermissionRequired {
  kind: "permission-required";
  url: string;
  origin: string;
  pattern: string;
}

export interface LocalHealthProbeResult {
  kind: "result";
  status: Exclude<HealthStatus, "unknown" | "local-only" | "ignored">;
  httpStatus?: number;
  finalUrl?: string;
  responseMs: number;
  errorCode?: string;
}

export type LocalHealthResponse = LocalHealthPermissionRequired | LocalHealthProbeResult;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 10_000;
const PERMISSION_PAGE = "/local-health-permission.html";

function httpUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Local health checks require an HTTP or HTTPS URL.");
  }
  return url;
}

export function localHealthPermissionPattern(rawUrl: string) {
  const url = httpUrl(rawUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

async function focusPermissionPage() {
  const pageUrl = browser.runtime.getURL(PERMISSION_PAGE);
  const tabs = await browser.tabs.query({ url: pageUrl });
  const existing = tabs[0];
  if (existing?.id != null) {
    const tab = await browser.tabs.update(existing.id, { active: true });
    if (tab?.windowId != null) await browser.windows.update(tab.windowId, { focused: true });
    return;
  }
  await browser.tabs.create({ url: pageUrl, active: true });
}

async function permissionFor(url: URL): Promise<LocalHealthPermissionRequired | null> {
  const pattern = localHealthPermissionPattern(url.toString());
  if (await browser.permissions.contains({ origins: [pattern] })) return null;

  const pending: PendingLocalHealthPermission = {
    url: url.toString(),
    origin: url.origin,
    pattern,
    requestedAt: new Date().toISOString(),
  };
  await browser.storage.local.set({ [LOCAL_HEALTH_PENDING_KEY]: pending });
  await focusPermissionPage();
  return { kind: "permission-required", url: pending.url, origin: pending.origin, pattern };
}

function classifyStatus(status: number, redirected: boolean): LocalHealthProbeResult["status"] {
  if (status >= 200 && status < 300) return redirected ? "redirected" : "healthy";
  if (status === 401) return "auth-required";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate-limited";
  return "unavailable";
}

async function fetchProbe(url: string, signal: AbortSignal) {
  let response = await fetch(url, {
    method: "HEAD",
    redirect: "manual",
    signal,
    headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  });
  if (response.status === 405 || response.status === 501) {
    await response.body?.cancel().catch(() => undefined);
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        range: "bytes=0-0",
      },
    });
  }
  return response;
}

export async function checkLocalHealth(rawUrl: string): Promise<LocalHealthResponse> {
  const initial = httpUrl(rawUrl);
  if (inferHealthPolicy(initial.toString()) !== "local-only") {
    throw new Error("Extension local health checks are restricted to local/private URLs.");
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let current = initial;
  let redirected = false;

  try {
    const initialPermission = await permissionFor(current);
    if (initialPermission) return initialPermission;

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetchProbe(current.toString(), controller.signal);
      const httpStatus = response.status;

      if (REDIRECT_STATUSES.has(httpStatus)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) {
          return {
            kind: "result",
            status: "unavailable",
            httpStatus,
            finalUrl: current.toString(),
            responseMs: Date.now() - started,
            errorCode: "redirect_without_location",
          };
        }
        const next = httpUrl(new URL(location, current).toString());
        if (redirectCount === MAX_REDIRECTS) {
          return {
            kind: "result",
            status: "unavailable",
            httpStatus,
            finalUrl: next.toString(),
            responseMs: Date.now() - started,
            errorCode: "too_many_redirects",
          };
        }

        // Never broaden browser access from a local target to a public host.
        // Surface the public redirect for explicit review instead.
        if (inferHealthPolicy(next.toString()) !== "local-only") {
          return {
            kind: "result",
            status: "redirected",
            httpStatus,
            finalUrl: next.toString(),
            responseMs: Date.now() - started,
            errorCode: "redirect_to_public",
          };
        }

        const redirectPermission = await permissionFor(next);
        if (redirectPermission) return redirectPermission;
        current = next;
        redirected = true;
        continue;
      }

      await response.body?.cancel().catch(() => undefined);
      return {
        kind: "result",
        status: classifyStatus(httpStatus, redirected),
        httpStatus,
        finalUrl: current.toString(),
        responseMs: Date.now() - started,
      };
    }
  } catch (error) {
    return {
      kind: "result",
      status: controller.signal.aborted ? "timeout" : "unavailable",
      finalUrl: current.toString(),
      responseMs: Date.now() - started,
      errorCode: controller.signal.aborted
        ? "timeout"
        : error instanceof Error && error.message
          ? error.message.slice(0, 120)
          : "unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }

  return {
    kind: "result",
    status: "unavailable",
    finalUrl: current.toString(),
    responseMs: Date.now() - started,
    errorCode: "unknown",
  };
}
