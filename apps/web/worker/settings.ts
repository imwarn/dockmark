import {
  DEFAULT_BROWSER_SETTINGS,
  mergeBrowserSettings,
  normalizeBrowserSettings,
  type BookmarkConflictPreference,
  type BrowserNewTabSettings,
  type BrowserSettings,
  type UpdateBrowserSettingsInput,
} from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface SettingsDbLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface SettingsRow {
  value: string;
  updated_at: string;
}

export class SettingsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new SettingsHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseConflictPreference(value: unknown): BookmarkConflictPreference {
  if (value === "ask" || value === "browser" || value === "dockmark") return value;
  throw new SettingsHttpError(400, "invalid_field", "conflictPreference must be ask, browser or dockmark.");
}

function parseInteger(value: unknown, key: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new SettingsHttpError(400, "invalid_field", `${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseNewTab(value: unknown): Partial<BrowserNewTabSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsHttpError(400, "invalid_field", "newTab must be a JSON object.");
  }
  const body = value as Record<string, unknown>;
  const output: Partial<BrowserNewTabSettings> = {};

  if (hasOwn(body, "defaultSearchEngineId")) {
    if (body.defaultSearchEngineId === null) output.defaultSearchEngineId = null;
    else if (typeof body.defaultSearchEngineId === "string" && body.defaultSearchEngineId.trim()) {
      output.defaultSearchEngineId = body.defaultSearchEngineId.trim();
    } else {
      throw new SettingsHttpError(400, "invalid_field", "newTab.defaultSearchEngineId must be a non-empty string or null.");
    }
  }
  if (hasOwn(body, "showOpenTabs")) {
    if (typeof body.showOpenTabs !== "boolean") {
      throw new SettingsHttpError(400, "invalid_field", "newTab.showOpenTabs must be a boolean.");
    }
    output.showOpenTabs = body.showOpenTabs;
  }
  if (hasOwn(body, "bookmarkLimit")) {
    output.bookmarkLimit = parseInteger(body.bookmarkLimit, "newTab.bookmarkLimit", 0, 24);
  }
  if (hasOwn(body, "workspaceLimit")) {
    output.workspaceLimit = parseInteger(body.workspaceLimit, "newTab.workspaceLimit", 0, 12);
  }
  if (hasOwn(body, "autoRefresh")) {
    if (typeof body.autoRefresh !== "boolean") {
      throw new SettingsHttpError(400, "invalid_field", "newTab.autoRefresh must be a boolean.");
    }
    output.autoRefresh = body.autoRefresh;
  }

  return output;
}

async function loadBrowserSettings(db: SettingsDbLike): Promise<BrowserSettings> {
  const row = await db
    .prepare("SELECT value, updated_at FROM app_settings WHERE key = ?")
    .bind("browser")
    .first<SettingsRow>();
  if (!row) return normalizeBrowserSettings(DEFAULT_BROWSER_SETTINGS);

  try {
    return normalizeBrowserSettings({
      ...JSON.parse(row.value) as Record<string, unknown>,
      updatedAt: row.updated_at,
    });
  } catch {
    return normalizeBrowserSettings({ ...DEFAULT_BROWSER_SETTINGS, updatedAt: row.updated_at });
  }
}

async function saveBrowserSettings(db: SettingsDbLike, settings: BrowserSettings) {
  await db
    .prepare(`INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind("browser", JSON.stringify(settings), settings.updatedAt)
    .run();
}

function parseUpdate(body: Record<string, unknown>): UpdateBrowserSettingsInput {
  const update: UpdateBrowserSettingsInput = {};
  if (hasOwn(body, "conflictPreference")) {
    update.conflictPreference = parseConflictPreference(body.conflictPreference);
  }
  if (hasOwn(body, "newTab")) update.newTab = parseNewTab(body.newTab);
  return update;
}

export async function handleSettingsApi(
  request: Request,
  db: SettingsDbLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== "/api/settings/browser") return null;

  if (request.method === "GET") {
    return json({ settings: await loadBrowserSettings(db) });
  }

  if (request.method === "PATCH") {
    const current = await loadBrowserSettings(db);
    const update = parseUpdate(await readBody(request));
    const settings = mergeBrowserSettings(current, update);
    await saveBrowserSettings(db, settings);
    return json({ settings });
  }

  throw new SettingsHttpError(405, "method_not_allowed", "Only GET and PATCH are supported for browser settings.");
}
