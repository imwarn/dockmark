import type { Bookmark, Category } from "@dockmark/core";
import type { SmartCollectionFilters } from "./smart-collections-api";

export function matchesSmartCollection(
  bookmark: Bookmark,
  filters: SmartCollectionFilters,
  tags: string[],
  inboxIds: Set<string>,
) {
  if (Object.prototype.hasOwnProperty.call(filters, "categoryId")) {
    if (filters.categoryId === null ? Boolean(bookmark.categoryId) : bookmark.categoryId !== filters.categoryId) return false;
  }
  if (filters.tags?.length) {
    const normalized = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
    if (!filters.tags.every((tag) => normalized.has(tag.toLocaleLowerCase()))) return false;
  }
  if (filters.domain) {
    let host = "";
    try { host = new URL(bookmark.url).hostname.toLocaleLowerCase(); } catch { return false; }
    const domain = filters.domain.toLocaleLowerCase();
    if (host !== domain && !host.endsWith(`.${domain}`)) return false;
  }
  if (filters.healthStatus && bookmark.healthStatus !== filters.healthStatus) return false;
  if (filters.inbox === "inbox" && !inboxIds.has(bookmark.id)) return false;
  if (filters.inbox === "library" && inboxIds.has(bookmark.id)) return false;
  return true;
}

export function smartCollectionFilterLabels(
  filters: SmartCollectionFilters,
  categoryById: Map<string, string>,
) {
  const labels: string[] = [];
  if (Object.prototype.hasOwnProperty.call(filters, "categoryId")) {
    labels.push(filters.categoryId === null ? "Uncategorized" : categoryById.get(filters.categoryId ?? "") ?? "Unknown category");
  }
  for (const tag of filters.tags ?? []) labels.push(`#${tag}`);
  if (filters.domain) labels.push(filters.domain);
  if (filters.healthStatus) labels.push(filters.healthStatus);
  if (filters.inbox === "inbox") labels.push("Inbox only");
  if (filters.inbox === "library") labels.push("Filed library");
  return labels;
}

export function categoryMap(categories: Category[]) {
  return new Map(categories.map((category) => [category.id, category.name]));
}
