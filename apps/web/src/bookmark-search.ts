/**
 * [INPUT]: depends on Bookmark and textContainsTokenOrPinyin from @dockmark/core
 * [OUTPUT]: exports queryTokens, textMatchesQuery, and bookmarkMatchesQuery
 * [POS]: client-side tokenized text, #tag, and Pinyin initial search predicates in apps/web/src
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { textContainsTokenOrPinyin, type Bookmark } from "@dockmark/core";

export function queryTokens(value: string) {
  return value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function textMatchesQuery(query: string, values: string[]) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  return tokens.every((token) => values.some((value) => textContainsTokenOrPinyin(value, token)));
}

export function bookmarkMatchesQuery(
  bookmark: Bookmark,
  categoryName: string,
  tags: string[],
  query: string,
) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const fields = [
    bookmark.title,
    bookmark.url,
    bookmark.description ?? "",
    categoryName,
    ...tags,
  ];

  return tokens.every((token) => {
    if (token.startsWith("#") && token.length > 1) {
      const tagNeedle = token.slice(1);
      return tags.some((tag) => textContainsTokenOrPinyin(tag, tagNeedle));
    }
    return fields.some((field) => textContainsTokenOrPinyin(field, token));
  });
}
