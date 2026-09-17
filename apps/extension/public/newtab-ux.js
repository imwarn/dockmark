(() => {
  const LOCAL_CACHE_KEY = "dockmarkNewTabCacheV1";
  const SERVER_URL_KEY = "dockmarkServerUrl";
  const originalBuildResults = buildResults;
  const originalExecuteResult = executeResult;
  const originalRefreshCloud = refreshCloud;
  let sessionHydration = null;

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

  function applySessions(sessions) {
    snapshot = {
      ...snapshot,
      sessions: asArray(sessions),
    };
    renderSearchResults();
  }

  async function persistSessions(sessions) {
    const list = asArray(sessions);
    const stored = await chrome.storage.local.get(LOCAL_CACHE_KEY);
    const cached = stored[LOCAL_CACHE_KEY];
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      await chrome.storage.local.set({
        [LOCAL_CACHE_KEY]: {
          ...cached,
          sessions: list,
        },
      });
    }
    applySessions(list);
  }

  async function requestSessions(serverOrigin) {
    const response = await fetch(new URL("/api/sessions", `${serverOrigin}/`).toString(), {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Dockmark returned ${response.status}.`);
    return response.json();
  }

  async function hasServerOriginPermission(serverOrigin) {
    try {
      return await chrome.permissions.contains({ origins: [`${serverOrigin}/*`] });
    } catch {
      return false;
    }
  }

  async function hydrateSessions(fallbackSessions = []) {
    if (sessionHydration) return sessionHydration;
    sessionHydration = (async () => {
      const stored = await chrome.storage.local.get([SERVER_URL_KEY, LOCAL_CACHE_KEY]);
      const serverOrigin = validOrigin(stored[SERVER_URL_KEY]) || origin;
      const cached = stored[LOCAL_CACHE_KEY];
      if (!serverOrigin) return false;
      if (cached?.origin && cached.origin !== serverOrigin) return false;
      if (!(await hasServerOriginPermission(serverOrigin))) return false;

      try {
        const payload = await requestSessions(serverOrigin);
        await persistSessions(payload?.sessions);
        return true;
      } catch {
        if (fallbackSessions.length && !Array.isArray(cached?.sessions)) {
          await persistSessions(fallbackSessions);
        } else if (Array.isArray(cached?.sessions)) {
          applySessions(cached.sessions);
        }
        return false;
      }
    })().finally(() => {
      sessionHydration = null;
    });
    return sessionHydration;
  }

  refreshCloud = async function launcherParityRefresh(options = {}) {
    const previousSessions = asArray(snapshot.sessions);
    const refreshed = await originalRefreshCloud(options);
    if (!refreshed) return refreshed;

    // Current library refreshes persist Sessions with the normal snapshot. This fallback
    // only covers an early bootstrap that began before the library wrapper was installed.
    if (!Array.isArray(snapshot.sessions)) await hydrateSessions(previousSessions);
    return refreshed;
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[LOCAL_CACHE_KEY]) return;
    const change = changes[LOCAL_CACHE_KEY];
    const nextSessions = change.newValue?.sessions;
    if (Array.isArray(nextSessions)) {
      applySessions(nextSessions);
      return;
    }

    // bootstrap() can start before this UX layer is installed and write a base snapshot
    // without Sessions. Observe that write so the race cannot erase Session search.
    const previousSessions = asArray(change.oldValue?.sessions);
    if (previousSessions.length) applySessions(previousSessions);
    void hydrateSessions(previousSessions);
  });

  void (async () => {
    const stored = await chrome.storage.local.get(LOCAL_CACHE_KEY);
    const cached = stored[LOCAL_CACHE_KEY];
    if (Array.isArray(cached?.sessions)) {
      applySessions(cached.sessions);
      return;
    }
    if (cached?.syncedAt && settings.newTab.autoRefresh === false) return;
    await hydrateSessions();
  })();

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

  function focusLauncher(query, select = false) {
    if (typeof query === "string") {
      elements.search.value = query;
      activeResult = 0;
      renderSearchResults();
    }
    elements.search.focus();
    if (select) elements.search.select();
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
    focusLauncher(undefined, true);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "dockmark:focus-launcher") return undefined;
    focusLauncher(typeof message.query === "string" ? message.query : undefined, typeof message.query !== "string");
    return { ok: true };
  });

  const initialQuery = new URL(window.location.href).searchParams.get("q");
  if (initialQuery) {
    focusLauncher(initialQuery);
    window.history.replaceState({}, "", window.location.pathname);
  }

  queueMicrotask(() => renderSearchResults());
})();
