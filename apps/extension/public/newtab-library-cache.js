(() => {
  refreshCloud = async function refreshCloudWithLibraryMetadata({ quiet = false } = {}) {
    if (refreshing || !origin) return false;
    refreshing = true;
    if (!quiet) setConnection("Refreshing…");

    try {
      if (!(await hasOriginPermission())) {
        throw new Error("Dockmark site access is not granted. Open the extension popup and reconnect this origin.");
      }

      const [bookmarkPayload, categoryPayload, workspacePayload, enginePayload, settingsPayload] = await Promise.all([
        requestJson("/api/bookmarks"),
        requestJson("/api/categories"),
        requestJson("/api/workspaces"),
        requestJson("/api/search-engines"),
        requestJson("/api/settings/browser"),
      ]);

      const bookmarkTags = settingsPayload?.bookmarkTags && typeof settingsPayload.bookmarkTags === "object" && !Array.isArray(settingsPayload.bookmarkTags)
        ? settingsPayload.bookmarkTags
        : {};

      settings = normalizeSettings(settingsPayload?.settings);
      snapshot = {
        version: CACHE_VERSION,
        origin,
        syncedAt: new Date().toISOString(),
        bookmarks: asArray(bookmarkPayload?.bookmarks).map((bookmark) => ({
          ...bookmark,
          tags: asArray(bookmarkTags[bookmark?.id]).filter((tag) => typeof tag === "string" && tag.trim()),
        })),
        categories: asArray(categoryPayload?.categories),
        workspaces: asArray(workspacePayload?.workspaces),
        searchEngines: asArray(enginePayload?.engines),
        smartCollections: asArray(settingsPayload?.smartCollections),
        inboxBookmarkIds: asArray(settingsPayload?.inboxBookmarkIds).filter((id) => typeof id === "string" && id.trim()),
      };

      await chrome.storage.local.set({
        [CACHE_KEY]: snapshot,
        [SETTINGS_KEY]: settings,
      });
      await loadOpenTabs();
      setConnection("Online · synced", "online");
      setOfflineMessage("");
      elements.setup.hidden = true;
      renderSnapshot();
      return true;
    } catch (error) {
      const hasCache = Boolean(snapshot.syncedAt || snapshot.bookmarks.length || snapshot.workspaces.length);
      setConnection(hasCache ? "Offline cache" : "Offline", "offline");
      setOfflineMessage(
        hasCache
          ? `Cloud refresh failed. Using the local snapshot from ${timeAgo(snapshot.syncedAt)}. Search and launch still work.`
          : (error instanceof Error ? error.message : "Dockmark is unavailable and there is no local snapshot yet."),
      );
      elements.setup.hidden = hasCache;
      return false;
    } finally {
      refreshing = false;
    }
  };
})();
