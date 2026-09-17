import { browser } from "wxt/browser";

const CACHE_KEY = "dockmarkNewTabCacheV1";
const DEFAULT_SEARCH_URL = "https://www.google.com/search?q=%s";
const LAUNCHER_COMMAND = "open-dockmark-launcher";

type CachedBookmark = {
  id?: string;
  title?: string;
  url?: string;
  description?: string;
  categoryId?: string | null;
  tags?: unknown[];
};

type CachedCategory = {
  id?: string;
  name?: string;
};

type CachedSearchEngine = {
  id?: string;
  name?: string;
  keyword?: string;
  searchUrl?: string;
  isDefault?: boolean;
  position?: number;
};

type CachedSnapshot = {
  bookmarks?: CachedBookmark[];
  categories?: CachedCategory[];
  searchEngines?: CachedSearchEngine[];
};

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function launcherBaseUrl() {
  return browser.runtime.getURL("/newtab.html");
}

function isLauncherUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const base = new URL(launcherBaseUrl());
    return url.origin === base.origin && url.pathname === base.pathname;
  } catch {
    return false;
  }
}

async function focusLauncherInput(query?: string) {
  try {
    await browser.runtime.sendMessage({
      type: "dockmark:focus-launcher",
      ...(typeof query === "string" ? { query } : {}),
    });
  } catch {
    // A freshly-created launcher focuses itself with autofocus/query bootstrap.
  }
}

export async function openDockmarkLauncher(query?: string) {
  const tabs = await browser.tabs.query({});
  const existing = tabs.find((tab) => tab.id != null && isLauncherUrl(tab.url));
  if (existing?.id != null) {
    const activated = await browser.tabs.update(existing.id, { active: true });
    if (activated?.windowId != null) await browser.windows.update(activated.windowId, { focused: true });
    await focusLauncherInput(query);
    return { reused: true, tabId: existing.id };
  }

  const url = new URL(launcherBaseUrl());
  if (typeof query === "string" && query) url.searchParams.set("q", query);
  const created = await browser.tabs.create({ url: url.toString(), active: true });
  return { reused: false, tabId: created.id ?? null };
}

async function loadSnapshot(): Promise<CachedSnapshot> {
  const stored = await browser.storage.local.get(CACHE_KEY);
  const value = stored[CACHE_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as CachedSnapshot;
}

function categoryName(snapshot: CachedSnapshot, categoryId: string | null | undefined) {
  if (!categoryId) return "";
  return asArray(snapshot.categories).find((category) => category.id === categoryId)?.name ?? "";
}

function engineKeyword(engine: CachedSearchEngine) {
  return typeof engine.keyword === "string" ? engine.keyword.trim().toLocaleLowerCase() : "";
}

function searchUrl(engine: CachedSearchEngine | undefined, query: string) {
  const template = typeof engine?.searchUrl === "string" && engine.searchUrl.includes("%s")
    ? engine.searchUrl
    : DEFAULT_SEARCH_URL;
  const result = template.replaceAll("%s", encodeURIComponent(query.trim()));
  return isHttpUrl(result) ? result : DEFAULT_SEARCH_URL.replace("%s", encodeURIComponent(query.trim()));
}

function preferredEngine(snapshot: CachedSnapshot) {
  return asArray(snapshot.searchEngines).find((engine) => engine.isDefault) ??
    [...asArray(snapshot.searchEngines)].sort((left, right) => (left.position ?? 0) - (right.position ?? 0))[0];
}

function completedBang(snapshot: CachedSnapshot, input: string) {
  const match = input.trim().match(/^!([^\s]+)(?:\s+(.*))?$/);
  if (!match?.[1]) return null;
  const keyword = match[1].toLocaleLowerCase();
  const engine = asArray(snapshot.searchEngines).find((candidate) => engineKeyword(candidate) === keyword);
  if (!engine) return null;
  const query = match[2]?.trim() ?? "";
  return { engine, query };
}

function matchingBangEngines(snapshot: CachedSnapshot, input: string) {
  const query = input.trim().toLocaleLowerCase();
  if (!query.startsWith("!") || /\s/.test(query)) return [] as CachedSearchEngine[];
  const prefix = query.slice(1);
  return asArray(snapshot.searchEngines)
    .filter((engine) => {
      const keyword = engineKeyword(engine);
      return keyword && keyword.startsWith(prefix);
    })
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || String(left.name ?? "").localeCompare(String(right.name ?? "")))
    .slice(0, 5);
}

function bookmarkScore(snapshot: CachedSnapshot, bookmark: CachedBookmark, input: string) {
  if (!isHttpUrl(bookmark.url)) return -1;
  const terms = input.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return -1;
  const title = String(bookmark.title ?? bookmark.url).toLocaleLowerCase();
  const url = bookmark.url.toLocaleLowerCase();
  const description = String(bookmark.description ?? "").toLocaleLowerCase();
  const category = categoryName(snapshot, bookmark.categoryId).toLocaleLowerCase();
  const tags = asArray(bookmark.tags)
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.toLocaleLowerCase());

  let score = 0;
  for (const term of terms) {
    if (term.startsWith("#")) {
      const tag = term.slice(1);
      if (!tag || !tags.some((candidate) => candidate.includes(tag))) return -1;
      score += tags.some((candidate) => candidate === tag) ? 80 : 40;
      continue;
    }
    if (title === term) score += 100;
    else if (title.startsWith(term)) score += 70;
    else if (title.includes(term)) score += 50;
    else if (category.includes(term)) score += 35;
    else if (tags.some((tag) => tag.includes(term))) score += 32;
    else if (description.includes(term)) score += 24;
    else if (url.includes(term)) score += 20;
    else return -1;
  }
  return score;
}

async function omniboxSuggestions(text: string) {
  const snapshot = await loadSnapshot();
  const trimmed = text.trim();
  if (!trimmed) return [];

  const bang = completedBang(snapshot, trimmed);
  if (bang?.query) {
    return [{
      content: searchUrl(bang.engine, bang.query),
      description: `Search ${bang.engine.name ?? `!${engineKeyword(bang.engine)}`} for “${bang.query}”`,
    }];
  }

  const bangEngines = matchingBangEngines(snapshot, trimmed);
  if (bangEngines.length) {
    return bangEngines.map((engine) => ({
      content: `!${engineKeyword(engine)} `,
      description: `${engine.name ?? engineKeyword(engine)} · !${engineKeyword(engine)} · continue typing a query`,
    }));
  }

  const bookmarks = asArray(snapshot.bookmarks)
    .map((bookmark) => ({ bookmark, score: bookmarkScore(snapshot, bookmark, trimmed) }))
    .filter((entry) => entry.score >= 0 && isHttpUrl(entry.bookmark.url))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ bookmark }) => ({
      content: bookmark.url as string,
      description: `Bookmark · ${bookmark.title ?? bookmark.url}${categoryName(snapshot, bookmark.categoryId) ? ` · ${categoryName(snapshot, bookmark.categoryId)}` : ""}`,
    }));

  const engine = preferredEngine(snapshot);
  const web = {
    content: searchUrl(engine, trimmed),
    description: `Search ${engine?.name ?? "the web"} for “${trimmed}”`,
  };
  return [...bookmarks, web].slice(0, 5);
}

async function openOmniboxUrl(url: string, disposition: string) {
  if (disposition === "newForegroundTab") {
    await browser.tabs.create({ url, active: true });
    return;
  }
  if (disposition === "newBackgroundTab") {
    await browser.tabs.create({ url, active: false });
    return;
  }

  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  if (active?.id != null) {
    await browser.tabs.update(active.id, { url, active: true });
    return;
  }
  await browser.tabs.create({ url, active: true });
}

async function handleOmniboxInput(text: string, disposition: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    await openDockmarkLauncher();
    return;
  }
  if (isHttpUrl(trimmed)) {
    await openOmniboxUrl(trimmed, disposition);
    return;
  }

  const snapshot = await loadSnapshot();
  const bang = completedBang(snapshot, trimmed);
  if (bang) {
    if (!bang.query) {
      await openDockmarkLauncher(`!${engineKeyword(bang.engine)} `);
      return;
    }
    await openOmniboxUrl(searchUrl(bang.engine, bang.query), disposition);
    return;
  }

  await openOmniboxUrl(searchUrl(preferredEngine(snapshot), trimmed), disposition);
}

export function registerLauncherAccess() {
  browser.commands?.onCommand.addListener((command) => {
    if (command === LAUNCHER_COMMAND) void openDockmarkLauncher();
  });

  browser.omnibox?.setDefaultSuggestion({
    description: "Dockmark · search cached bookmarks or use !g / !gh search commands",
  });
  browser.omnibox?.onInputChanged.addListener((text, suggest) => {
    void omniboxSuggestions(text)
      .then((results) => suggest(results))
      .catch(() => suggest([]));
  });
  browser.omnibox?.onInputEntered.addListener((text, disposition) => {
    void handleOmniboxInput(text, disposition);
  });
}
