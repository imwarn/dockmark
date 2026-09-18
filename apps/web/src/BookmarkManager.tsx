import { useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { AiOrganizationSettings } from "./AiOrganizationSettings";
import { BookmarkMaintenance } from "./BookmarkMaintenance";
import { BookmarkManager as ExistingBookmarkManager } from "./BookmarkManagerLegacy";
import { ChangeJournal } from "./ChangeJournal";
import { LibraryBulkMaintenance } from "./LibraryBulkMaintenance";
import { LibraryBulkOrganizer } from "./LibraryBulkOrganizer";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  bookmarkTags: Record<string, string[]>;
  loading: boolean;
  onChanged: () => Promise<void>;
}

type LibraryView = "library" | "organize" | "health" | "history";

const views: Array<{ id: LibraryView; label: string; detail: string }> = [
  { id: "library", label: "Library", detail: "Create, edit, categorize and reorder bookmarks." },
  { id: "organize", label: "Organize", detail: "Bulk moves, tags and AI-assisted organization." },
  { id: "health", label: "Health", detail: "Metadata, health checks, cleanup and archive review." },
  { id: "history", label: "History", detail: "Review recent library changes." },
];

export function BookmarkManager({ bookmarks, categories, bookmarkTags, loading, onChanged }: Props) {
  const [view, setView] = useState<LibraryView>("library");
  const [journalRevision, setJournalRevision] = useState(0);
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  async function onBulkChanged() {
    await onChanged();
    setJournalRevision((current) => current + 1);
  }

  const active = views.find((item) => item.id === view) ?? views[0];

  return (
    <section className="management bookmark-management">
      <div className="management-heading bookmark-management-heading">
        <div>
          <p className="eyebrow">BOOKMARK LIBRARY</p>
          <h1>One library,<br />one place to maintain it.</h1>
          <p className="management-intro">{active.detail}</p>
        </div>
        <span className="library-count">{bookmarks.length} bookmarks</span>
      </div>

      <nav className="section-tabs" aria-label="Bookmark management sections">
        {views.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            type="button"
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => setView(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </nav>

      {view === "library" && (
        <ExistingBookmarkManager
          bookmarks={bookmarks}
          categories={categories}
          bookmarkTags={bookmarkTags}
          loading={loading}
          onChanged={onChanged}
        />
      )}

      {view === "organize" && (
        <div className="bookmark-section-stack">
          <LibraryBulkOrganizer
            bookmarks={bookmarks}
            categories={categories}
            bookmarkTags={bookmarkTags}
            onChanged={onBulkChanged}
          />
          <AiOrganizationSettings
            bookmarks={bookmarks}
            categories={categories}
            onChanged={onBulkChanged}
          />
        </div>
      )}

      {view === "health" && (
        <div className="bookmark-section-stack">
          <LibraryBulkMaintenance
            bookmarks={bookmarks}
            bookmarkTags={bookmarkTags}
            categoryNameById={categoryNameById}
            onChanged={onBulkChanged}
          />
          <BookmarkMaintenance bookmarks={bookmarks} onChanged={onBulkChanged} />
        </div>
      )}

      {view === "history" && <ChangeJournal revision={String(journalRevision)} />}
    </section>
  );
}
