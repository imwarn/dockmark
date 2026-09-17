import { useMemo } from "react";
import type { Bookmark, Category } from "@dockmark/core";
import { BookmarkManager as ExistingBookmarkManager } from "./BookmarkManagerLegacy";
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
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  return (
    <>
      <LibraryBulkOrganizer
        bookmarks={bookmarks}
        categories={categories}
        bookmarkTags={bookmarkTags}
        onChanged={onChanged}
      />
      <LibraryBulkMaintenance
        bookmarks={bookmarks}
        bookmarkTags={bookmarkTags}
        categoryNameById={categoryNameById}
        onChanged={onChanged}
      />
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
