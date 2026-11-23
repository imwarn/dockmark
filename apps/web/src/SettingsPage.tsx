/**
 * [INPUT]: depends on listBookmarks/listCategories from ./api, useI18n from ./i18n, AppearanceSettings, BrowserSettingsManager, AiProviderSettingsPage, SecuritySettings, PublicPageSettings, and settings/security CSS
 * [OUTPUT]: exports SettingsPage shell and client-side /app/settings/* sub-router across 5 settings tabs
 * [POS]: Mounted by PrivateRoot for /app/settings/*. Coordinates Appearance & Language, Browser, AI Service, Security, and Public Page panels.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { AiProviderSettingsPage } from "./AiProviderSettingsPage";
import { listBookmarks, listCategories } from "./api";
import { AppearanceSettings } from "./AppearanceSettings";
import { BrowserSettingsManager } from "./BrowserSettingsManager";
import { useI18n } from "./i18n";
import { PublicPageSettings } from "./PublicPageSettings";
import { SecuritySettings } from "./SecuritySettings";
import "./settings.css";
import "./security.css";

type SettingsView = "appearance" | "browser" | "ai" | "security" | "public";

function settingsView(pathname: string): SettingsView {
  const segment = pathname.split("/").filter(Boolean).at(-1);
  return segment === "browser" || segment === "ai" || segment === "security" || segment === "public" || segment === "appearance"
    ? segment
    : "appearance";
}

function navigate(view: SettingsView) {
  window.history.pushState({}, "", `/app/settings/${view}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function SettingsPage() {
  const { tx } = useI18n();
  const [path, setPath] = useState(window.location.pathname);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [publicDataLoaded, setPublicDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = useMemo(() => settingsView(path), [path]);

  const sections = useMemo<Array<{ id: SettingsView; label: string; detail: string }>>(
    () => [
      {
        id: "appearance",
        label: tx("Appearance & Language", "外观与语言"),
        detail: tx("Theme mode and interface language.", "主题模式与界面显示语言。"),
      },
      {
        id: "browser",
        label: tx("Browser", "浏览器与新标签页"),
        detail: tx("New Tab launcher, shortcuts and sync.", "新标签页启动台、快捷键与同步。"),
      },
      {
        id: "ai",
        label: tx("AI Service", "AI 服务"),
        detail: tx("OpenAI-compatible endpoint, model and Worker key status.", "OpenAI 兼容接口、模型预设与 Worker 密钥状态。"),
      },
      {
        id: "security",
        label: tx("Security", "安全与设备"),
        detail: tx("Pairing codes and trusted extensions.", "配对码与已配对扩展管理。"),
      },
      {
        id: "public",
        label: tx("Public Page", "公开主页"),
        detail: tx("Navigation station look, publishing and order.", "导航站外观配置、书签公开与排序。"),
      },
    ],
    [tx],
  );

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const refreshPublicData = useCallback(async () => {
    setError(null);
    try {
      const [nextBookmarks, nextCategories] = await Promise.all([listBookmarks(), listCategories()]);
      setBookmarks(nextBookmarks);
      setCategories(nextCategories);
      setPublicDataLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not load public-page data.", "无法加载公开主页数据。"));
      throw caught;
    }
  }, [tx]);

  useEffect(() => {
    if (view === "public" && !publicDataLoaded) {
      void refreshPublicData().catch(() => undefined);
    }
  }, [publicDataLoaded, refreshPublicData, view]);

  const active = sections.find((section) => section.id === view) ?? sections[0]!;

  return (
    <main className="settings-page shell">
      <section className="management-heading settings-page-heading">
        <div>
          <h1>{tx("Settings", "设置")}</h1>
          <p>{active.detail}</p>
        </div>
      </section>

      <nav className="settings-subnav" aria-label={tx("Settings sections", "设置分区")}>
        {sections.map((section) => (
          <button
            key={section.id}
            className={view === section.id ? "active" : ""}
            type="button"
            aria-current={view === section.id ? "page" : undefined}
            onClick={() => navigate(section.id)}
          >
            <strong>{section.label}</strong>
            <span>{section.detail}</span>
          </button>
        ))}
      </nav>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {view === "appearance" && <AppearanceSettings />}
      {view === "browser" && <BrowserSettingsManager />}
      {view === "ai" && <AiProviderSettingsPage />}
      {view === "security" && <SecuritySettings />}
      {view === "public" && (
        publicDataLoaded
          ? <PublicPageSettings bookmarks={bookmarks} categories={categories} onChanged={refreshPublicData} />
          : <div className="settings-loading-card">{tx("Loading public-page library…", "正在加载书签列表…")}</div>
      )}
    </main>
  );
}
