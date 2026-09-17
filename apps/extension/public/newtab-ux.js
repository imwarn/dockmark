(() => {
  const LOCAL_CACHE_KEY = "dockmarkNewTabCacheV1";
  const originalBuildResults = buildResults;
  const originalExecuteResult = executeResult;
  const originalRefreshCloud = refreshCloud;

  function matchingBangEngines(rawQuery) {
    const query = rawQuery.trim().toLocaleLowerCase();
    if (!query.startsWith("!") || /\s/.test(query)) return [];
    const prefix = query.slice(1);
    return asArray(snapshot.searchEngines)
      .filter((engine) => {
        const keyword = typeof engine?.keyword === "string" ? engine.keyword.trim().toLocaleLowerCase() : "";
        return keyword && keyword.startsWith(prefix);
      })
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0) || String(left.name || "").localeCompare(String(right.name || "")))
      .slice(0, 10);
  }

  function bangSuggestion(engine, index) {
    return {
      kind: "search-shortcut",
      title: engine.name || `!${engine.keyword}`,
      subtitle: `!${engine.keyword} · type a query`,
      engine,
      score: 1200 - index,
    };
  }

  function sessionResult(query, session, index) {
    const items = asArray(session?.items).filter((item) => isHttpUrl(item?.url));
    const source = typeof session?.sourceDevice === "string" && session.sourceDevice.trim()
      ? ` · ${session.sourceDevice.trim()}`
      : "";
    const subtitle = `${items.length} tab${items.length === 1 ? "" : "s"}${source}`;
    const score = searchScore(query, session?.name, subtitle, 390);
    if (score < 0) return null;
    return {
      kind: "session",
      title: session.name || "Session",
      subtitle,
      session,
      score: score - index * 0.001,
    };
  }

  buildResults = function launcherParityResults(rawQuery) {
    const query = rawQuery.trim();
    if (!query) return [];

    const bangMatches = matchingBangEngines(query);
    if (bangMatches.length) return bangMatches.map(bangSuggestion);

    const baseResults = originalBuildResults(rawQuery);
    if (query.startsWith("@") || searchEngineCommand(query)) return baseResults;

    const sessionResults = asArray(snapshot.sessions)
      .map((session, index) => sessionResult(query, session, index))
      .filter(Boolean);

    return [...baseResults, ...sessionResults]
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);
  };

  async function restoreSession(session) {
    const items = asArray(session?.items)
      .filter((item) => isHttpUrl(item?.url))
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
    if (!items.length) return;

    const current = await chrome.tabs.getCurrent().catch(() => null);
    const createdTabIds = [];
    for (const item of items.slice(0, 300)) {
      const created = await chrome.tabs.create({
        url: item.url,
        active: false,
        pinned: Boolean(item.pinned),
      });
      if (created.id != null) createdTabIds.push(created.id);
    }

    const firstTabId = createdTabIds[0];
    if (firstTabId != null) {
      const first = await chrome.tabs.update(firstTabId, { active: true });
      if (first?.windowId != null) await chrome.windows.update(first.windowId, { focused: true });
    }
    if (current?.id != null && current.id !== firstTabId) {
      await chrome.tabs.remove(current.id).catch(() => undefined);
    }
  }

  executeResult = async function launcherParityExecute(result) {
    if (result?.kind === "search-shortcut" && result.engine?.keyword) {
      elements.search.value = `!${result.engine.keyword} `;
      activeResult = 0;
      renderSearchResults();
      elements.search.focus();
      return;
    }
    if (result?.kind === "session" && result.session) {
      await restoreSession(result.session);
      return;
    }
    return originalExecuteResult(result);
  };

  refreshCloud = async function launcherParityRefresh(options = {}) {
    const previousSessions = asArray(snapshot.sessions);
    const refreshed = await originalRefreshCloud(options);
    if (!refreshed || !origin) return refreshed;

    try {
      const sessionPayload = await requestJson("/api/sessions");
      snapshot = {
        ...snapshot,
        sessions: asArray(sessionPayload?.sessions),
      };
      await chrome.storage.local.set({ [LOCAL_CACHE_KEY]: snapshot });
      renderSearchResults();
    } catch {
      if (previousSessions.length) {
        snapshot = { ...snapshot, sessions: previousSessions };
        await chrome.storage.local.set({ [LOCAL_CACHE_KEY]: snapshot });
        renderSearchResults();
      }
    }
    return refreshed;
  };

  function selectedResult() {
    return visibleResults[activeResult] || visibleResults[0] || null;
  }

  async function openResultInTab(result, active) {
    const url = result?.kind === "tab" ? result.tab?.url : result?.url;
    if (!isHttpUrl(url)) {
      await executeResult(result);
      return;
    }
    await chrome.tabs.create({ url, active });
  }

  elements.search.addEventListener("keydown", (event) => {
    const result = selectedResult();

    if (event.key === "Tab" && result?.kind === "search-shortcut") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void executeResult(result);
      return;
    }

    if (event.key !== "Enter" || !result) return;
    if (result.kind === "search-shortcut") {
      event.preventDefault();
      event.stopImmediatePropagation();
      void executeResult(result);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void openResultInTab(result, false);
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void openResultInTab(result, true);
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    event.preventDefault();
    elements.search.focus();
    elements.search.select();
  });

  // Existing local snapshots remain valid. Sessions are additive and appear after the
  // next successful refresh; cached sessions remain available when Dockmark is offline.
  queueMicrotask(() => renderSearchResults());
})();
