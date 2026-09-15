(() => {
  const LOCAL_CACHE_KEY = "dockmarkNewTabCacheV1";
  const originalBuildResults = buildResults;
  const originalRefreshCloud = refreshCloud;
  let syncingTags = false;

  function normalizedTags(bookmark) {
    return asArray(bookmark?.tags)
      .filter((tag) => typeof tag === "string" && tag.trim())
      .map((tag) => tag.trim());
  }

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

  buildResults = function enhancedBuildResults(rawQuery) {
    const query = rawQuery.trim();
    if (!query) return [];

    // Keep explicit search-engine commands authoritative.
    if (searchEngineCommand(query)) return originalBuildResults(rawQuery);

    const baseResults = originalBuildResults(rawQuery).filter((result) => result.kind !== "bookmark");
    const bookmarkResults = snapshot.bookmarks
      .map((bookmark) => bookmarkResult(query, bookmark))
      .filter(Boolean);

    const deduped = new Map();
    for (const result of [...baseResults, ...bookmarkResults]) {
      const key = result.kind === "bookmark"
        ? `bookmark:${result.url}`
        : `${result.kind}:${result.url || result.title}`;
      const current = deduped.get(key);
      if (!current || result.score > current.score) deduped.set(key, result);
    }

    return [...deduped.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
  };

  function snapshotNeedsTags(value) {
    return Boolean(
      value?.syncedAt &&
      asArray(value.bookmarks).some((bookmark) => !Array.isArray(bookmark?.tags)),
    );
  }

  async function hydrateBookmarkTags() {
    if (syncingTags || !origin || !snapshot.syncedAt) return false;
    if (!(await hasOriginPermission())) return false;

    syncingTags = true;
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
      };
      await chrome.storage.local.set({ [LOCAL_CACHE_KEY]: snapshot });
      renderSnapshot();
      return true;
    } catch {
      // Tag hydration is additive. Keep the last-known-good snapshot if this optional read fails.
      return false;
    } finally {
      syncingTags = false;
    }
  }

  refreshCloud = async function enhancedRefreshCloud(options = {}) {
    const refreshed = await originalRefreshCloud(options);
    if (refreshed) await hydrateBookmarkTags();
    return refreshed;
  };

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || syncingTags) return;
    const changed = changes[LOCAL_CACHE_KEY]?.newValue;
    if (!snapshotNeedsTags(changed)) return;
    void hydrateBookmarkTags();
  });

  // Existing cached snapshots remain searchable by title/URL/description/category immediately.
  // Tags are hydrated on the next successful cloud refresh; no legacy cache migration is required.
  queueMicrotask(() => renderSearchResults());
})();
