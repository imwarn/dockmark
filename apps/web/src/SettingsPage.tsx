import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { listBookmarks, listCategories } from "./api";
import { AppearanceSettings } from "./AppearanceSettings";
import { BrowserSettingsManager } from "./BrowserSettingsManager";
import { PublicPageSettings } from "./PublicPageSettings";
import { SecuritySettings } from "./SecuritySettings";
import "./settings.css";
import "./security.css";

type SettingsView = "appearance" | "browser" | "security" | "public";

const sections: Array<{ id: SettingsView; label: string; detail: string }> = [
  { id: "appearance", label: "Appearance", detail: "Theme and visual preferences." },
  { id: "browser", label: "Browser", detail: "New Tab and sync behavior." },
  { id: "security", label: "Security", detail: "Pairing and trusted devices." },
  { id: "public", label: "Public Page", detail: "Publish and arrange curated links." },
];

function settingsView(pathname: string): SettingsView {
  const segment = pathname.split("/").filter(Boolean).at(-1);
  return segment === "browser" || segment === "security" || segment === "public" || segment === "appearance"
    ? segment
    : "appearance";
}

function navigate(view: SettingsView) {
  window.history.pushState({}, "", `/app/settings/${view}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function SettingsPage() {
  const [path, setPath] = useState(window.location.pathname);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [publicDataLoaded, setPublicDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = useMemo(() => settingsView(path), [path]);

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
      setError(caught instanceof Error ? caught.message : "Could not load public-page data.");
      throw caught;
    }
  }, []);

  useEffect(() => {
    if (view === "public" && !publicDataLoaded) {
      void refreshPublicData().catch(() => undefined);
    }
  }, [publicDataLoaded, refreshPublicData, view]);

  const active = sections.find((section) => section.id === view) ?? sections[0];

  return (
    <main className="settings-page shell">
      <section className="management-heading settings-page-heading">
        <div>
          <p className="eyebrow">DOCKMARK SETTINGS</p>
          <h1>Policies and preferences,<br />without the library clutter.</h1>
          <p>{active.detail} Bookmark editing, organization, health and change history now live together under Workspace → Bookmarks.</p>
        </div>
      </section>

      <nav className="settings-subnav" aria-label="Settings sections">
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
      {view === "security" && <SecuritySettings />}
      {view === "public" && (
        publicDataLoaded
          ? <PublicPageSettings bookmarks={bookmarks} categories={categories} onChanged={refreshPublicData} />
          : <div className="settings-loading-card">Loading public-page library…</div>
      )}
    </main>
  );
}
