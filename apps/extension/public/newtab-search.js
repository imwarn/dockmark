/**
 * [INPUT]: depends on globals from newtab.js (buildResults, executeResult, refreshCloud, collectionMatchesBookmark, normalizedTags, tx)
 * [OUTPUT]: enhances buildResults and executeResult with #tag filtering, Smart Collection search, and @Collection browsing
 * [POS]: local-first Smart Collection and tag search layer loaded after newtab-library-cache.js in apps/extension/public/newtab.html
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
(() => {
  const LOCAL_CACHE_KEY = "dockmarkNewTabCacheV1";
  const originalBuildResults = buildResults;
  const originalRefreshCloud = refreshCloud;
  const originalExecuteResult = executeResult;
  let syncingLibraryMetadata = false;

  function bookmarkResult(rawQuery, bookmark) {
    if (!isHttpUrl(bookmark?.url)) return null;
    const query = rawQuery.trim().toLocaleLowerCase();
    if (!query) return null;

    const title = String(bookmark.title || bookmark.url || "");
    const titleLower = title.toLocaleLowerCase();
    const urlLower = String(bookmark.url || "").toLocaleLowerCase();
    const description = String(bookmark.description || "");
    const descriptionLower = description.toLocaleLowerCase();
    const category = categoryName(bookmark.categoryId);
    const categoryLower = category.toLocaleLowerCase();
    const tags = normalizedTags(bookmark);
    const tagsLower = tags.map((tag) => tag.toLocaleLowerCase());
    const terms = query.split(/\s+/).filter(Boolean);

    let score = 300;
    for (const term of terms) {
      if (term.startsWith("#")) {
        const tagTerm = term.slice(1);
        if (!tagTerm) continue;
        const exact = tagsLower.some((tag) => tag === tagTerm);
        const prefix = tagsLower.some((tag) => tag.startsWith(tagTerm));
        const partial = tagsLower.some((tag) => tag.includes(tagTerm));
        if (!exact && !prefix && !partial) return null;
        score += exact ? 90 : prefix ? 60 : 35;
        continue;
      }

      if (titleLower === term) score += 90;
      else if (titleLower.startsWith(term)) score += 60;
      else if (titleLower.includes(term)) score += 40;
      else if (tagsLower.some((tag) => tag === term)) score += 36;
      else if (tagsLower.some((tag) => tag.includes(term))) score += 28;
      else if (categoryLower.includes(term)) score += 24;
      else if (descriptionLower.includes(term)) score += 20;
      else if (urlLower.includes(term)) score += 18;
      else return null;
    }

    const subtitleParts = [displayHost(bookmark.url), category];
    if (tags.length) subtitleParts.push(tags.slice(0, 3).map((tag) => `#${tag}`).join(" "));
    if (description && !tags.length) subtitleParts.push(description.slice(0, 90));

    return {
      kind: "bookmark",
      title,
      subtitle: subtitleParts.join(" · "),
      url: bookmark.url,
      score,
    };
  }

  function collectionMembers(collection) {
    return asArray(snapshot.bookmarks)
      .filter((bookmark) => collectionMatchesBookmark(collection, bookmark))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  }

  function collectionFilterLabels(collection) {
    const filters = collection?.filters && typeof collection.filters === "object" && !Array.isArray(collection.filters)
      ? collection.filters
      : {};
    const labels = [];
    if (Object.prototype.hasOwnProperty.call(filters, "categoryId")) {
      labels.push(filters.categoryId === null ? tx("Uncategorized", "未分类") : categoryName(filters.categoryId));
    }
    for (const tag of asArray(filters.tags)) {
      if (typeof tag === "string" && tag.trim()) labels.push(`#${tag.trim()}`);
    }
    if (typeof filters.domain === "string" && filters.domain) labels.push(filters.domain);
    if (typeof filters.healthStatus === "string" && filters.healthStatus) labels.push(filters.healthStatus);
    if (filters.inbox === "inbox") labels.push(tx("Inbox only", "仅收件箱"));
    if (filters.inbox === "library") labels.push(tx("Filed library", "已归档书签库"));
    return labels;
  }

  function collectionResult(rawQuery, collection) {
    if (!collection || typeof collection.name !== "string" || !collection.name.trim()) return null;
    const query = rawQuery.trim().toLocaleLowerCase();
    if (!query || query.startsWith("@")) return null;
    const labels = collectionFilterLabels(collection);
    const haystack = [collection.name, ...labels].join(" ").toLocaleLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    if (!terms.every((term) => haystack.includes(term))) return null;

    const name = collection.name.trim();
    const nameLower = name.toLocaleLowerCase();
    let score = 420;
    if (nameLower === query) score += 100;
    else if (nameLower.startsWith(query)) score += 70;
    else if (nameLower.includes(query)) score += 45;
    else score += 20;
    const count = collectionMembers(collection).length;
    const countLabel = tx(`${count} bookmark${count === 1 ? "" : "s"}`, `${count} 条书签`);
    const suffix = labels.length
      ? ` · ${labels.slice(0, 4).join(" · ")}`
      : tx(" · All bookmarks", " · 全部书签");

    return {
      kind: "collection",
      title: name,
      subtitle: `${countLabel}${suffix}`,
      collection,
      score,
    };
  }

  function browsedCollection(rawQuery) {
    const query = rawQuery.trim();
    if (!query.startsWith("@")) return null;
    const name = query.slice(1).trim().toLocaleLowerCase();
    if (!name) return null;
    return asArray(snapshot.smartCollections).find((collection) =>
      typeof collection?.name === "string" && collection.name.trim().toLocaleLowerCase() === name,
    ) || null;
  }

  function collectionBookmarkResult(collection, bookmark, index) {
    const tags = normalizedTags(bookmark);
    const subtitleParts = [displayHost(bookmark.url), categoryName(bookmark.categoryId), `@${collection.name}`];
    if (tags.length) subtitleParts.push(tags.slice(0, 2).map((tag) => `#${tag}`).join(" "));
    return {
      kind: "bookmark",
      title: bookmark.title || bookmark.url,
      subtitle: subtitleParts.join(" · "),
      url: bookmark.url,
      score: 900 - index,
    };
  }

  buildResults = function enhancedBuildResults(rawQuery) {
    const query = rawQuery.trim();
    if (!query) return [];

    // Keep explicit search-engine commands authoritative.
    if (searchEngineCommand(query)) return originalBuildResults(rawQuery);

    const collection = browsedCollection(query);
    if (collection) {
      return collectionMembers(collection)
        .slice(0, 10)
        .map((bookmark, index) => collectionBookmarkResult(collection, bookmark, index));
    }

    const baseResults = originalBuildResults(rawQuery).filter((result) => result.kind !== "bookmark");
    const bookmarkResults = snapshot.bookmarks
      .map((bookmark) => bookmarkResult(query, bookmark))
      .filter(Boolean);
    const collectionResults = asArray(snapshot.smartCollections)
      .map((candidate) => collectionResult(query, candidate))
      .filter(Boolean);

    const deduped = new Map();
    for (const result of [...baseResults, ...collectionResults, ...bookmarkResults]) {
      const key = result.kind === "bookmark"
        ? `bookmark:${result.url}`
        : result.kind === "collection"
          ? `collection:${result.collection?.id || result.title}`
          : `${result.kind}:${result.url || result.title}`;
      const current = deduped.get(key);
      if (!current || result.score > current.score) deduped.set(key, result);
    }

    return [...deduped.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
  };

  executeResult = async function enhancedExecuteResult(result) {
    if (result?.kind === "collection" && result.collection?.name) {
      elements.search.value = `@${result.collection.name}`;
      activeResult = 0;
      renderSearchResults();
      elements.search.focus();
      return;
    }
    return originalExecuteResult(result);
  };

  function snapshotNeedsLibraryMetadata(value) {
    return Boolean(
      value?.syncedAt && (
        asArray(value.bookmarks).some((bookmark) => !Array.isArray(bookmark?.tags)) ||
        !Array.isArray(value.smartCollections) ||
        !Array.isArray(value.inboxBookmarkIds)
      ),
    );
  }

  async function hydrateLibraryMetadata() {
    if (syncingLibraryMetadata || !origin || !snapshot.syncedAt) return false;
    if (!(await hasOriginPermission())) return false;

    syncingLibraryMetadata = true;
    try {
      const payload = await requestJson("/api/settings/browser");
      const bookmarkTags = payload?.bookmarkTags && typeof payload.bookmarkTags === "object"
        ? payload.bookmarkTags
        : {};
      snapshot = {
        ...snapshot,
        bookmarks: asArray(snapshot.bookmarks).map((bookmark) => ({
          ...bookmark,
          tags: asArray(bookmarkTags[bookmark?.id]).filter((tag) => typeof tag === "string" && tag.trim()),
        })),
        smartCollections: asArray(payload?.smartCollections),
        inboxBookmarkIds: asArray(payload?.inboxBookmarkIds).filter((id) => typeof id === "string" && id.trim()),
      };
      await chrome.storage.local.set({ [LOCAL_CACHE_KEY]: snapshot });
      renderSnapshot();
      renderSearchResults();
      return true;
    } catch {
      return false;
    } finally {
      syncingLibraryMetadata = false;
    }
  }

  refreshCloud = async function enhancedRefreshCloud(options = {}) {
    const refreshed = await originalRefreshCloud(options);
    if (refreshed && snapshotNeedsLibraryMetadata(snapshot)) await hydrateLibraryMetadata();
    return refreshed;
  };

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || syncingLibraryMetadata) return;
    const changed = changes[LOCAL_CACHE_KEY]?.newValue;
    if (!snapshotNeedsLibraryMetadata(changed)) return;
    void hydrateLibraryMetadata();
  });

  function hydrateLegacySnapshotWhenReady(attempt = 0) {
    if (snapshotNeedsLibraryMetadata(snapshot)) {
      void hydrateLibraryMetadata();
      return;
    }
    if (!snapshot.syncedAt && attempt < 10) {
      setTimeout(() => hydrateLegacySnapshotWhenReady(attempt + 1), 50);
    }
  }

  setTimeout(() => hydrateLegacySnapshotWhenReady(), 0);
  queueMicrotask(() => renderSearchResults());
})();
