/**
 * [INPUT]: depends on browser, appearance, public-page (including MAX_PUBLIC_PINNED_BOOKMARKS), and AI settings helpers plus URL policy checks from @dockmark/core; queries D1 app_settings, bookmark_tags, smart_collections, and bookmarks tables
 * [OUTPUT]: exports SettingsDbLike, SettingsHttpError, loadAppearanceSettings, loadPublicPageSettings, loadAiSettings, and handleSettingsApi
 * [POS]: Worker HTTP handler for /api/settings/browser, /api/settings/appearance, /api/settings/public-page, and /api/settings/ai in apps/web/worker
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_BROWSER_SETTINGS,
  DEFAULT_PUBLIC_PAGE_SETTINGS,
  MAX_PUBLIC_PINNED_BOOKMARKS,
  inferHealthPolicy,
  mergeAiSettings,
  mergeAppearanceSettings,
  mergeBrowserSettings,
  mergePublicPageSettings,
  normalizeAiSettings,
  normalizeAppearancePreference,
  normalizeAppearanceSettings,
  normalizeBookmarkUrl,
  normalizeBrowserSettings,
  normalizePublicPageSettings,
  type AiSettings,
  type AppearancePreference,
  type AppearanceSettings,
  type BookmarkConflictPreference,
  type BrowserNewTabSettings,
  type BrowserSettings,
  type Id,
  type LauncherShortcutKey,
  type LocalePreference,
  type PublicPageLayout,
  type PublicPageSettings,
  type UpdateAiSettingsInput,
  type UpdateAppearanceSettingsInput,
  type UpdateBrowserSettingsInput,
  type UpdatePublicPageSettingsInput,
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

function parseLauncherShortcut(value: unknown): LauncherShortcutKey {
  if (value === "mod-k" || value === "mod-j" || value === "alt-k") return value;
  throw new SettingsHttpError(400, "invalid_field", "launcherShortcut must be mod-k, mod-j or alt-k.");
}

function parseAppearancePreference(value: unknown): AppearancePreference {
  const preference = normalizeAppearancePreference(value);
  if (preference === value) return preference;
  throw new SettingsHttpError(400, "invalid_field", "preference must be system, light or dark.");
}

function parseLocalePreference(value: unknown): LocalePreference {
  if (value === "system" || value === "en" || value === "zh-CN") return value;
  throw new SettingsHttpError(400, "invalid_field", "locale must be system, en or zh-CN.");
}

function parsePublicPageLayout(value: unknown): PublicPageLayout {
  if (value === "grid" || value === "compact" || value === "list") return value;
  throw new SettingsHttpError(400, "invalid_field", "defaultLayout must be grid, compact or list.");
}

function parsePinnedBookmarkIds(value: unknown): Id[] {
  if (!Array.isArray(value)) {
    throw new SettingsHttpError(400, "invalid_field", "pinnedBookmarkIds must be an array.");
  }
  if (value.length > MAX_PUBLIC_PINNED_BOOKMARKS) {
    throw new SettingsHttpError(
      400,
      "invalid_field",
      `pinnedBookmarkIds must contain at most ${MAX_PUBLIC_PINNED_BOOKMARKS} items.`,
    );
  }
  const seen = new Set<string>();
  const ids: Id[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new SettingsHttpError(
        400,
        "invalid_field",
        "pinnedBookmarkIds items must be non-empty strings of at most 120 characters.",
      );
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 120) {
      throw new SettingsHttpError(
        400,
        "invalid_field",
        "pinnedBookmarkIds items must be non-empty strings of at most 120 characters.",
      );
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      ids.push(trimmed);
    }
  }
  return ids;
}

function parseBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new SettingsHttpError(400, "invalid_field", `${key} must be a boolean.`);
  }
  return value;
}

function parseBoundedString(value: unknown, key: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new SettingsHttpError(400, "invalid_field", `${key} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new SettingsHttpError(400, "invalid_field", `${key} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function parseAiEndpoint(value: unknown): string {
  if (typeof value !== "string") {
    throw new SettingsHttpError(400, "invalid_field", "endpoint must be a string.");
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 500) {
    throw new SettingsHttpError(400, "invalid_field", "endpoint must be at most 500 characters.");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SettingsHttpError(400, "invalid_field", "endpoint must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") {
    throw new SettingsHttpError(400, "invalid_field", "endpoint must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new SettingsHttpError(400, "invalid_field", "endpoint must not contain URL credentials.");
  }
  const normalized = normalizeBookmarkUrl(url.toString());
  if (inferHealthPolicy(normalized) === "local-only") {
    throw new SettingsHttpError(400, "invalid_field", "endpoint must be a public HTTPS URL.");
  }
  return trimmed;
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

export async function loadPublicPageSettings(db: SettingsDbLike): Promise<PublicPageSettings> {
  return loadSetting(db, "public_page", DEFAULT_PUBLIC_PAGE_SETTINGS, normalizePublicPageSettings);
}

export async function loadAiSettings(db: SettingsDbLike): Promise<AiSettings> {
  return loadSetting(db, "ai", DEFAULT_AI_SETTINGS, normalizeAiSettings);
}

function parseBrowserUpdate(body: Record<string, unknown>): UpdateBrowserSettingsInput {
  const update: UpdateBrowserSettingsInput = {};
  if (hasOwn(body, "conflictPreference")) update.conflictPreference = parseConflictPreference(body.conflictPreference);
  if (hasOwn(body, "launcherShortcut")) update.launcherShortcut = parseLauncherShortcut(body.launcherShortcut);
  if (hasOwn(body, "slashFocus")) update.slashFocus = parseBoolean(body.slashFocus, "slashFocus");
  if (hasOwn(body, "newTab")) update.newTab = parseNewTab(body.newTab);
  return update;
}

function parseAppearanceUpdate(body: Record<string, unknown>): UpdateAppearanceSettingsInput {
  const update: UpdateAppearanceSettingsInput = {};
  if (hasOwn(body, "preference")) update.preference = parseAppearancePreference(body.preference);
  if (hasOwn(body, "locale")) update.locale = parseLocalePreference(body.locale);
  return update;
}

function parsePublicPageUpdate(body: Record<string, unknown>): UpdatePublicPageSettingsInput {
  const update: UpdatePublicPageSettingsInput = {};
  if (hasOwn(body, "siteTitle")) update.siteTitle = parseBoundedString(body.siteTitle, "siteTitle", 80);
  if (hasOwn(body, "siteSubtitle")) update.siteSubtitle = parseBoundedString(body.siteSubtitle, "siteSubtitle", 200);
  if (hasOwn(body, "defaultLayout")) update.defaultLayout = parsePublicPageLayout(body.defaultLayout);
  if (hasOwn(body, "showSearchBar")) update.showSearchBar = parseBoolean(body.showSearchBar, "showSearchBar");
  if (hasOwn(body, "showWebSearch")) update.showWebSearch = parseBoolean(body.showWebSearch, "showWebSearch");
  if (hasOwn(body, "showCategoryNav")) update.showCategoryNav = parseBoolean(body.showCategoryNav, "showCategoryNav");
  if (hasOwn(body, "openInNewTab")) update.openInNewTab = parseBoolean(body.openInNewTab, "openInNewTab");
  if (hasOwn(body, "pinnedBookmarkIds")) update.pinnedBookmarkIds = parsePinnedBookmarkIds(body.pinnedBookmarkIds);
  return update;
}

function parseAiUpdate(body: Record<string, unknown>): UpdateAiSettingsInput {
  if (hasOwn(body, "apiKey") || hasOwn(body, "api_key")) {
    throw new SettingsHttpError(
      400,
      "secret_not_allowed",
      "API keys cannot be stored in settings; configure DOCKMARK_AI_API_KEY as a Worker secret.",
    );
  }
  const update: UpdateAiSettingsInput = {};
  if (hasOwn(body, "endpoint")) update.endpoint = parseAiEndpoint(body.endpoint);
  if (hasOwn(body, "model")) update.model = parseBoundedString(body.model, "model", 160);
  if (hasOwn(body, "timeoutSeconds")) update.timeoutSeconds = parseInteger(body.timeoutSeconds, "timeoutSeconds", 15, 180);
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

  if (pathname === "/api/settings/public-page") {
    if (request.method === "GET") return json({ settings: await loadPublicPageSettings(db) });
    if (request.method === "PATCH") {
      const current = await loadPublicPageSettings(db);
      const settings = mergePublicPageSettings(current, parsePublicPageUpdate(await readBody(request)));
      await saveSetting(db, "public_page", settings);
      return json({ settings });
    }
    throw new SettingsHttpError(405, "method_not_allowed", "Only GET and PATCH are supported for public page settings.");
  }

  if (pathname === "/api/settings/ai") {
    if (request.method === "GET") return json({ settings: await loadAiSettings(db) });
    if (request.method === "PATCH") {
      const current = await loadAiSettings(db);
      const settings = mergeAiSettings(current, parseAiUpdate(await readBody(request)));
      await saveSetting(db, "ai", settings);
      return json({ settings });
    }
    throw new SettingsHttpError(405, "method_not_allowed", "Only GET and PATCH are supported for AI settings.");
  }

  return null;
}
