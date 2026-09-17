(() => {
  const SOURCE_WEIGHT = {
    tab: 500,
    workspace: 400,
    session: 350,
    collection: 325,
    bookmark: 300,
    navigation: 200,
    search: 100,
  };
  const KIND_LABEL = {
    tab: "Open tab",
    workspace: "Workspace",
    session: "Session",
    collection: "Collection",
    bookmark: "Bookmark",
    navigation: "Navigation",
    search: "Search",
    "search-shortcut": "Bang",
  };
  const originalBuildResults = buildResults;
  const originalRenderSearchResults = renderSearchResults;

  function parityTextScore(query, primary, secondary = [], base = 0) {
    const needle = String(query || "").trim().toLocaleLowerCase();
    if (!needle) return base;
    const primaryText = String(primary || "").toLocaleLowerCase();
    const secondaryText = secondary.map((value) => String(value || "").toLocaleLowerCase()).join("\n");
    const terms = needle.split(/\s+/).filter(Boolean);
    if (!terms.every((term) => primaryText.includes(term) || secondaryText.includes(term))) return -1;

    let score = base + Math.min(18, Math.max(0, terms.length - 1) * 3);
    if (primaryText === needle) score += 90;
    else if (primaryText.startsWith(needle)) score += 60;
    else if (primaryText.includes(needle)) score += 35;
    else if (secondaryText.includes(needle)) score += 15;
    else score += 8;
    return score;
  }

  function sourceForKind(kind) {
    return kind === "search-shortcut" ? "search" : kind;
  }

  function canonicalScore(query, result) {
    const source = sourceForKind(result?.kind);
    const weight = SOURCE_WEIGHT[source] ?? 0;
    const match = parityTextScore(query, result?.title, [result?.subtitle], 0);
    return weight + Math.max(0, match);
  }

  function workspaceResult(query, workspace) {
    const items = asArray(workspace?.items).filter((item) => isHttpUrl(item?.url));
    const subtitle = `${items.length} tab${items.length === 1 ? "" : "s"}`;
    const secondary = [workspace?.description, subtitle, ...items.flatMap((item) => [item?.title, item?.url])];
    const match = parityTextScore(query, workspace?.name, secondary, 30);
    if (match < 0) return null;
    return {
      kind: "workspace",
      title: workspace?.name || "Workspace",
      subtitle,
      workspace,
      score: SOURCE_WEIGHT.workspace + match,
    };
  }

  function sessionResult(query, session, index) {
    const items = asArray(session?.items).filter((item) => isHttpUrl(item?.url));
    const sourceDevice = typeof session?.sourceDevice === "string" ? session.sourceDevice.trim() : "";
    const secondary = [sourceDevice, ...items.flatMap((item) => [item?.title, item?.url])];
    const match = parityTextScore(query, session?.name, secondary, Math.max(0, 30 - index));
    if (match < 0) return null;

    const terms = String(query || "").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matchedItem = items.find((item) => {
      const text = `${item?.title || ""}\n${item?.url || ""}`.toLocaleLowerCase();
      return terms.length > 0 && terms.every((term) => text.includes(term));
    }) || null;
    const source = sourceDevice ? ` · ${sourceDevice}` : "";
    const itemMatch = matchedItem ? ` · ${matchedItem.title || displayHost(matchedItem.url)} · ${matchedItem.url}` : "";
    return {
      kind: "session",
      title: session?.name || "Session",
      subtitle: `${items.length} tab${items.length === 1 ? "" : "s"}${source}${itemMatch}`,
      session,
      score: SOURCE_WEIGHT.session + match - index * 0.001,
    };
  }

  buildResults = function parityBuildResults(rawQuery) {
    const query = rawQuery.trim();
    if (!query) return [];

    const existing = originalBuildResults(rawQuery);
    if (query.startsWith("@") || searchEngineCommand(query) || (existing.length && existing.every((result) => result.kind === "search-shortcut"))) {
      return existing;
    }

    const deduped = new Map();
    for (const result of existing) {
      if (result.kind === "workspace" || result.kind === "session") continue;
      deduped.set(`${result.kind}:${result.url || result.collection?.id || result.title}`, {
        ...result,
        score: canonicalScore(query, result),
      });
    }

    for (const workspace of asArray(snapshot.workspaces)) {
      const result = workspaceResult(query, workspace);
      if (result) deduped.set(`workspace:${workspace?.id || result.title}`, result);
    }
    asArray(snapshot.sessions).forEach((session, index) => {
      const result = sessionResult(query, session, index);
      if (result) deduped.set(`session:${session?.id || result.title}`, result);
    });

    return [...deduped.values()]
      .sort((left, right) => right.score - left.score || String(left.title || "").localeCompare(String(right.title || "")))
      .slice(0, 10);
  };

  renderSearchResults = function parityRenderSearchResults() {
    originalRenderSearchResults();
    const labels = elements.results.querySelectorAll(".result-kind");
    labels.forEach((label, index) => {
      const kind = visibleResults[index]?.kind;
      label.textContent = KIND_LABEL[kind] || kind || "";
    });
  };

  elements.search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || elements.search.value) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    elements.search.blur();
  }, true);

  queueMicrotask(() => renderSearchResults());
})();
