import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_BROWSER_SETTINGS,
  mergeAppearanceSettings,
  mergeBrowserSettings,
  normalizeAppearancePreference,
  normalizeAppearanceSettings,
  normalizeBrowserSettings,
  type AppearancePreference,
  type AppearanceSettings,
  type BookmarkConflictPreference,
  type BrowserNewTabSettings,
  type BrowserSettings,
  type UpdateAppearanceSettingsInput,
  type UpdateBrowserSettingsInput,
} from "@dockmark/core";

type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface SettingsDbLike {
  prepare(query: string): D1PreparedStatementLike;
}

interface SettingsRow {
  value: string;
  updated_at: string;
}

interface BookmarkTagRow {
  bookmark_id: string;
  name: string;
}

interface SmartCollectionRow {
  id: string;
  name: string;
  filters_json: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface InboxBookmarkRow {
  id: string;
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

function parseAppearancePreference(value: unknown): AppearancePreference {
  const preference = normalizeAppearancePreference(value);
  if (preference === value) return preference;
  throw new SettingsHttpError(400, "invalid_field", "preference must be system, light or dark.");
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
  if (hasOwn(body, "bookmarkLimit")) output.bookmarkLimit = parseInteger(body.bookmarkLimit, "newTab.bookmarkLimit", 0, 24);
  if (hasOwn(body, "workspaceLimit")) output.workspaceLimit = parseInteger(body.workspaceLimit, "newTab.workspaceLimit", 0, 12);
  if (hasOwn(body, "autoRefresh")) {
    if (typeof body.autoRefresh !== "boolean") {
      throw new SettingsHttpError(400, "invalid_field", "newTab.autoRefresh must be a boolean.");
    }
    output.autoRefresh = body.autoRefresh;
  }
  return output;
}

async function loadSetting<T>(db: SettingsDbLike, key: string, fallback: T, normalize: (value: unknown) => T): Promise<T> {
  const row = await db.prepare("SELECT value, updated_at FROM app_settings WHERE key = ?").bind(key).first<SettingsRow>();
  if (!row) return normalize(fallback);
  try {
    return normalize({ ...JSON.parse(row.value) as Record<string, unknown>, updatedAt: row.updated_at });
  } catch {
    return normalize({ ...(fallback as Record<string, unknown>), updatedAt: row.updated_at });
  }
}

async function saveSetting(db: SettingsDbLike, key: string, value: { updatedAt: string | null }) {
  await db.prepare(`INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(key, JSON.stringify(value), value.updatedAt)
    .run();
}

async function loadBrowserSettings(db: SettingsDbLike): Promise<BrowserSettings> {
  return loadSetting(db, "browser", DEFAULT_BROWSER_SETTINGS, normalizeBrowserSettings);
}

async function loadBookmarkTags(db: SettingsDbLike) {
  const result = await db.prepare(
    `SELECT bt.bookmark_id, t.name
       FROM bookmark_tags bt
       JOIN tags t ON t.id = bt.tag_id
      ORDER BY bt.bookmark_id ASC, t.name COLLATE NOCASE ASC`,
  ).all<BookmarkTagRow>();

  const bookmarkTags: Record<string, string[]> = {};
  for (const row of result.results) {
    (bookmarkTags[row.bookmark_id] ??= []).push(row.name);
  }
  return bookmarkTags;
}

async function loadSmartCollections(db: SettingsDbLike) {
  const result = await db.prepare(
    `SELECT id, name, filters_json, position, created_at, updated_at
       FROM smart_collections
      ORDER BY position ASC, name COLLATE NOCASE ASC`,
  ).all<SmartCollectionRow>();

  return result.results.map((row) => {
    let filters: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.filters_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) filters = parsed as Record<string, unknown>;
    } catch {
      // Saved filters are validated on write. A malformed legacy row stays an empty, non-mutating view.
    }
    return {
      id: row.id,
      name: row.name,
      filters,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

async function loadInboxBookmarkIds(db: SettingsDbLike) {
  const result = await db.prepare(
    "SELECT id FROM bookmarks WHERE inbox_at IS NOT NULL ORDER BY inbox_at DESC, id ASC",
  ).all<InboxBookmarkRow>();
  return result.results.map((row) => row.id);
}

export async function loadAppearanceSettings(db: SettingsDbLike): Promise<AppearanceSettings> {
  return loadSetting(db, "appearance", DEFAULT_APPEARANCE_SETTINGS, normalizeAppearanceSettings);
}

function parseBrowserUpdate(body: Record<string, unknown>): UpdateBrowserSettingsInput {
  const update: UpdateBrowserSettingsInput = {};
  if (hasOwn(body, "conflictPreference")) update.conflictPreference = parseConflictPreference(body.conflictPreference);
  if (hasOwn(body, "newTab")) update.newTab = parseNewTab(body.newTab);
  return update;
}

function parseAppearanceUpdate(body: Record<string, unknown>): UpdateAppearanceSettingsInput {
  const update: UpdateAppearanceSettingsInput = {};
  if (hasOwn(body, "preference")) update.preference = parseAppearancePreference(body.preference);
  return update;
}

export async function handleSettingsApi(
  request: Request,
  db: SettingsDbLike,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/settings/browser") {
    if (request.method === "GET") {
      const [settings, bookmarkTags, smartCollections, inboxBookmarkIds] = await Promise.all([
        loadBrowserSettings(db),
        loadBookmarkTags(db),
        loadSmartCollections(db),
        loadInboxBookmarkIds(db),
      ]);
      return json({ settings, bookmarkTags, smartCollections, inboxBookmarkIds });
    }
    if (request.method === "PATCH") {
      const current = await loadBrowserSettings(db);
      const settings = mergeBrowserSettings(current, parseBrowserUpdate(await readBody(request)));
      await saveSetting(db, "browser", settings);
      return json({ settings });
    }
    throw new SettingsHttpError(405, "method_not_allowed", "Only GET and PATCH are supported for browser settings.");
  }

  if (pathname === "/api/settings/appearance") {
    if (request.method === "GET") return json({ settings: await loadAppearanceSettings(db) });
    if (request.method === "PATCH") {
      const current = await loadAppearanceSettings(db);
      const settings = mergeAppearanceSettings(current, parseAppearanceUpdate(await readBody(request)));
      await saveSetting(db, "appearance", settings);
      return json({ settings });
    }
    throw new SettingsHttpError(405, "method_not_allowed", "Only GET and PATCH are supported for appearance settings.");
  }

  return null;
}
