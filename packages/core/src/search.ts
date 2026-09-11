import type { SearchEngine } from "./models";

const KEYWORD_PATTERN = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export function normalizeSearchKeyword(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().replace(/^!+/, "").toLowerCase();
  if (!normalized) return undefined;
  if (!KEYWORD_PATTERN.test(normalized)) {
    throw new Error("Search keyword must use 1-24 lowercase letters, numbers, dashes or underscores.");
  }
  return normalized;
}

export function validateSearchTemplate(value: string): string {
  const template = value.trim();
  if (!template.includes("%s")) {
    throw new Error("Search URL must contain a %s query placeholder.");
  }

  const preview = template.replaceAll("%s", "dockmark-test");
  let url: URL;
  try {
    url = new URL(preview);
  } catch {
    throw new Error("Search URL must be a valid absolute URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Search URL must use HTTP or HTTPS.");
  }
  return template;
}

export function buildSearchUrl(engine: Pick<SearchEngine, "searchUrl">, query: string): string {
  const template = validateSearchTemplate(engine.searchUrl);
  return template.replaceAll("%s", encodeURIComponent(query.trim()));
}

export interface BangQueryMatch {
  engine: SearchEngine;
  query: string;
}

export function parseBangQuery(input: string, engines: SearchEngine[]): BangQueryMatch | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("!")) return null;

  const match = trimmed.match(/^!([^\s]+)(?:\s+(.*))?$/);
  if (!match?.[1]) return null;
  const keyword = match[1].toLowerCase();
  const engine = engines.find((candidate) => candidate.keyword?.toLowerCase() === keyword);
  if (!engine) return null;
  return { engine, query: match[2]?.trim() ?? "" };
}

export function matchingBangEngines(input: string, engines: SearchEngine[]): SearchEngine[] {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed.startsWith("!") || trimmed.includes(" ")) return [];
  const prefix = trimmed.slice(1);
  return engines
    .filter((engine) => engine.keyword && engine.keyword.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}
