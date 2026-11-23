/**
 * [INPUT]: depends on PublicPageLayout and PublicPageSettings from @dockmark/core; useI18n from ./i18n
 * [OUTPUT]: exports PublicSiteConfigCard form component for editing public root page (/) branding, default layout, search bar, category nav, and link opening behavior
 * [POS]: Extracted top configuration card rendered by PublicPageSettings.tsx under /app/settings/public to keep both modules cohesive and well below the 800-line limit.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import type { FormEvent } from "react";
import type { PublicPageLayout, PublicPageSettings } from "@dockmark/core";
import { useI18n } from "./i18n";

interface Props {
  siteConfig: PublicPageSettings;
  saving: boolean;
  onChange: (updater: (current: PublicPageSettings) => PublicPageSettings) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function PublicSiteConfigCard({ siteConfig, saving, onChange, onSubmit }: Props) {
  const { tx } = useI18n();

  return (
    <form className="form-card public-site-config-card" onSubmit={onSubmit}>
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
            onChange={(event) => onChange((current) => ({ ...current, siteTitle: event.target.value }))}
            placeholder={tx("Curated links", "个人导航")}
            maxLength={80}
          />
        </label>
        <label className="settings-field">
          <span>{tx("Site subtitle / intro", "站点简介 / 副标题")}</span>
          <input
            type="text"
            value={siteConfig.siteSubtitle}
            onChange={(event) => onChange((current) => ({ ...current, siteSubtitle: event.target.value }))}
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
              onClick={() => onChange((current) => ({ ...current, defaultLayout: layoutValue }))}
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
            onChange={(event) => onChange((current) => ({ ...current, showSearchBar: event.target.checked }))}
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
            onChange={(event) => onChange((current) => ({ ...current, showWebSearch: event.target.checked }))}
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
            onChange={(event) => onChange((current) => ({ ...current, showCategoryNav: event.target.checked }))}
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
            onChange={(event) => onChange((current) => ({ ...current, openInNewTab: event.target.checked }))}
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
        <button className="primary" type="submit" disabled={saving}>
          {saving ? tx("Saving…", "保存中…") : tx("Save navigation settings", "保存导航站配置")}
        </button>
      </div>
    </form>
  );
}
