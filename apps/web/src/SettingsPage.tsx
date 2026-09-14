import { useEffect, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { listBookmarks, listCategories } from "./api";
import { AppearanceSettings } from "./AppearanceSettings";
import { BrowserSettingsManager } from "./BrowserSettingsManager";
import { PublicPageSettings } from "./PublicPageSettings";
import { SecuritySettings } from "./SecuritySettings";
import "./settings.css";
import "./security.css";

export function SettingsPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listBookmarks(), listCategories()])
      .then(([nextBookmarks, nextCategories]) => {
        if (cancelled) return;
        setBookmarks(nextBookmarks);
        setCategories(nextCategories);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load settings data.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="settings-page shell">
      <section className="management-heading settings-page-heading">
        <div>
          <p className="eyebrow">DOCKMARK SETTINGS</p>
          <h1>Private controls,<br />explicit policies.</h1>
          <p>Manage appearance, security, browser sync behavior, New Tab preferences and the curated public homepage from one place.</p>
        </div>
      </section>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <AppearanceSettings />
      <SecuritySettings />
      <BrowserSettingsManager />
      <PublicPageSettings bookmarks={bookmarks} categories={categories} />
    </main>
  );
}
