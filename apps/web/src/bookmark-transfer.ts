import {
  inferHealthPolicy,
  normalizeBookmarkUrl,
  type Bookmark,
  type Category,
  type HealthPolicy,
} from "@dockmark/core";

const HEALTH_POLICIES = new Set<HealthPolicy>(["normal", "ignore", "local-only", "manual"]);

export interface ParsedBookmark {
  title: string;
  url: string;
  categoryName?: string;
  description?: string;
  iconUrl?: string;
  healthPolicy?: HealthPolicy;
  tags?: string[];
}

export type ImportStatus = "new" | "duplicate" | "invalid";

export interface ImportCandidate extends ParsedBookmark {
  id: string;
  normalizedUrl?: string;
  status: ImportStatus;
  selected: boolean;
  note?: string;
}

interface DockmarkExportBookmark extends Bookmark {
  tags?: string[];
}

interface DockmarkExport {
  format: "dockmark-bookmarks";
  version: 1;
  exportedAt: string;
  categories: Category[];
  bookmarks: DockmarkExportBookmark[];
}

function directChild(element: Element, tagName: string) {
  return Array.from(element.children).find((child) => child.tagName === tagName) ?? null;
}

function categoryPath(parts: string[]) {
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  if (!cleaned.length) return undefined;
  const path = cleaned.join(" / ");
  return path.length <= 80 ? path : `…${path.slice(-79)}`;
}

export function parseNetscapeBookmarks(text: string): ParsedBookmark[] {
  const document = new DOMParser().parseFromString(text, "text/html");
  const output: ParsedBookmark[] = [];
  const visited = new Set<Element>();

  function walk(list: Element, path: string[]) {
    if (visited.has(list)) return;
    visited.add(list);

    const children = Array.from(list.children);
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (!child) continue;

      if (child.tagName === "DT") {
        const anchor = directChild(child, "A") as HTMLAnchorElement | null;
        if (anchor?.getAttribute("href")) {
          const categoryName = categoryPath(path);
          output.push({
            title: anchor.textContent?.trim() || anchor.href,
            url: anchor.getAttribute("href") ?? anchor.href,
            ...(categoryName ? { categoryName } : {}),
          });
          continue;
        }

        const heading = directChild(child, "H3");
        if (heading) {
          const folder = heading.textContent?.trim();
          const nested = directChild(child, "DL") ??
            (children[index + 1]?.tagName === "DL" ? children[index + 1] : null);
          if (nested) {
            if (children[index + 1] === nested) index += 1;
            walk(nested, folder ? [...path, folder] : path);
          }
          continue;
        }
      }

      if (child.tagName === "DL") walk(child, path);
    }
  }

  const rootLists = Array.from(document.querySelectorAll("body > dl"));
  if (rootLists.length) rootLists.forEach((list) => walk(list, []));
  else {
    const firstList = document.querySelector("dl");
    if (firstList) walk(firstList, []);
  }

  return output;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tagsValue(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags.length ? tags : undefined;
}

function healthPolicyValue(value: unknown): HealthPolicy | undefined {
  return typeof value === "string" && HEALTH_POLICIES.has(value as HealthPolicy)
    ? (value as HealthPolicy)
    : undefined;
}

function parseBookmarkRecord(
  record: Record<string, unknown>,
  categoryName?: string,
): ParsedBookmark[] {
  const url = stringValue(record.url) ?? stringValue(record.href);
  if (!url) return [];
  const title = stringValue(record.title) ?? stringValue(record.name) ?? url;
  const description = stringValue(record.description);
  const iconUrl = stringValue(record.iconUrl);
  const healthPolicy = healthPolicyValue(record.healthPolicy);
  const tags = tagsValue(record.tags);
  return [{
    title,
    url,
    ...(categoryName ? { categoryName } : {}),
    ...(description ? { description } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(healthPolicy ? { healthPolicy } : {}),
    ...(tags ? { tags } : {}),
  }];
}

export function parseJsonBookmarks(text: string): ParsedBookmark[] {
  const value: unknown = JSON.parse(text);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.format === "dockmark-bookmarks" && Array.isArray(record.bookmarks)) {
      const categoryMap = new Map<string, string>();
      if (Array.isArray(record.categories)) {
        for (const item of record.categories) {
          if (!item || typeof item !== "object") continue;
          const category = item as Record<string, unknown>;
          const id = stringValue(category.id);
          const name = stringValue(category.name);
          if (id && name) categoryMap.set(id, name);
        }
      }

      return record.bookmarks.flatMap((item): ParsedBookmark[] => {
        if (!item || typeof item !== "object") return [];
        const bookmark = item as Record<string, unknown>;
        const categoryId = stringValue(bookmark.categoryId);
        return parseBookmarkRecord(bookmark, categoryId ? categoryMap.get(categoryId) : undefined);
      });
    }
  }

  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).bookmarks)
      ? ((value as Record<string, unknown>).bookmarks as unknown[])
      : null;

  if (!list) throw new TypeError("JSON does not contain a bookmark list.");

  return list.flatMap((item): ParsedBookmark[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const categoryName =
      stringValue(record.categoryName) ?? stringValue(record.category) ?? stringValue(record.folder);
    return parseBookmarkRecord(record, categoryName);
  });
}

export function parseBookmarkFile(fileName: string, text: string): ParsedBookmark[] {
  const lowerName = fileName.toLowerCase();
  const trimmed = text.trimStart();
  if (lowerName.endsWith(".json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonBookmarks(text);
  }
  return parseNetscapeBookmarks(text);
}

export function buildImportPreview(
  parsed: ParsedBookmark[],
  existingBookmarks: Bookmark[],
): ImportCandidate[] {
  const existing = new Set<string>();
  for (const bookmark of existingBookmarks) {
    try {
      existing.add(normalizeBookmarkUrl(bookmark.url));
    } catch {
      existing.add(bookmark.url);
    }
  }

  const seen = new Set<string>();
  return parsed.map((item, index) => {
    try {
      const normalizedUrl = normalizeBookmarkUrl(item.url);
      const duplicate = existing.has(normalizedUrl) || seen.has(normalizedUrl);
      seen.add(normalizedUrl);
      const healthPolicy = item.healthPolicy ?? inferHealthPolicy(normalizedUrl);
      return {
        ...item,
        id: `import-${index}-${normalizedUrl}`,
        normalizedUrl,
        healthPolicy,
        status: duplicate ? "duplicate" : "new",
        selected: !duplicate,
        ...(duplicate ? { note: "Already present or repeated in this file" } : {}),
      };
    } catch (error) {
      return {
        ...item,
        id: `import-${index}-invalid`,
        status: "invalid",
        selected: false,
        note: error instanceof Error ? error.message : "Invalid URL",
      };
    }
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function makeDockmarkJson(
  categories: Category[],
  bookmarks: Bookmark[],
  bookmarkTags: Record<string, string[]> = {},
) {
  const payload: DockmarkExport = {
    format: "dockmark-bookmarks",
    version: 1,
    exportedAt: new Date().toISOString(),
    categories,
    bookmarks: bookmarks.map((bookmark) => {
      const tags = bookmarkTags[bookmark.id] ?? [];
      return tags.length ? { ...bookmark, tags } : bookmark;
    }),
  };
  return JSON.stringify(payload, null, 2);
}

export function makeNetscapeHtml(categories: Category[], bookmarks: Bookmark[]) {
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const name = bookmark.categoryId ? categoryMap.get(bookmark.categoryId) ?? "Uncategorized" : "Uncategorized";
    const list = groups.get(name) ?? [];
    list.push(bookmark);
    groups.set(name, list);
  }

  const folders = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => {
      const links = items
        .map((bookmark) => `        <DT><A HREF="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</A>`)
        .join("\n");
      return `    <DT><H3>${escapeHtml(name)}</H3>\n    <DL><p>\n${links}\n    </DL><p>`;
    })
    .join("\n");

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Dockmark Bookmarks</TITLE>\n<H1>Dockmark Bookmarks</H1>\n<DL><p>\n${folders}\n</DL><p>\n`;
}

export function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
