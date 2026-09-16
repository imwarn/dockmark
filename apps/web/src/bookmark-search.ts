import type { Bookmark } from "@dockmark/core";

export function queryTokens(value: string) {
  return value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function textMatchesQuery(query: string, values: string[]) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const haystack = values.join("\n").toLocaleLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function bookmarkMatchesQuery(
  bookmark: Bookmark,
  categoryName: string,
  tags: string[],
  query: string,
) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const normalizedTags = tags.map((tag) => tag.toLocaleLowerCase());
  const haystack = [
    bookmark.title,
    bookmark.url,
    bookmark.description ?? "",
    categoryName,
    ...tags,
  ].join("\n").toLocaleLowerCase();

  return tokens.every((token) => {
    if (token.startsWith("#") && token.length > 1) {
      const tagNeedle = token.slice(1);
      return normalizedTags.some((tag) => tag.includes(tagNeedle));
    }
    return haystack.includes(token);
  });
}
