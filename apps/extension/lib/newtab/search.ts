/**
 * [INPUT]: depends on LAUNCHER_SOURCE_WEIGHT, launcherTextScore, textContainsTokenOrPinyin from @dockmark/core; depends on newTabI18n from ./i18n; depends on newTabState from ./state; depends on NewTab types and helpers from ./types
 * [OUTPUT]: exports categoryName, collectionMatchesBookmark, searchUrl, preferredSearchEngine, searchEngineCommand, and defaultBuildResults with Pinyin initial search and Web Launcher parity
 * [POS]: unified local-first command search and ranking engine in apps/extension/lib/newtab replacing legacy newtab-search.js, newtab-ux.js, and newtab-parity.js search patches
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import {
  LAUNCHER_SOURCE_WEIGHT,
  launcherTextScore,
  textContainsTokenOrPinyin,
} from "@dockmark/core";
import { newTabI18n } from "./i18n";
import { newTabState } from "./state";
import {
  DEFAULT_SEARCH_URL,
  LAUNCHER_RESULT_LIMIT,
  asArray,
  displayHost,
  isHttpUrl,
  normalizedTags,
  type CachedBookmark,
  type CachedSearchEngine,
  type CachedSession,
  type CachedSmartCollection,
  type CachedWorkspace,
  type NewTabResult,
  type OpenTabEntry,
} from "./types";

export function categoryName(categoryId: string | null | undefined): string {
  if (!categoryId) return newTabI18n.tx("Uncategorized", "未分类");
  return newTabState.snapshot.categories.find((category) => category?.id === categoryId)?.name
    || newTabI18n.tx("Uncategorized", "未分类");
}

export function collectionMatchesBookmark(
  collection: CachedSmartCollection | null | undefined,
  bookmark: CachedBookmark | null | undefined,
): boolean {
  if (!collection || !bookmark || !isHttpUrl(bookmark.url)) return false;
  const filters = collection.filters && typeof collection.filters === "object" && !Array.isArray(collection.filters)
    ? collection.filters
    : {};

  if (Object.prototype.hasOwnProperty.call(filters, "categoryId")) {
    if (filters.categoryId === null ? Boolean(bookmark.categoryId) : bookmark.categoryId !== filters.categoryId) {
      return false;
    }
  }

  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    const tags = new Set(normalizedTags(bookmark).map((tag) => tag.toLocaleLowerCase()));
    if (!filters.tags.every((tag) => typeof tag === "string" && tags.has(tag.toLocaleLowerCase()))) {
      return false;
    }
  }

  if (typeof filters.domain === "string" && filters.domain) {
    let host = "";
    try {
      host = new URL(bookmark.url).hostname.toLocaleLowerCase();
    } catch {
      return false;
    }
    const domain = filters.domain.toLocaleLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) return false;
  }

  if (typeof filters.healthStatus === "string" && bookmark.healthStatus !== filters.healthStatus) {
    return false;
  }

  const inboxIds = new Set(
    asArray<unknown>(newTabState.snapshot.inboxBookmarkIds)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  );
  if (filters.inbox === "inbox" && !inboxIds.has(bookmark.id)) return false;
  if (filters.inbox === "library" && inboxIds.has(bookmark.id)) return false;
  return true;
}

export function searchUrl(engine: CachedSearchEngine | undefined, query: string): string {
  const template = typeof engine?.searchUrl === "string" && engine.searchUrl
    ? engine.searchUrl
    : DEFAULT_SEARCH_URL;
  const encoded = encodeURIComponent(query);
  if (template.includes("%s")) return template.replaceAll("%s", encoded);
  try {
    const url = new URL(template);
    url.searchParams.set("q", query);
    return url.toString();
  } catch {
    return DEFAULT_SEARCH_URL.replace("%s", encoded);
  }
}

export function preferredSearchEngine(): CachedSearchEngine | undefined {
  const engines = asArray<CachedSearchEngine>(newTabState.snapshot.searchEngines);
  const configuredId = newTabState.settings.newTab.defaultSearchEngineId;
  if (configuredId) {
    const configured = engines.find((engine) => engine?.id === configuredId);
    if (configured) return configured;
  }
  return engines.find((engine) => engine?.isDefault) || engines[0];
}

export function searchEngineCommand(rawQuery: string): { engine: CachedSearchEngine; query: string } | null {
  const trimmed = rawQuery.trim();
  const trimmedLower = trimmed.toLocaleLowerCase();
  for (const engine of asArray<CachedSearchEngine>(newTabState.snapshot.searchEngines)) {
    const keyword = typeof engine?.keyword === "string" ? engine.keyword.trim() : "";
    if (!keyword) continue;
    const forms = [`${keyword} `, `!${keyword} `];
    const matchedForm = forms.find((form) => trimmedLower.startsWith(form.toLocaleLowerCase()));
    if (!matchedForm) continue;
    const query = trimmed.slice(matchedForm.length).trim();
    if (!query) return null;
    return { engine, query };
  }
  return null;
}

function matchingBangEngines(rawQuery: string): CachedSearchEngine[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query.startsWith("!") || /\s/.test(query)) return [];
  const prefix = query.slice(1);
  return asArray<CachedSearchEngine>(newTabState.snapshot.searchEngines)
    .filter((engine) => {
      const keyword = typeof engine?.keyword === "string" ? engine.keyword.trim().toLocaleLowerCase() : "";
      return Boolean(keyword && keyword.startsWith(prefix));
    })
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || String(left.name || "").localeCompare(String(right.name || "")))
    .slice(0, LAUNCHER_RESULT_LIMIT);
}

function collectionMembers(collection: CachedSmartCollection): CachedBookmark[] {
  return asArray<CachedBookmark>(newTabState.snapshot.bookmarks)
    .filter((bookmark) => collectionMatchesBookmark(collection, bookmark))
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
}

function collectionFilterLabels(collection: CachedSmartCollection): string[] {
  const filters = collection?.filters && typeof collection.filters === "object" && !Array.isArray(collection.filters)
    ? collection.filters
    : {};
  const labels: string[] = [];
  if (Object.prototype.hasOwnProperty.call(filters, "categoryId")) {
    labels.push(filters.categoryId === null ? newTabI18n.tx("Uncategorized", "未分类") : categoryName(filters.categoryId));
  }
  for (const tag of asArray<unknown>(filters.tags)) {
    if (typeof tag === "string" && tag.trim()) labels.push(`#${tag.trim()}`);
  }
  if (typeof filters.domain === "string" && filters.domain) labels.push(filters.domain);
  if (typeof filters.healthStatus === "string" && filters.healthStatus) labels.push(filters.healthStatus);
  if (filters.inbox === "inbox") labels.push(newTabI18n.tx("Inbox only", "仅收件箱"));
  if (filters.inbox === "library") labels.push(newTabI18n.tx("Filed library", "已归档书签库"));
  return labels;
}

function browsedCollection(rawQuery: string): CachedSmartCollection | null {
  const query = rawQuery.trim();
  if (!query.startsWith("@")) return null;
  const name = query.slice(1).trim().toLocaleLowerCase();
  if (!name) return null;
  return asArray<CachedSmartCollection>(newTabState.snapshot.smartCollections).find(
    (collection) => typeof collection?.name === "string" && collection.name.trim().toLocaleLowerCase() === name,
  ) ?? null;
}

function collectionBookmarkResult(
  collection: CachedSmartCollection,
  bookmark: CachedBookmark,
  index: number,
): NewTabResult {
  const tags = normalizedTags(bookmark);
  const subtitleParts = [displayHost(bookmark.url), categoryName(bookmark.categoryId), `@${collection.name}`];
  if (tags.length > 0) subtitleParts.push(tags.slice(0, 2).map((tag) => `#${tag}`).join(" "));
  return {
    kind: "bookmark",
    title: bookmark.title || bookmark.url,
    subtitle: subtitleParts.join(" · "),
    url: bookmark.url,
    score: 900 - index,
  };
}

function tabResult(query: string, tab: OpenTabEntry): NewTabResult | null {
  const match = launcherTextScore(query, tab.title, [tab.url], 0);
  if (match < 0) return null;
  return {
    kind: "tab",
    title: tab.title,
    subtitle: tab.url,
    tab,
    score: LAUNCHER_SOURCE_WEIGHT.tab + match,
  };
}

function workspaceResult(query: string, workspace: CachedWorkspace): NewTabResult | null {
  const items = asArray(workspace?.items).filter((item) => isHttpUrl(item?.url));
  const subtitle = newTabI18n.tx(`${items.length} tab${items.length === 1 ? "" : "s"}`, `${items.length} 个标签页`);
  const secondary = [
    workspace?.description,
    subtitle,
    ...items.flatMap((item) => [item?.title, item?.url]),
  ];
  const match = launcherTextScore(query, workspace?.name, secondary, 30);
  if (match < 0) return null;
  return {
    kind: "workspace",
    title: workspace?.name || newTabI18n.tx("Workspace", "工作区"),
    subtitle,
    workspace,
    score: LAUNCHER_SOURCE_WEIGHT.workspace + match,
  };
}

function sessionResult(query: string, session: CachedSession, index: number): NewTabResult | null {
  const items = asArray(session?.items).filter((item) => isHttpUrl(item?.url));
  const sourceDevice = typeof session?.sourceDevice === "string" ? session.sourceDevice.trim() : "";
  const secondary = [
    sourceDevice,
    ...items.flatMap((item) => [item?.title, item?.url]),
  ];
  const match = launcherTextScore(query, session?.name, secondary, Math.max(0, 30 - index));
  if (match < 0) return null;

  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchedItem = items.find((item) => {
    const text = `${item?.title || ""}\n${item?.url || ""}`;
    return terms.length > 0 && terms.every((term) => textContainsTokenOrPinyin(text, term));
  }) ?? null;

  const source = sourceDevice ? ` · ${sourceDevice}` : "";
  const itemMatch = matchedItem
    ? ` · ${matchedItem.title || displayHost(matchedItem.url)} · ${matchedItem.url}`
    : "";
  const countLabel = newTabI18n.tx(`${items.length} tab${items.length === 1 ? "" : "s"}`, `${items.length} 个标签页`);
  return {
    kind: "session",
    title: session?.name || newTabI18n.tx("Session", "会话"),
    subtitle: `${countLabel}${source}${itemMatch}`,
    session,
    score: LAUNCHER_SOURCE_WEIGHT.session + match - index * 0.001,
  };
}

function collectionResult(query: string, collection: CachedSmartCollection): NewTabResult | null {
  if (!collection || typeof collection.name !== "string" || !collection.name.trim()) return null;
  const labels = collectionFilterLabels(collection);
  const name = collection.name.trim();
  const match = launcherTextScore(query, name, labels, 0);
  if (match < 0) return null;

  const count = collectionMembers(collection).length;
  const countLabel = newTabI18n.tx(`${count} bookmark${count === 1 ? "" : "s"}`, `${count} 条书签`);
  const suffix = labels.length > 0
    ? ` · ${labels.slice(0, 4).join(" · ")}`
    : newTabI18n.tx(" · All bookmarks", " · 全部书签");
  return {
    kind: "collection",
    title: name,
    subtitle: `${countLabel}${suffix}`,
    collection,
    score: LAUNCHER_SOURCE_WEIGHT.collection + match,
  };
}

function bookmarkResult(rawQuery: string, bookmark: CachedBookmark): NewTabResult | null {
  if (!isHttpUrl(bookmark?.url)) return null;
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;

  const title = String(bookmark.title || bookmark.url || "");
  const description = String(bookmark.description || "");
  const category = categoryName(bookmark.categoryId);
  const tags = normalizedTags(bookmark);
  const terms = query.split(/\s+/).filter(Boolean);
  const nonTagTerms: string[] = [];
  let tagBonus = 0;

  for (const term of terms) {
    if (term.startsWith("#")) {
      const tagTerm = term.slice(1);
      if (!tagTerm) continue;
      const exact = tags.some((tag) => tag.toLocaleLowerCase() === tagTerm);
      const prefix = tags.some((tag) => tag.toLocaleLowerCase().startsWith(tagTerm));
      const partial = tags.some((tag) => textContainsTokenOrPinyin(tag, tagTerm));
      if (!exact && !prefix && !partial) return null;
      tagBonus += exact ? 24 : prefix ? 16 : 10;
      continue;
    }

    nonTagTerms.push(term);
    const matchesField = textContainsTokenOrPinyin(title, term)
      || tags.some((tag) => textContainsTokenOrPinyin(tag, term))
      || textContainsTokenOrPinyin(category, term)
      || textContainsTokenOrPinyin(description, term)
      || textContainsTokenOrPinyin(bookmark.url, term);
    if (!matchesField) return null;
  }

  const textQuery = nonTagTerms.join(" ");
  const textMatch = textQuery
    ? Math.max(0, launcherTextScore(textQuery, title, [category, description, bookmark.url, ...tags], 0))
    : 0;
  const subtitleParts = [displayHost(bookmark.url), category];
  if (tags.length > 0) subtitleParts.push(tags.slice(0, 3).map((tag) => `#${tag}`).join(" "));
  if (description && tags.length === 0) subtitleParts.push(description.slice(0, 90));

  return {
    kind: "bookmark",
    title,
    subtitle: subtitleParts.join(" · "),
    url: bookmark.url,
    score: LAUNCHER_SOURCE_WEIGHT.bookmark + Math.min(95, textMatch + tagBonus),
  };
}

function regularSearchFallback(query: string): NewTabResult {
  const engine = preferredSearchEngine();
  const keyword = typeof engine?.keyword === "string" ? engine.keyword.trim() : "";
  return {
    kind: "search",
    title: newTabI18n.tx(
      `Search ${engine?.name || "the web"} for “${query}”`,
      `使用 ${engine?.name || "网页搜索"} 搜索“${query}”`,
    ),
    subtitle: keyword
      ? newTabI18n.tx(`Default · !${keyword}`, `默认引擎 · !${keyword}`)
      : newTabI18n.tx("Default search engine", "默认搜索引擎"),
    url: searchUrl(engine, query),
    score: LAUNCHER_SOURCE_WEIGHT.search,
  };
}

export function defaultBuildResults(rawQuery: string): NewTabResult[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const bangMatches = matchingBangEngines(query);
  if (bangMatches.length > 0) {
    return bangMatches.map((engine, index) => ({
      kind: "search-shortcut",
      title: engine.name || `!${engine.keyword || ""}`,
      subtitle: newTabI18n.tx(`!${engine.keyword || ""} · type a query`, `!${engine.keyword || ""} · 输入搜索关键词`),
      engine,
      score: 1200 - index,
    }));
  }

  const directEngine = searchEngineCommand(query);
  if (directEngine) {
    return [{
      kind: "search",
      title: newTabI18n.tx(`Search ${directEngine.engine.name}`, `使用 ${directEngine.engine.name} 搜索`),
      subtitle: directEngine.query,
      url: searchUrl(directEngine.engine, directEngine.query),
      score: 1000,
    }];
  }

  if (query.startsWith("@")) {
    const exactCollection = browsedCollection(query);
    if (exactCollection) {
      return collectionMembers(exactCollection)
        .slice(0, 10)
        .map((bookmark, index) => collectionBookmarkResult(exactCollection, bookmark, index));
    }
    const partialQuery = query.slice(1).trim();
    const collections = asArray<CachedSmartCollection>(newTabState.snapshot.smartCollections);
    if (!partialQuery) {
      return collections
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
        .slice(0, LAUNCHER_RESULT_LIMIT)
        .map((collection, index) => ({
          kind: "collection" as const,
          title: collection.name,
          subtitle: `${collectionMembers(collection).length} ${newTabI18n.tx("bookmarks", "条书签")}`,
          collection,
          score: LAUNCHER_SOURCE_WEIGHT.collection + 50 - index,
        }));
    }
    return collections
      .map((collection) => collectionResult(partialQuery, collection))
      .filter((item): item is NewTabResult => item !== null)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, LAUNCHER_RESULT_LIMIT);
  }

  const deduped = new Map<string, NewTabResult>();
  const addCandidate = (key: string, result: NewTabResult | null) => {
    if (!result) return;
    const current = deduped.get(key);
    if (!current || result.score > current.score) deduped.set(key, result);
  };

  for (const tab of newTabState.openTabs) {
    addCandidate(`tab:${tab.id}`, tabResult(query, tab));
  }
  for (const workspace of asArray<CachedWorkspace>(newTabState.snapshot.workspaces)) {
    addCandidate(`workspace:${workspace?.id || workspace?.name || ""}`, workspaceResult(query, workspace));
  }
  asArray<CachedSession>(newTabState.snapshot.sessions).forEach((session, index) => {
    addCandidate(`session:${session?.id || session?.name || index}`, sessionResult(query, session, index));
  });
  for (const collection of asArray<CachedSmartCollection>(newTabState.snapshot.smartCollections)) {
    addCandidate(`collection:${collection?.id || collection?.name || ""}`, collectionResult(query, collection));
  }
  for (const bookmark of asArray<CachedBookmark>(newTabState.snapshot.bookmarks)) {
    const result = bookmarkResult(query, bookmark);
    if (result?.url) addCandidate(`bookmark:${result.url}`, result);
  }

  const ranked = [...deduped.values()].sort(
    (left, right) => right.score - left.score || left.title.localeCompare(right.title),
  );

  return [
    ...ranked.filter((result) => result.kind !== "search").slice(0, LAUNCHER_RESULT_LIMIT - 1),
    regularSearchFallback(query),
  ];
}
