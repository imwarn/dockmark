/**
 * [INPUT]: depends on Bookmark, Category from @dockmark/core; useI18n from ./i18n; subviews from ./BookmarkManagerLegacy, ./LibraryBulkOrganizer, ./AiOrganizationSettings, ./LibraryBulkMaintenance, ./BookmarkMaintenance, ./ChangeJournal
 * [OUTPUT]: exports BookmarkManager tabbed hub component
 * [POS]: top-level Bookmarks route workspace switcher hosting Library, Organize, Health, and History views
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { AiOrganizationSettings } from "./AiOrganizationSettings";
import { BookmarkMaintenance } from "./BookmarkMaintenance";
import { BookmarkManager as ExistingBookmarkManager } from "./BookmarkManagerLegacy";
import { ChangeJournal } from "./ChangeJournal";
import { useI18n } from "./i18n";
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

export function BookmarkManager({ bookmarks, categories, bookmarkTags, loading, onChanged }: Props) {
  const { tx } = useI18n();
  const [view, setView] = useState<LibraryView>("library");
  const [journalRevision, setJournalRevision] = useState(0);
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const views = useMemo<Array<{ id: LibraryView; label: string; detail: string }>>(() => [
    {
      id: "library",
      label: tx("Library", "书签库"),
      detail: tx("Create, edit, categorize, and reorder bookmarks.", "创建、编辑、分类与排序书签。"),
    },
    {
      id: "organize",
      label: tx("Organize", "批量与 AI 整理"),
      detail: tx("Bulk moves, tags, and AI-assisted organization.", "批量分类、标签整理与 AI 辅助整理。"),
    },
    {
      id: "health",
      label: tx("Health", "元数据与健康"),
      detail: tx("Metadata, health checks, cleanup, and archive review.", "元数据抓取、健康检查、清理与归档复核。"),
    },
    {
      id: "history",
      label: tx("History", "变更记录"),
      detail: tx("Review recent library changes and recovery snapshots.", "查看近期书签库批量变更与恢复快照。"),
    },
  ], [tx]);

  async function onBulkChanged() {
    await onChanged();
    setJournalRevision((current) => current + 1);
  }

  return (
    <section className="bookmark-management-hub">
      <nav className="section-tabs" aria-label={tx("Bookmark management sections", "书签管理分区")}>
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
