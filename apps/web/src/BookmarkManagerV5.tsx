import type { Bookmark, Category } from "@dockmark/core";
import { BookmarkManager as ExistingBookmarkManager } from "./BookmarkManager";
import { LibraryBulkOrganizer } from "./LibraryBulkOrganizer";

interface Props {
  bookmarks: Bookmark[];
  categories: Category[];
  bookmarkTags: Record<string, string[]>;
  loading: boolean;
  onChanged: () => Promise<void>;
}

export function BookmarkManager({ bookmarks, categories, bookmarkTags, loading, onChanged }: Props) {
  return (
    <>
      <LibraryBulkOrganizer
        bookmarks={bookmarks}
        categories={categories}
        bookmarkTags={bookmarkTags}
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
