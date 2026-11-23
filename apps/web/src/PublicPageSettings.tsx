/**
 * [INPUT]: depends on Bookmark, Category, PublicPageLayout, PublicPageSettings from @dockmark/core; textMatchesQuery from ./bookmark-search; fetchPublicPageSettings, readLocalPublicPageSettings, savePublicPageSettings from ./public-settings-api; reorderBookmarks/reorderCategories from ./reorder-api; useI18n from ./i18n
 * [OUTPUT]: exports PublicPageSettings panel for Personal Navigation Station configuration, single/bulk bookmark publishing, and canonical public group ordering
 * [POS]: Mounted in SettingsPage under /app/settings/public. Manages /api/settings/public-page and /api/public/bookmarks/* selection while sharing canonical Library ordering.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Bookmark, Category, PublicPageLayout, PublicPageSettings as PublicSiteConfig } from "@dockmark/core";
import { textMatchesQuery } from "./bookmark-search";
import { useI18n } from "./i18n";
import {
  fetchPublicPageSettings,
  readLocalPublicPageSettings,
  savePublicPageSettings,
} from "./public-settings-api";
import { reorderBookmarks, reorderCategories } from "./reorder-api";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  onChanged: () => Promise<void>;
}

type PublicationFilter = "all" | "published" | "unpublished";

async function loadSelection() {
  const response = await fetch("/api/public/bookmarks/selection", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { bookmarkIds?: string[]; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Could not load public selection (${response.status}).`);
  return new Set(Array.isArray(payload.bookmarkIds) ? payload.bookmarkIds : []);
}

async function setPublished(id: string, published: boolean) {
  const response = await fetch(`/api/public/bookmarks/${encodeURIComponent(id)}`, {
    method: published ? "PUT" : "DELETE",
  });
  if (response.status === 204) return;
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Could not update public page (${response.status}).`);
}

function swapIds(ids: string[], leftId: string, rightId: string) {
  const left = ids.indexOf(leftId);
  const right = ids.indexOf(rightId);
  if (left < 0 || right < 0) return ids;
  const next = [...ids];
  [next[left], next[right]] = [next[right]!, next[left]!];
  return next;
}

export function PublicPageSettings({ bookmarks, categories, onChanged }: Props) {
  const { tx } = useI18n();
  const [siteConfig, setSiteConfig] = useState<PublicSiteConfig>(() => readLocalPublicPageSettings());
  const [siteSaving, setSiteSaving] = useState(false);
  const [published, setPublishedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState<"publish" | "unpublish" | null>(null);
  const [sorting, setSorting] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PublicationFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectVisibleRef = useRef<HTMLInputElement>(null);
  const publishSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadSelection(), fetchPublicPageSettings().catch(() => null)])
      .then(([ids, remoteSiteConfig]) => {
        if (cancelled) return;
        setPublishedIds(ids);
        if (remoteSiteConfig) setSiteConfig(remoteSiteConfig);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : tx("Could not load public page settings.", "无法加载公开主页配置。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tx]);

  async function saveSiteConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSiteSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await savePublicPageSettings({
        siteTitle: siteConfig.siteTitle.trim(),
        siteSubtitle: siteConfig.siteSubtitle.trim(),
        defaultLayout: siteConfig.defaultLayout,
        showSearchBar: siteConfig.showSearchBar,
        showWebSearch: siteConfig.showWebSearch,
        showCategoryNav: siteConfig.showCategoryNav,
        openInNewTab: siteConfig.openInNewTab,
      });
      setSiteConfig(saved);
      setNotice(tx("Navigation station settings saved.", "导航站外观与交互配置已保存。"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not save navigation station settings.", "保存导航站配置失败。"));
    } finally {
      setSiteSaving(false);
    }
  }

  useEffect(() => {
    const activeIds = new Set(bookmarks.map((bookmark) => bookmark.id));
    setSelectedIds((current) => new Set([...current].filter((id) => activeIds.has(id))));
  }, [bookmarks]);

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const bookmarksByCategory = useMemo(() => {
    const map = new Map<string, Bookmark[]>();
    for (const bookmark of bookmarks) {
      const key = bookmark.categoryId ?? "";
      const list = map.get(key) ?? [];
      list.push(bookmark);
      map.set(key, list);
    }
    return map;
  }, [bookmarks]);

  const groups = useMemo(() => {
    const categoryGroups = categories.map((category) => ({
      id: category.id,
      name: category.name,
      bookmarks: (bookmarksByCategory.get(category.id) ?? []).filter((bookmark) => published.has(bookmark.id)),
    }));
    const uncategorized = (bookmarksByCategory.get("") ?? []).filter((bookmark) => published.has(bookmark.id));
    return [
      ...categoryGroups.filter((group) => group.bookmarks.length),
      ...(uncategorized.length ? [{ id: "", name: tx("Uncategorized", "未分类"), bookmarks: uncategorized }] : []),
    ];
  }, [bookmarksByCategory, categories, published, tx]);

  const filteredBookmarks = useMemo(
    () => bookmarks.filter((bookmark) => {
      const isPublished = published.has(bookmark.id);
      if (filter === "published" && !isPublished) return false;
      if (filter === "unpublished" && isPublished) return false;
      const categoryName = bookmark.categoryId ? categoryNameById.get(bookmark.categoryId) ?? "" : tx("Uncategorized", "未分类");
      return textMatchesQuery(query, [
        bookmark.title,
        bookmark.url,
        bookmark.description ?? "",
        categoryName,
      ]);
    }),
    [bookmarks, categoryNameById, filter, published, query, tx],
  );

  const publishedCount = published.size;
  const unpublishedCount = Math.max(0, bookmarks.length - publishedCount);
  const visibleSelectedCount = filteredBookmarks.filter((bookmark) => selectedIds.has(bookmark.id)).length;
  const allVisibleSelected = filteredBookmarks.length > 0 && visibleSelectedCount === filteredBookmarks.length;

  useEffect(() => {
    if (selectVisibleRef.current) {
      selectVisibleRef.current.indeterminate = visibleSelectedCount > 0 && !allVisibleSelected;
    }
  }, [allVisibleSelected, visibleSelectedCount]);

  async function toggle(bookmark: Bookmark) {
    const nextPublished = !published.has(bookmark.id);
    setBusyId(bookmark.id);
    setError(null);
    setNotice(null);
    try {
      await setPublished(bookmark.id, nextPublished);
      setPublishedIds((current) => {
        const next = new Set(current);
        if (nextPublished) next.add(bookmark.id);
        else next.delete(bookmark.id);
        return next;
      });
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(bookmark.id);
        return next;
      });
      setNotice(
        nextPublished
          ? tx(`Published “${bookmark.title}”.`, `已公开“${bookmark.title}”。`)
          : tx(`Unpublished “${bookmark.title}”.`, `已取消公开“${bookmark.title}”。`),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not update this bookmark.", "更新该书签状态失败。"));
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    const visibleIds = filteredBookmarks.map((bookmark) => bookmark.id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function updateSelection(nextPublished: boolean) {
    const selected = [...selectedIds];
    if (!selected.length) return;

    const idsToUpdate = selected.filter((id) => published.has(id) !== nextPublished);
    if (!idsToUpdate.length) {
      setSelectedIds(new Set());
      setNotice(
        nextPublished
          ? tx("Every selected bookmark is already published.", "所选书签均已处于公开状态。")
          : tx("Every selected bookmark is already unpublished.", "所选书签均已处于未公开状态。"),
      );
      return;
    }

    setBatchBusy(nextPublished ? "publish" : "unpublish");
    setError(null);
    setNotice(null);
    const failedIds = new Set<string>();
    let updated = 0;

    try {
      const chunkSize = 12;
      for (let offset = 0; offset < idsToUpdate.length; offset += chunkSize) {
        const chunk = idsToUpdate.slice(offset, offset + chunkSize);
        const results = await Promise.allSettled(chunk.map((id) => setPublished(id, nextPublished)));
        results.forEach((result, index) => {
          const id = chunk[index];
          if (!id) return;
          if (result.status === "fulfilled") updated += 1;
          else failedIds.add(id);
        });
      }

      setPublishedIds((current) => {
        const next = new Set(current);
        idsToUpdate.forEach((id) => {
          if (failedIds.has(id)) return;
          if (nextPublished) next.add(id);
          else next.delete(id);
        });
        return next;
      });
      setSelectedIds(failedIds);

      if (failedIds.size) {
        setError(
          tx(
            `${updated} bookmark${updated === 1 ? "" : "s"} updated; ${failedIds.size} failed and remain selected for retry.`,
            `已更新 ${updated} 条书签；${failedIds.size} 条失败，已保留选中状态以便重试。`,
          ),
        );
      } else {
        setNotice(
          nextPublished
            ? tx(`Published ${updated} bookmark${updated === 1 ? "" : "s"}.`, `已公开 ${updated} 条书签。`)
            : tx(`Unpublished ${updated} bookmark${updated === 1 ? "" : "s"}.`, `已取消公开 ${updated} 条书签。`),
        );
      }
    } finally {
      setBatchBusy(null);
    }
  }

  async function moveCategory(groupId: string, direction: -1 | 1) {
    if (!groupId) return;
    const publicCategoryIds = groups.map((group) => group.id).filter(Boolean);
    const index = publicCategoryIds.indexOf(groupId);
    const targetId = publicCategoryIds[index + direction];
    if (!targetId) return;
    const allIds = categories.map((category) => category.id);
    setSorting(true);
    setError(null);
    setNotice(null);
    try {
      await reorderCategories(swapIds(allIds, groupId, targetId));
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not reorder public categories.", "调整分类顺序失败。"));
    } finally {
      setSorting(false);
    }
  }

  async function moveBookmark(bookmark: Bookmark, direction: -1 | 1) {
    const categoryKey = bookmark.categoryId ?? "";
    const publicIds = (bookmarksByCategory.get(categoryKey) ?? [])
      .filter((candidate) => published.has(candidate.id))
      .map((candidate) => candidate.id);
    const index = publicIds.indexOf(bookmark.id);
    const targetId = publicIds[index + direction];
    if (!targetId) return;
    const allIds = (bookmarksByCategory.get(categoryKey) ?? []).map((candidate) => candidate.id);
    setSorting(true);
    setError(null);
    setNotice(null);
    try {
      await reorderBookmarks(bookmark.categoryId ?? null, swapIds(allIds, bookmark.id, targetId));
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not reorder public bookmarks.", "调整书签顺序失败。"));
    } finally {
      setSorting(false);
    }
  }

  const mutationBusy = Boolean(batchBusy || busyId);

  return (
    <section className="public-settings-section" aria-labelledby="public-settings-title">
      <div className="settings-heading">
        <div>
          <h2 id="public-settings-title">{tx("Public Page Curation", "公开主页管理")}</h2>
          <p>
            {tx(
              "Public groups reuse your canonical Library order so Web, New Tab and the public page always stay aligned.",
              "公开分组直接复用书签库的统一排序，确保网页工作台、新标签页与公开主页展示顺序一致。",
            )}
          </p>
        </div>
        <div className="settings-sync-state">
          <strong>{tx(`${publishedCount} published`, `已公开 ${publishedCount} 条`)}</strong>
          <a className="text-action" href="/" target="_blank" rel="noreferrer">
            {tx("Open public page ↗", "打开公开主页 ↗")}
          </a>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <form className="form-card public-site-config-card" onSubmit={(event) => void saveSiteConfig(event)}>
        <div className="card-heading">
          <div>
            <h2>{tx("Navigation Station Appearance & Behavior", "导航站外观与交互配置")}</h2>
            <p>
              {tx(
                "Customize the public root page (/) title, default density, search engines, and link opening behavior.",
                "自定义公开主页（/）的站点标题、默认视图密度、外网搜索引擎栏与链接打开方式。",
              )}
            </p>
          </div>
          <span>{tx("Applies to /", "生效于 /")}</span>
        </div>

        <div className="public-site-config-grid">
          <label className="settings-field">
            <span>{tx("Custom site title", "自定义站点标题")}</span>
            <input
              type="text"
              value={siteConfig.siteTitle}
              onChange={(event) => setSiteConfig((current) => ({ ...current, siteTitle: event.target.value }))}
              placeholder={tx("Curated links", "个人导航")}
              maxLength={80}
            />
          </label>
          <label className="settings-field">
            <span>{tx("Site subtitle / intro", "站点简介 / 副标题")}</span>
            <input
              type="text"
              value={siteConfig.siteSubtitle}
              onChange={(event) => setSiteConfig((current) => ({ ...current, siteSubtitle: event.target.value }))}
              placeholder={tx("Curated bookmarks and quick web search.", "精选导航与快捷搜索。")}
              maxLength={200}
            />
          </label>
        </div>

        <div className="public-site-config-layout">
          <span>{tx("Default layout", "默认布局")}</span>
          <div className="settings-segmented" role="group" aria-label={tx("Default public layout", "公开主页默认布局")}>
            {([
              ["grid", tx("Standard Grid", "标准卡片 Grid")],
              ["compact", tx("Compact Nav", "紧凑导航 Compact")],
              ["list", tx("Detailed List", "详情列表 List")],
            ] as Array<[PublicPageLayout, string]>).map(([layoutValue, label]) => (
              <button
                key={layoutValue}
                type="button"
                className={siteConfig.defaultLayout === layoutValue ? "active" : ""}
                onClick={() => setSiteConfig((current) => ({ ...current, defaultLayout: layoutValue }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-options-grid">
          <label className="settings-toggle">
            <span>
              <strong>{tx("Show startpage search bar", "显示导航搜索框")}</strong>
              <small>{tx("Allow instant local filtering (with Pinyin initials) on /.", "在主页顶部显示搜索框，支持标题、域名与拼音首字母筛选。")}</small>
            </span>
            <input
              type="checkbox"
              checked={siteConfig.showSearchBar}
              onChange={(event) => setSiteConfig((current) => ({ ...current, showSearchBar: event.target.checked }))}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>{tx("Enable web search engines", "启用外网搜索引擎栏")}</strong>
              <small>{tx("Show quick Google, Bing, GitHub, DuckDuckGo and Baidu search pills.", "在搜索框上方提供 Google、Bing、GitHub、DuckDuckGo、百度直达切换。")}</small>
            </span>
            <input
              type="checkbox"
              checked={siteConfig.showWebSearch}
              disabled={!siteConfig.showSearchBar}
              onChange={(event) => setSiteConfig((current) => ({ ...current, showWebSearch: event.target.checked }))}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>{tx("Show category quick-filter bar", "显示分类快捷筛选栏")}</strong>
              <small>{tx("Display scrollable category pills above bookmark groups.", "在书签分组上方展示横向分类标签栏，支持一键筛选。")}</small>
            </span>
            <input
              type="checkbox"
              checked={siteConfig.showCategoryNav}
              onChange={(event) => setSiteConfig((current) => ({ ...current, showCategoryNav: event.target.checked }))}
            />
          </label>
          <label className="settings-toggle">
            <span>
              <strong>{tx("Open links in new tab", "新标签页打开链接")}</strong>
              <small>{tx("Applies to both public bookmark cards and web search actions.", "同时作用于公开书签卡片与外网搜索跳转。")}</small>
            </span>
            <input
              type="checkbox"
              checked={siteConfig.openInNewTab}
              onChange={(event) => setSiteConfig((current) => ({ ...current, openInNewTab: event.target.checked }))}
            />
          </label>
        </div>

        <div className="public-site-config-footer">
          <small>
            {tx(
              "Visitors can still switch Grid / Compact / List locally in their browser without changing your D1 defaults.",
              "访客仍可在自己浏览器中本地切换网格 / 紧凑 / 列表视图，不会覆盖你的 D1 默认配置。",
            )}
          </small>
          <button className="primary" type="submit" disabled={siteSaving}>
            {siteSaving ? tx("Saving…", "保存中…") : tx("Save navigation settings", "保存导航站配置")}
          </button>
        </div>
      </form>

      <div className="public-curation-layout">
        <article className="form-card public-layout-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Public layout", "公开列表预览与排序")}</h2>
              <p>{tx("Reorder published categories and links directly here.", "直接上下调整已公开分类与链接顺序。")}</p>
            </div>
            <span>{tx(`${groups.length} groups`, `${groups.length} 个分组`)}</span>
          </div>

          <div className="public-layout-groups">
            {groups.map((group, groupIndex) => (
              <section className="public-layout-group" key={group.id || "uncategorized"}>
                <header>
                  <div>
                    <strong>{group.name}</strong>
                    <span>{tx(`${group.bookmarks.length} links`, `${group.bookmarks.length} 条链接`)}</span>
                  </div>
                  {group.id && (
                    <div className="public-order-actions">
                      <button
                        className="text-action"
                        type="button"
                        disabled={sorting || groupIndex === 0}
                        onClick={() => void moveCategory(group.id, -1)}
                      >
                        {tx("↑ Group", "↑ 上移分组")}
                      </button>
                      <button
                        className="text-action"
                        type="button"
                        disabled={sorting || groupIndex === groups.length - 1 || !groups[groupIndex + 1]?.id}
                        onClick={() => void moveCategory(group.id, 1)}
                      >
                        {tx("↓ Group", "↓ 下移分组")}
                      </button>
                    </div>
                  )}
                </header>

                <div className="public-layout-items">
                  {group.bookmarks.map((bookmark, index) => (
                    <div className="public-layout-item" key={bookmark.id}>
                      <span className="drag-handle" aria-hidden="true">⠿</span>
                      <span>
                        <strong>{bookmark.title}</strong>
                        <small>{bookmark.url}</small>
                      </span>
                      <div className="public-order-actions">
                        <button
                          className="text-action"
                          type="button"
                          aria-label={tx("Move up", "上移")}
                          disabled={sorting || index === 0}
                          onClick={() => void moveBookmark(bookmark, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="text-action"
                          type="button"
                          aria-label={tx("Move down", "下移")}
                          disabled={sorting || index === group.bookmarks.length - 1}
                          onClick={() => void moveBookmark(bookmark, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="danger-text text-action"
                          type="button"
                          disabled={mutationBusy}
                          onClick={() => void toggle(bookmark)}
                        >
                          {tx("Unpublish", "取消公开")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {!loading && !groups.length && (
              <p className="empty-copy">
                {tx("Nothing is public yet. Publish bookmarks from the list beside this preview.", "暂未公开任何书签，可在右侧列表中挑选并发布。")}
              </p>
            )}
            {loading && <p className="empty-copy">{tx("Loading public selection…", "正在加载公开书签…")}</p>}
          </div>
        </article>

        <article className="form-card public-publish-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Select bookmarks", "挑选公开书签")}</h2>
              <p>{tx("Filter your library and publish individually or in bulk.", "检索全部书签，按状态筛选并单条或批量发布。")}</p>
            </div>
            <span>{tx(`${filteredBookmarks.length} shown`, `显示 ${filteredBookmarks.length} 条`)}</span>
          </div>

          <div className="public-publish-tools">
            <div className="public-publish-search">
              <span aria-hidden="true">⌕</span>
              <input
                ref={publishSearchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tx("Filter title, URL, description or category…", "按标题、网址、描述或分类筛选…")}
                aria-label={tx("Filter public page bookmarks", "筛选书签")}
              />
              {query && (
                <button
                  className="dm-search-clear"
                  type="button"
                  aria-label={tx("Clear filter", "清空筛选")}
                  onClick={() => {
                    setQuery("");
                    publishSearchRef.current?.focus();
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <div className="settings-segmented public-publish-filter" aria-label={tx("Publication status filter", "公开状态筛选")}>
              <button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>
                {tx(`All · ${bookmarks.length}`, `全部 · ${bookmarks.length}`)}
              </button>
              <button className={filter === "published" ? "active" : ""} type="button" onClick={() => setFilter("published")}>
                {tx(`Published · ${publishedCount}`, `已公开 · ${publishedCount}`)}
              </button>
              <button className={filter === "unpublished" ? "active" : ""} type="button" onClick={() => setFilter("unpublished")}>
                {tx(`Unpublished · ${unpublishedCount}`, `未公开 · ${unpublishedCount}`)}
              </button>
            </div>
          </div>

          <div className="public-bulk-bar">
            <label className="public-select-visible">
              <input
                ref={selectVisibleRef}
                type="checkbox"
                checked={allVisibleSelected}
                disabled={!filteredBookmarks.length || mutationBusy}
                onChange={toggleVisibleSelection}
              />
              <span>{allVisibleSelected ? tx("Clear visible", "取消全选") : tx("Select visible", "全选当前")}</span>
            </label>
            <span className="public-selected-count">{tx(`${selectedIds.size} selected`, `已选 ${selectedIds.size} 条`)}</span>
            <div className="public-bulk-actions">
              <button className="secondary" type="button" disabled={!selectedIds.size || mutationBusy} onClick={() => void updateSelection(true)}>
                {batchBusy === "publish" ? tx("Publishing…", "发布中…") : tx("Publish", "公开")}
              </button>
              <button className="secondary" type="button" disabled={!selectedIds.size || mutationBusy} onClick={() => void updateSelection(false)}>
                {batchBusy === "unpublish" ? tx("Unpublishing…", "取消中…") : tx("Unpublish", "取消公开")}
              </button>
              <button className="text-action" type="button" disabled={!selectedIds.size || mutationBusy} onClick={() => setSelectedIds(new Set())}>
                {tx("Clear", "清空")}
              </button>
            </div>
          </div>

          <div className="public-bookmark-picker public-bookmark-manager">
            {filteredBookmarks.map((bookmark) => {
              const isPublished = published.has(bookmark.id);
              const categoryName = bookmark.categoryId
                ? categoryNameById.get(bookmark.categoryId) ?? tx("Uncategorized", "未分类")
                : tx("Uncategorized", "未分类");
              return (
                <div className={`public-bookmark-row public-bookmark-manage${isPublished ? " is-published" : ""}`} key={bookmark.id}>
                  <label className="public-bookmark-select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(bookmark.id)}
                      disabled={mutationBusy}
                      onChange={() => toggleSelected(bookmark.id)}
                    />
                    <span>
                      <strong>{bookmark.title}</strong>
                      <small>{categoryName} · {bookmark.url}</small>
                    </span>
                  </label>
                  <em>{isPublished ? tx("PUBLISHED", "已公开") : tx("PRIVATE", "私有")}</em>
                  <button
                    className={isPublished ? "danger-text text-action" : "text-action"}
                    type="button"
                    disabled={mutationBusy}
                    onClick={() => void toggle(bookmark)}
                  >
                    {busyId === bookmark.id
                      ? tx("Saving…", "保存中…")
                      : isPublished
                        ? tx("Unpublish", "取消公开")
                        : tx("Publish", "公开")}
                  </button>
                </div>
              );
            })}
            {!loading && !filteredBookmarks.length && (
              <p className="empty-copy">
                {query.trim()
                  ? tx("No bookmarks match this filter.", "没有匹配的书签。")
                  : tx("No bookmarks match this publication state.", "当前状态下暂无书签。")}
              </p>
            )}
            {loading && <p className="empty-copy">{tx("Loading public selection…", "正在加载公开书签…")}</p>}
          </div>
        </article>
      </div>
    </section>
  );
}
