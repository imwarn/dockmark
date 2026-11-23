/**
 * [INPUT]: depends on browser from wxt/browser; depends on AppearancePreference and LocalePreference from ../../lib/ext-locale
 * [OUTPUT]: exports popup domain types, storage key constants, URL/monogram helpers, authenticated requestJson, and remote appearance sync
 * [POS]: shared API and domain utilities for apps/extension/entrypoints/popup components
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { browser } from "wxt/browser";
import type { AppearancePreference, LocalePreference } from "../../lib/ext-locale";

export const SERVER_KEY = "dockmarkServerUrl";
export const DEVICE_KEY = "dockmarkDeviceLabel";
export const TOKEN_KEY = "dockmarkDeviceToken";

export type TabSummary = {
  id?: number;
  title: string;
  url?: string;
  pinned: boolean;
  active: boolean;
};

export type SavableTab = TabSummary & { url: string };

export type SessionItem = {
  id: string;
  title: string;
  url: string;
  pinned: boolean;
  position: number;
};

export type SessionSummary = {
  id: string;
  name: string;
  sourceDevice?: string;
  createdAt: string;
  items: SessionItem[];
};

export type CaptureBookmark = {
  id: string;
  title: string;
  url: string;
  categoryId?: string;
  categoryName?: string;
  inboxAt?: string;
};

export type CaptureResult = {
  result: "created" | "duplicate";
  bookmark: CaptureBookmark;
  duplicateState?: "inbox" | "library";
};

export type ReviewItem = {
  index: number;
  title: string;
  url: string;
  state: "new" | "duplicate" | "selection-duplicate";
  duplicateOf?: number;
  duplicateState?: "inbox" | "library";
  bookmark?: CaptureBookmark;
};

export type ReviewResponse = {
  items: ReviewItem[];
};

export type BatchResponse = {
  result: "batch";
  createdCount: number;
  duplicateCount: number;
  skippedCount: number;
};

export type RemoteAppearanceResponse = {
  settings?: {
    preference?: AppearancePreference;
    locale?: LocalePreference;
  };
};

export class DockmarkRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function normalizeServerUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Dockmark URL must use HTTP or HTTPS.");
  }
  return url.origin;
}

export function hostPattern(origin: string) {
  return `${origin}/*`;
}

export function apiUrl(origin: string, path: string) {
  return new URL(path, `${origin}/`).toString();
}

export function hostLabel(value: string | undefined) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.host || parsed.protocol.replace(/:$/, "");
  } catch {
    return value;
  }
}

export function hostMonogram(value: string | undefined, fallbackTitle?: string) {
  const host = hostLabel(value).replace(/^www\./i, "");
  const source = host || fallbackTitle || "D";
  const match = source.match(/[A-Za-z0-9\u4e00-\u9fff]/);
  return (match?.[0] ?? "D").toUpperCase();
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  includeDeviceToken = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (includeDeviceToken) {
    const stored = await browser.storage.local.get(TOKEN_KEY);
    const token = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new DockmarkRequestError(
      response.status,
      body.error?.message ?? `Dockmark request failed (${response.status}).`,
    );
  }
  return body;
}

export async function patchRemoteAppearance(
  origin: string,
  payload: { preference?: AppearancePreference; locale?: LocalePreference },
) {
  if (!origin) return;
  try {
    await requestJson(apiUrl(origin, "/api/settings/appearance"), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch {
    // Cloud appearance sync is best-effort; local storage remains authoritative offline.
  }
}
