import { useCallback, useEffect, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { listBookmarks, listCategories } from "./api";
import { AppearanceSettings } from "./AppearanceSettings";
import { BookmarkMaintenance } from "./BookmarkMaintenance";
import { BrowserSettingsManager } from "./BrowserSettingsManager";
import { PublicPageSettings } from "./PublicPageSettings";
import { SecuritySettings } from "./SecuritySettings";
import "./settings.css";
import "./security.css";

export function SettingsPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    setError(null);
    try {
      const [nextBookmarks, nextCategories] = await Promise.all([listBookmarks(), listCategories()]);
      setBookmarks(nextBookmarks);
      setCategories(nextCategories);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load settings data.");
      throw caught;
    }
  }, []);

  useEffect(() => {
    void refreshData().catch(() => undefined);
  }, [refreshData]);

  return (
    <main className="settings-page shell">
      <section className="management-heading settings-page-heading">
        <div>
          <p className="eyebrow">DOCKMARK SETTINGS</p>
          <h1>Private controls,<br />explicit policies.</h1>
          <p>Manage appearance, security, browser sync behavior, metadata and health review, New Tab preferences and the curated public homepage from one place.</p>
        </div>
      </section>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <AppearanceSettings />
      <SecuritySettings />
      <BrowserSettingsManager />
      <BookmarkMaintenance bookmarks={bookmarks} onChanged={refreshData} />
      <PublicPageSettings bookmarks={bookmarks} categories={categories} />
    </main>
  );
}
