/**
 * [INPUT]: depends on CommandResult and CommandSource from ./models; depends on pinyinStartsWith and textContainsTokenOrPinyin from ./pinyin
 * [OUTPUT]: exports LAUNCHER_SOURCE_WEIGHT, LAUNCHER_SOURCE_LABEL, launcherTextScore, and rankCommands
 * [POS]: launcher command text/Pinyin scoring and source-priority ranking in packages/core/src
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import type { CommandResult, CommandSource } from "./models";
import { pinyinStartsWith, textContainsTokenOrPinyin } from "./pinyin";

export const LAUNCHER_SOURCE_WEIGHT: Record<CommandSource, number> = {
  tab: 500,
  workspace: 400,
  session: 350,
  collection: 325,
  bookmark: 300,
  navigation: 200,
  search: 100,
};

export const LAUNCHER_SOURCE_LABEL: Record<CommandSource, string> = {
  tab: "Open tab",
  workspace: "Workspace",
  session: "Session",
  collection: "Collection",
  bookmark: "Bookmark",
  navigation: "Navigation",
  search: "Search",
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").toLocaleLowerCase();
}

export function launcherTextScore(
  query: string,
  primary: string | null | undefined,
  secondary: Array<string | null | undefined> = [],
  base = 0,
): number {
  const needle = normalize(query).trim();
  if (!needle) return base;

  const primaryRaw = String(primary ?? "");
  const primaryText = normalize(primaryRaw);
  const secondaryRaw = secondary.map((value) => String(value ?? ""));
  const secondaryText = secondaryRaw.map(normalize).join("\n");
  const terms = needle.split(/\s+/).filter(Boolean);
  const allTermsMatch = terms.every(
    (term) =>
      textContainsTokenOrPinyin(primaryRaw, term) ||
      secondaryRaw.some((item) => textContainsTokenOrPinyin(item, term)),
  );
  if (!allTermsMatch) return -1;

  let score = base + Math.min(18, Math.max(0, terms.length - 1) * 3);
  if (primaryText === needle) score += 90;
  else if (primaryText.startsWith(needle)) score += 60;
  else if (pinyinStartsWith(primaryRaw, needle)) score += 45;
  else if (primaryText.includes(needle)) score += 35;
  else if (textContainsTokenOrPinyin(primaryRaw, needle)) score += 22;
  else if (secondaryText.includes(needle)) score += 15;
  else if (secondaryRaw.some((item) => textContainsTokenOrPinyin(item, needle))) score += 12;
  else score += 8;
  return score;
}

export function rankCommands(results: CommandResult[]): CommandResult[] {
  return [...results].sort((a, b) => {
    const aScore = LAUNCHER_SOURCE_WEIGHT[a.source] + a.score;
    const bScore = LAUNCHER_SOURCE_WEIGHT[b.source] + b.score;
    return bScore - aScore || a.title.localeCompare(b.title);
  });
}
