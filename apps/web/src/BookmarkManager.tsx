import { useMemo, useState } from "react";
import type { Bookmark, Category } from "@dockmark/core";
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

export function BookmarkManager({ bookmarks, categories, bookmarkTags, loading, onChanged }: Props) {
  const [journalRevision, setJournalRevision] = useState(0);
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  async function onBulkChanged() {
    await onChanged();
    setJournalRevision((current) => current + 1);
  }

  return (
    <>
      <LibraryBulkOrganizer
        bookmarks={bookmarks}
        categories={categories}
        bookmarkTags={bookmarkTags}
        onChanged={onBulkChanged}
      />
      <LibraryBulkMaintenance
        bookmarks={bookmarks}
        bookmarkTags={bookmarkTags}
        categoryNameById={categoryNameById}
        onChanged={onBulkChanged}
      />
      <ChangeJournal revision={String(journalRevision)} />
      <ExistingBookmarkManager
        bookmarks={bookmarks}
        categories={categories}
        bookmarkTags={bookmarkTags}
        loading={loading}
        onChanged={onChanged}
      />
    </>
  );
}
