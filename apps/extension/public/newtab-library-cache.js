/**
 * [INPUT]: depends on globals from newtab.js (refreshCloud, requestJson, hasOriginPermission, snapshot, settings, elements) and window.dockmarkAppearance/dockmarkI18n
 * [OUTPUT]: overrides refreshCloud to atomically cache bookmarks, tags, Smart Collections, Inbox membership, Sessions, appearance, and locale
 * [POS]: single-pass snapshot sync layer loaded after newtab.js in apps/extension/public/newtab.html
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
(() => {
  refreshCloud = async function refreshCloudWithLibraryMetadata({ quiet = false } = {}) {
    if (refreshing || !origin) return false;
    refreshing = true;
    if (!quiet) setConnectionKey("refreshing");

    try {
      if (!(await hasOriginPermission())) {
        throw new Error(
          tx(
            "Dockmark site access is not granted. Open the extension popup and reconnect this origin.",
            "尚未授予 Dockmark 站点访问权限，请打开扩展弹窗重新连接该地址。",
          ),
        );
      }

      const previousSessions = asArray(snapshot.sessions);
      const [bookmarkPayload, categoryPayload, workspacePayload, enginePayload, settingsPayload, appearancePayload] = await Promise.all([
        requestJson("/api/bookmarks"),
        requestJson("/api/categories"),
        requestJson("/api/workspaces"),
        requestJson("/api/search-engines"),
        requestJson("/api/settings/browser"),
        requestJson("/api/settings/appearance").catch(() => null),
      ]);

      let sessions = previousSessions;
      try {
        const sessionPayload = await requestJson("/api/sessions");
        sessions = asArray(sessionPayload?.sessions);
      } catch {
        // Sessions are additive launcher data. A Session-only failure must not turn an
        // otherwise healthy bookmark/workspace refresh into an offline snapshot.
      }

      const bookmarkTags = settingsPayload?.bookmarkTags && typeof settingsPayload.bookmarkTags === "object" && !Array.isArray(settingsPayload.bookmarkTags)
        ? settingsPayload.bookmarkTags
        : {};

      settings = normalizeSettings(settingsPayload?.settings);
      const appearancePreference = window.dockmarkAppearance?.apply(
        appearancePayload?.settings?.preference ?? snapshot.appearancePreference ?? "system",
      ) ?? "system";
      const remoteLocale = typeof appearancePayload?.settings?.locale === "string"
        ? appearancePayload.settings.locale
        : null;
      const localePreference = remoteLocale
        ? (window.dockmarkI18n?.apply(remoteLocale)?.preference ?? "system")
        : (window.dockmarkI18n?.currentPreference() ?? "system");

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
        sessions,
        searchEngines: asArray(enginePayload?.engines),
        smartCollections: asArray(settingsPayload?.smartCollections),
        inboxBookmarkIds: asArray(settingsPayload?.inboxBookmarkIds).filter((id) => typeof id === "string" && id.trim()),
        appearancePreference,
        localePreference,
      };

      await chrome.storage.local.set({
        [CACHE_KEY]: snapshot,
        [SETTINGS_KEY]: settings,
      });
      await loadOpenTabs();
      setConnectionKey("online", "online");
      setOfflineMessage("");
      elements.setup.hidden = true;
      renderSnapshot();
      return true;
    } catch (error) {
      const hasCache = Boolean(snapshot.syncedAt || snapshot.bookmarks.length || snapshot.workspaces.length);
      setConnectionKey(hasCache ? "offline-cache" : "offline", "offline");
      if (hasCache) {
        setOfflineKey("refresh-failed-cached");
      } else {
        setOfflineMessage(
          error instanceof Error
            ? error.message
            : tx(
                "Dockmark is unavailable and there is no local snapshot yet.",
                "无法连接 Dockmark，且当前没有可用的本地快照。",
              ),
        );
      }
      elements.setup.hidden = hasCache;
      return false;
    } finally {
      refreshing = false;
    }
  };
})();
